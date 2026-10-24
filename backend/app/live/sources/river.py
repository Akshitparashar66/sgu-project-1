"""River gauges at warning or danger level, from the river service (typed-in
readings, an optional feed, CWC readings via NDMA). The levels themselves are
the district's: AEGIS never sets or guesses them."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

_IST = timezone(timedelta(hours=5, minutes=30))
HINDI_RIVER = {"Hindon": "हिंडन", "Yamuna": "यमुना", "Ganga": "गंगा"}


def gauge_alert(*, gauge_id: str, river: str, status: str, level_m: float, warning_m: float, danger_m: float,
                observed_at: str, reading_source: str, scenario_id: str | None) -> dict:
    danger = status == "danger"
    threshold = danger_m if danger else warning_m
    when = datetime.fromisoformat(observed_at).astimezone(_IST).strftime("%H:%M IST, %d %b")
    return {
        "id": f"river:{gauge_id}:{status}", "source": "river", "isDemo": False,
        "severity": "severe" if danger else "warning",
        "title": f"{river} at {status} level: {level_m:g} m ({status} level {threshold:g} m)",
        "titleHi": f"{HINDI_RIVER.get(river, river)} नदी {'खतरे' if danger else 'चेतावनी'} के स्तर पर: {level_m:g} मी",
        "detail": (f"Reading from {reading_source} at {when}. Warning level {warning_m:g} m, "
                   f"danger level {danger_m:g} m, as set by the district."),
        "area": f"{river} river", "observedAt": observed_at, "expiresAt": None, "link": None, "edgeIds": [],
        # The map highlights the scenario's flood hazard area while this is open.
        "marksHazard": True,
        "action": {"label": "Open the flood scenario", "scenarioId": scenario_id} if scenario_id else None,
    }


def river_alerts(status: dict) -> list[dict]:
    """`status` is app.services.river.river_status()'s result."""
    return [
        gauge_alert(gauge_id=g["id"], river=g["river"], status=g["status"], level_m=g["latest"]["levelM"],
                    warning_m=g["warningLevelM"], danger_m=g["dangerLevelM"], observed_at=g["latest"]["observedAt"],
                    reading_source=g["latest"]["source"],
                    scenario_id=(g.get("suggestion") or {}).get("scenarioId"))
        for g in status["gauges"] if g["status"] in ("warning", "danger")
    ]
