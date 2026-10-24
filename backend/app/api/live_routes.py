from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter
from pydantic import Field

from app.api.errors import AegisError
from app.live import notify
from app.live.alerts import SEVERITIES, AlertNotFound, AlertStore
from app.live.config import live_enabled, load_config
from app.live.poller import mark_viewed, poll_due, sources_view, start_demo, stop_demo
from app.models.schemas import CamelModel

router = APIRouter(prefix="/api/alerts")
Severity = Literal["info", "warning", "severe", "extreme"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _not_found(alert_id: str) -> AegisError:
    return AegisError("ALERT_NOT_FOUND", f"No alert '{alert_id}'", field="alert_id", status_code=404)


def _overview(store: AlertStore) -> dict:
    traffic = load_config()["traffic"]
    settings = store.section("settings")
    demo = store.section("demo")
    return {
        "alerts": store.all(), "sources": sources_view(store),
        "demo": {"running": bool(demo.get("running")), "startedAt": demo.get("startedAt")},
        "liveEnabled": live_enabled(), "messaging": notify.configured(),
        "settings": {"autoSend": {s: bool(settings.get("autoSend", {}).get(s)) for s in SEVERITIES[1:]},
                     "changedBy": settings.get("changedBy"), "changedAt": settings.get("changedAt")},
        "traffic": {"sections": [{k: s[k] for k in ("id", "name", "edgeIds")} for s in traffic["sections"]],
                    "notCovered": traffic["notCovered"]},
        "serverTime": _now().isoformat(timespec="seconds"),
    }


@router.get("")
def alerts() -> dict:
    """Every alert, the state of each source, and messaging settings. Also
    runs the local sources (demo, river) and tells the poller someone is
    looking, which is when live traffic is checked."""
    store, now = AlertStore(), _now()
    mark_viewed(store, now)
    poll_due(store, now, network=False)
    return _overview(store)


@router.post("/demo/start")
def demo_start() -> dict:
    store, now = AlertStore(), _now()
    start_demo(store, now)
    poll_due(store, now, network=False)
    return _overview(store)


@router.post("/demo/stop")
def demo_stop() -> dict:
    store, now = AlertStore(), _now()
    stop_demo(store, now)
    return _overview(store)


@router.get("/log")
def alert_log() -> list[dict]:
    """Every alert raised, cleared, acknowledged and sent, newest first."""
    return AlertStore().log()


class RecipientRequest(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    role: str = Field(default="", max_length=80)
    phone: str = Field(pattern=r"^\+[\d\s-]{8,20}$")
    channels: list[Literal["sms", "whatsapp"]] = Field(min_length=1)
    min_severity: Severity = "severe"


@router.get("/recipients")
def recipients() -> list[dict]:
    return notify.list_recipients()


@router.post("/recipients")
def add_recipient(request: RecipientRequest) -> dict:
    try:
        return notify.add_recipient(request.model_dump(by_alias=True))
    except ValueError as exc:
        raise AegisError("VALIDATION_ERROR", str(exc), field="phone", status_code=422) from exc


@router.delete("/recipients/{recipient_id}")
def remove_recipient(recipient_id: str) -> dict:
    if not notify.remove_recipient(recipient_id):
        raise AegisError("RECIPIENT_NOT_FOUND", f"No recipient '{recipient_id}'", field="recipient_id", status_code=404)
    return {"removed": recipient_id}


class SettingsRequest(CamelModel):
    auto_send: dict[Severity, bool]
    by: str = Field(min_length=1, max_length=80)


@router.put("/settings")
def update_settings(request: SettingsRequest) -> dict:
    """Auto-send per severity. Off by default; who changed it is logged."""
    store, now = AlertStore(), _now()
    current = store.section("settings").get("autoSend", {})
    auto = {**current, **request.auto_send}
    store.update_section("settings", {"autoSend": auto, "changedBy": request.by, "changedAt": now.isoformat(timespec="seconds")})
    store.record_event("auto-send changed", now, by=request.by, autoSend=auto)
    return _overview(store)["settings"]


class AcknowledgeRequest(CamelModel):
    by: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=500)


@router.post("/{alert_id}/acknowledge")
def acknowledge(alert_id: str, request: AcknowledgeRequest) -> dict:
    try:
        return AlertStore().acknowledge(alert_id, by=request.by, note=request.note, now=_now())
    except AlertNotFound as exc:
        raise _not_found(alert_id) from exc


@router.get("/{alert_id}/send-preview")
def send_preview(alert_id: str) -> dict:
    try:
        alert = AlertStore().get(alert_id)
    except AlertNotFound as exc:
        raise _not_found(alert_id) from exc
    return {"message": notify.message(alert), "recipients": notify.preview(alert), "configured": notify.configured()}


class SendRequest(CamelModel):
    by: str = Field(min_length=1, max_length=80)


@router.post("/{alert_id}/send")
def send(alert_id: str, request: SendRequest) -> dict:
    store = AlertStore()
    try:
        deliveries = notify.send(store, alert_id, by=request.by)
    except AlertNotFound as exc:
        raise _not_found(alert_id) from exc
    except notify.NotConfigured as exc:
        raise AegisError("MESSAGING_NOT_CONFIGURED", str(exc), status_code=409) from exc
    return {"deliveries": deliveries, "alert": store.get(alert_id)}
