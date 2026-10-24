from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from pathlib import Path

_DEFAULT_DIR = Path(__file__).resolve().parents[3] / "data" / "alerts"  # git-ignored
SEVERITIES = ("info", "warning", "severe", "extreme")
RANK = {s: i for i, s in enumerate(SEVERITIES)}
# Fields a source may change on an alert it raised before.
_UPDATABLE = ("severity", "title", "titleHi", "detail", "area", "observedAt", "expiresAt", "link", "action", "edgeIds",
              "marksHazard")
# One lock for the whole folder: the poller thread and API requests share it.
_LOCK = threading.RLock()


def alerts_dir() -> Path:
    override = os.environ.get("AEGIS_ALERTS_DIR")
    return Path(override) if override else _DEFAULT_DIR


class AlertNotFound(LookupError):
    pass


def _iso(at: datetime) -> str:
    return at.isoformat(timespec="seconds")


def _expired(alert: dict, now: datetime) -> bool:
    return bool(alert.get("expiresAt")) and datetime.fromisoformat(alert["expiresAt"]) <= now


class AlertStore:
    """Alerts, source states and settings in `state.json`, every change in an
    append-only `log.jsonl`. An alert's id is its source plus the source's own
    id, so a condition reported again updates its alert instead of adding one."""

    def __init__(self, directory: Path | None = None):
        self.dir = directory or alerts_dir()

    # -- storage ---------------------------------------------------------

    def _load(self) -> dict:
        path = self.dir / "state.json"
        state = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        for key in ("alerts", "sources", "demo", "settings", "cache"):
            state.setdefault(key, {})
        return state

    def _save(self, state: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / "state.json.tmp"
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.dir / "state.json")

    def _log(self, event: str, at: datetime, **fields) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        with (self.dir / "log.jsonl").open("a", encoding="utf-8") as log:
            log.write(json.dumps({"at": _iso(at), "event": event, **fields}, ensure_ascii=False) + "\n")

    def log(self, limit: int = 200) -> list[dict]:
        """Newest first."""
        path = self.dir / "log.jsonl"
        if not path.exists():
            return []
        lines = path.read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in reversed(lines[-limit:])]

    def section(self, name: str) -> dict:
        with _LOCK:
            return self._load()[name]

    def update_section(self, name: str, values: dict) -> dict:
        with _LOCK:
            state = self._load()
            state[name].update(values)
            self._save(state)
            return state[name]

    def replace_section(self, name: str, values: dict) -> None:
        with _LOCK:
            state = self._load()
            state[name] = values
            self._save(state)

    def record_event(self, event: str, at: datetime, **fields) -> None:
        with _LOCK:
            self._log(event, at, **fields)

    # -- alerts ----------------------------------------------------------

    def merge(self, source: str, incoming: list[dict], now: datetime, *, clears_when_absent: bool) -> list[dict]:
        """Store what `source` reports now. Returns the alerts that are new or
        got worse, the ones worth telling people about. With
        `clears_when_absent` (traffic, river, demo), an alert the source no
        longer reports has cleared; official alerts instead run to their own
        expiry time."""
        raised = []
        with _LOCK:
            state = self._load()
            alerts = state["alerts"]
            for new in incoming:
                if _expired(new, now):
                    continue
                old = alerts.get(new["id"])
                if old is None or (old["status"] == "expired" and clears_when_absent):
                    alert = {**new, "source": source, "raisedAt": _iso(now), "status": "active",
                             "clearedReason": None, "acknowledgement": None,
                             "deliveries": old["deliveries"] if old else []}
                    alerts[new["id"]] = alert
                    self._log("raised", now, alertId=alert["id"], severity=alert["severity"], title=alert["title"])
                    raised.append(alert)
                    continue
                if old["status"] == "expired":
                    continue
                worse = RANK[new["severity"]] > RANK[old["severity"]]
                old.update({k: new.get(k) for k in _UPDATABLE if k in new})
                if worse:
                    old.update(status="active", acknowledgement=None)
                    self._log("escalated", now, alertId=old["id"], severity=old["severity"], title=old["title"])
                    raised.append(old)
            if clears_when_absent:
                current = {a["id"] for a in incoming}
                for alert in alerts.values():
                    if alert["source"] == source and alert["status"] != "expired" and alert["id"] not in current:
                        alert.update(status="expired", clearedReason="condition cleared")
                        self._log("cleared", now, alertId=alert["id"])
            self._expire(alerts, now)
            self._save(state)
        return raised

    def _expire(self, alerts: dict, now: datetime) -> None:
        for alert in alerts.values():
            if alert["status"] != "expired" and _expired(alert, now):
                alert.update(status="expired", clearedReason="expired")
                self._log("expired", now, alertId=alert["id"])

    def expire(self, now: datetime) -> None:
        with _LOCK:
            state = self._load()
            self._expire(state["alerts"], now)
            self._save(state)

    def clear_source(self, source: str, now: datetime, reason: str) -> None:
        with _LOCK:
            state = self._load()
            for alert in state["alerts"].values():
                if alert["source"] == source and alert["status"] != "expired":
                    alert.update(status="expired", clearedReason=reason)
            self._save(state)

    def acknowledge(self, alert_id: str, *, by: str, note: str, now: datetime) -> dict:
        with _LOCK:
            state = self._load()
            alert = state["alerts"].get(alert_id)
            if alert is None:
                raise AlertNotFound(alert_id)
            if alert["status"] == "active":
                alert["status"] = "acknowledged"
            alert["acknowledgement"] = {"by": by, "note": note, "at": _iso(now)}
            self._log("acknowledged", now, alertId=alert_id, by=by, note=note)
            self._save(state)
            return alert

    def add_delivery(self, alert_id: str, delivery: dict, now: datetime) -> None:
        with _LOCK:
            state = self._load()
            state["alerts"][alert_id].setdefault("deliveries", []).append(delivery)
            self._log("message " + delivery["status"], now, alertId=alert_id,
                      **{k: delivery[k] for k in ("name", "phone", "channel", "by") if k in delivery},
                      **({"error": delivery["error"]} if delivery.get("error") else {}))
            self._save(state)

    def get(self, alert_id: str) -> dict:
        with _LOCK:
            alert = self._load()["alerts"].get(alert_id)
        if alert is None:
            raise AlertNotFound(alert_id)
        return alert

    def all(self) -> list[dict]:
        """Active and acknowledged first, most serious first, then newest."""
        with _LOCK:
            alerts = list(self._load()["alerts"].values())
        alerts.sort(key=lambda a: a["raisedAt"], reverse=True)
        alerts.sort(key=lambda a: (a["status"] == "expired", -RANK[a["severity"]]))
        return alerts
