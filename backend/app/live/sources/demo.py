"""A scripted flood day for rehearsals and the stage: no keys, no network.

Every alert is marked DEMO, uses made-up river levels, and is never sent to
anyone automatically. The suggested what-ifs are built by the same code as
real alerts, so applying one behaves exactly as a real one would."""
from __future__ import annotations

from datetime import datetime

from app.live.config import load_config
from app.live.sources.river import gauge_alert
from app.live.sources.traffic import alert_from_reading

# Made-up levels for the demo only. Real thresholds come from the district.
DEMO_WARNING_M, DEMO_DANGER_M = 205.0, 206.0


def _demo(alert: dict, demo_id: str) -> dict:
    return {**alert, "id": f"demo:{demo_id}", "source": "demo", "isDemo": True,
            "title": f"DEMO · {alert['title']}", "titleHi": f"डेमो · {alert['titleHi']}" if alert.get("titleHi") else None}


def alerts_at(started: datetime, now: datetime, cfg: dict) -> list[dict]:
    """What the flood day shows `now`, for a demo started at `started`."""
    elapsed = (now - started).total_seconds()
    at = now.isoformat(timespec="seconds")
    alerts = [_demo({
        "severity": "severe", "edgeIds": [], "expiresAt": None, "link": None, "observedAt": at,
        "title": "IMD: heavy to very heavy rain very likely over Ghaziabad and adjoining areas in the next 6 hours",
        "titleHi": "आईएमडी: अगले 6 घंटों में गाज़ियाबाद और आसपास के क्षेत्रों में भारी से बहुत भारी वर्षा की संभावना",
        "detail": "Scripted demo alert, in the form of an IMD warning on NDMA's SACHET feed.",
        "area": "Ghaziabad", "action": {"label": "Open the flood scenario", "scenarioId": cfg["scenarioId"]},
    }, "imd-rain")]
    if 30 <= elapsed:
        danger = elapsed >= 60
        river = gauge_alert(gauge_id=cfg["gaugeId"], river="Hindon", status="danger" if danger else "warning",
                            level_m=206.3 if danger else 205.4, warning_m=DEMO_WARNING_M, danger_m=DEMO_DANGER_M,
                            observed_at=at, reading_source="the demo (made-up levels)", scenario_id=cfg["scenarioId"])
        alerts.append(_demo(river, "river-danger" if danger else "river-warning"))
    if 90 <= elapsed:
        traffic = load_config()["traffic"]
        section = next(s for s in traffic["sections"] if s["id"] == cfg["jamSectionId"])
        free = 38.0
        reading = {"sectionId": section["id"], "name": section["name"], "edgeIds": section["edgeIds"],
                   "currentSpeed": round(free * cfg["jamSpeedRatio"]), "freeFlowSpeed": free,
                   "ratio": cfg["jamSpeedRatio"], "closed": False, "confidence": 1.0, "snapMetres": 0, "usable": True}
        jam = alert_from_reading(section, reading, traffic)
        alerts.append(_demo({**jam, "observedAt": at}, f"traffic-{section['id']}"))
    return alerts
