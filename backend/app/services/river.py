from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from pydantic import Field, model_validator

from app.models.schemas import CamelModel

_DATA = Path(__file__).resolve().parents[3] / "data"
_CONFIG = _DATA / "river_gauges.json"  # committed gauge list; thresholds left for the district to set
FEED_TIMEOUT_S = 5
MAX_READINGS = 50


def _state_path() -> Path:
    """Thresholds set in the app and readings received: local data, git-ignored."""
    override = os.environ.get("AEGIS_RIVER_STATE")
    return Path(override) if override else _DATA / "river" / "state.json"


class GaugeNotFound(LookupError):
    pass


class ReadingRequest(CamelModel):
    level_m: float = Field(ge=-50, le=500)
    observed_at: datetime | None = None  # defaults to now


class ThresholdsRequest(CamelModel):
    warning_level_m: float
    danger_level_m: float

    @model_validator(mode="after")
    def warning_below_danger(self):
        if self.warning_level_m >= self.danger_level_m:
            raise ValueError("the warning level must be below the danger level")
        return self


def _load_state() -> dict:
    path = _state_path()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _config() -> list[dict]:
    return json.loads(_CONFIG.read_text(encoding="utf-8"))["gauges"]


def _gauge(gauge_id: str) -> dict:
    gauge = next((g for g in _config() if g["id"] == gauge_id), None)
    if gauge is None:
        raise GaugeNotFound(gauge_id)
    return gauge


def _record(state: dict, gauge_id: str, level_m: float, observed_at: datetime | None, source: str) -> None:
    at = (observed_at or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds")
    readings = state.setdefault(gauge_id, {}).setdefault("readings", [])
    readings.append({"levelM": level_m, "observedAt": at, "source": source})
    readings.sort(key=lambda r: r["observedAt"])
    del readings[:-MAX_READINGS]


def _poll_feed(state: dict) -> str | None:
    """Optional live feed: AEGIS_RIVER_FEED_URL returning {"gaugeId", "levelM",
    "observedAt"} or a list of them. Returns an error message, or None."""
    url = os.environ.get("AEGIS_RIVER_FEED_URL")
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=FEED_TIMEOUT_S) as response:
            data = json.loads(response.read())
        known = {g["id"] for g in _config()}
        for item in data if isinstance(data, list) else [data]:
            if item.get("gaugeId") in known:
                observed = datetime.fromisoformat(item["observedAt"]) if item.get("observedAt") else None
                if not any(r["source"] == "feed" and r["observedAt"] == (observed and observed.isoformat(timespec="seconds"))
                           for r in state.get(item["gaugeId"], {}).get("readings", [])):
                    _record(state, item["gaugeId"], float(item["levelM"]), observed, "feed")
        return None
    except Exception as exc:  # a broken feed must never break the page
        return f"River feed unavailable: {exc}"


def _status(level: float | None, warning: float | None, danger: float | None) -> str:
    if level is None:
        return "no reading"
    if warning is None or danger is None:
        return "thresholds not set"
    if level >= danger:
        return "danger"
    if level >= warning:
        return "warning"
    return "normal"


def river_status() -> dict:
    state = _load_state()
    feed_error = _poll_feed(state)
    if os.environ.get("AEGIS_RIVER_FEED_URL") and not feed_error:
        _save_state(state)
    gauges = []
    for g in _config():
        saved = state.get(g["id"], {})
        warning = saved.get("warningLevelM", g["warningLevelM"])
        danger = saved.get("dangerLevelM", g["dangerLevelM"])
        readings = saved.get("readings", [])
        latest = readings[-1] if readings else None
        status = _status(latest and latest["levelM"], warning, danger)
        gauges.append({
            "id": g["id"], "name": g["name"], "river": g["river"], "readingSource": g["readingSource"],
            "warningLevelM": warning, "dangerLevelM": danger, "latest": latest, "recent": readings[-10:],
            "status": status,
            "suggestion": ({"scenarioId": g["floodScenarioId"],
                            "message": f"The {g['river']} is at {status} level: review the flood scenario and its plan."}
                           if status in ("warning", "danger") else None),
        })
    return {"gauges": gauges, "feedConnected": bool(os.environ.get("AEGIS_RIVER_FEED_URL")), "feedError": feed_error}


def add_reading(gauge_id: str, request: ReadingRequest) -> dict:
    _gauge(gauge_id)
    state = _load_state()
    _record(state, gauge_id, request.level_m, request.observed_at, "manual")
    _save_state(state)
    return river_status()


def set_thresholds(gauge_id: str, request: ThresholdsRequest) -> dict:
    _gauge(gauge_id)
    state = _load_state()
    state.setdefault(gauge_id, {}).update(warningLevelM=request.warning_level_m, dangerLevelM=request.danger_level_m)
    _save_state(state)
    return river_status()
