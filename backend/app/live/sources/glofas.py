"""The Hindon flow forecast: GloFAS river discharge for the ~5 km cell beside
Raj Nagar Extension, served free by Open-Meteo, against that cell's own 2-, 5-
and 20-year flood flows (data/hindon_glofas.json).

A model forecast, not a gauge: it can see a big river flood days ahead, but it
missed the July 2023 Hindon flood entirely. It raises alerts and suggests the
flood scenario; it never touches the district's gauge thresholds."""
from __future__ import annotations

import json
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path

from app.live.sources.river import HINDI_RIVER

FLOOD_URL = ("https://flood-api.open-meteo.com/v1/flood?latitude={lat}&longitude={lon}"
             "&daily=river_discharge,river_discharge_median,river_discharge_max&past_days=1&forecast_days=10")
_DATA = Path(__file__).resolve().parents[4] / "data"
_LEVELS = ("warning", "severe", "extreme")  # 2-, 5- and 20-year flows


def load_thresholds(cfg: dict) -> dict:
    return json.loads((_DATA / cfg["thresholdsFile"]).read_text(encoding="utf-8"))


def _level(flow: float, limits: dict) -> str:
    return next((lvl for lvl in reversed(_LEVELS) if flow >= limits[lvl]), "normal")


def reading_from(data: dict, thresholds: dict, cfg: dict, today: date) -> dict:
    """Today's flow and the peak over the next `lookaheadDays` days: the
    ensemble median (likely) and the ensemble maximum (the wettest forecast)."""
    daily = data["daily"]
    last = today + timedelta(days=cfg["lookaheadDays"] - 1)
    days = [(date.fromisoformat(t), i) for i, t in enumerate(daily["time"])]
    ahead = [i for d, i in days if today <= d <= last and daily["river_discharge_median"][i] is not None]
    limits = thresholds["thresholdsM3s"]
    peak = max(ahead, key=lambda i: daily["river_discharge_median"][i])
    high = max(ahead, key=lambda i: daily["river_discharge_max"][i] or 0)
    today_index = next(i for d, i in days if d == today)
    return {
        "river": thresholds["river"], "todayM3s": daily["river_discharge"][today_index],
        "peakM3s": daily["river_discharge_median"][peak], "peakDate": daily["time"][peak],
        "highM3s": daily["river_discharge_max"][high], "highDate": daily["time"][high],
        "level": _level(daily["river_discharge_median"][peak], limits),
        "highLevel": _level(daily["river_discharge_max"][high] or 0, limits),
        "thresholdsM3s": limits, "returnPeriodYears": thresholds["returnPeriodYears"],
        "cell": thresholds["cell"], "lookaheadDays": cfg["lookaheadDays"],
    }


def _day(iso: str) -> str:
    return date.fromisoformat(iso).strftime("%d %b").lstrip("0")


def alert_from(reading: dict, thresholds: dict, cfg: dict) -> dict | None:
    river = reading["river"]
    limits, years = reading["thresholdsM3s"], reading["returnPeriodYears"]
    caveat = (f"GloFAS model forecast for a ~5 km area of the {river}, not a gauge reading. "
              f"Flood flows from this area's own record ({thresholds['years']}): "
              f"2-year {limits['warning']}, 5-year {limits['severe']}, 20-year {limits['extreme']} m³/s. "
              f"{thresholds['knownMiss']}")
    base = {"id": f"glofas:{river.lower()}", "source": "glofas", "isDemo": False, "edgeIds": [],
            "area": f"{river} river, near Raj Nagar Extension", "link": "https://www.globalfloods.eu/",
            "expiresAt": None, "marksHazard": True}
    level = reading["level"]
    if level != "normal":
        flow = round(reading["peakM3s"])
        return {**base, "severity": level,
                "title": (f"{river} flow forecast {flow} m³/s on {_day(reading['peakDate'])}, "
                          f"above the {years[level]}-year flood flow ({limits[level]} m³/s)"),
                "titleHi": f"{HINDI_RIVER.get(river, river)} नदी में {_day(reading['peakDate'])} को बाढ़ जैसा बहाव संभव: {flow} घन मी/से",
                "detail": f"Likely peak (ensemble median). Wettest forecast: {round(reading['highM3s'])} m³/s. {caveat}",
                "action": {"label": "Open the flood scenario", "scenarioId": cfg["scenarioId"]}}
    if reading["highLevel"] != "normal":
        high = round(reading["highM3s"])
        return {**base, "severity": "info",
                "title": (f"Some forecasts take the {river} to {high} m³/s on {_day(reading['highDate'])}, "
                          f"above the {years[reading['highLevel']]}-year flood flow; the likely peak is "
                          f"{round(reading['peakM3s'])} m³/s"),
                "titleHi": None, "detail": caveat, "action": None}
    return None


def poll(cfg: dict, fetch: Callable[[str], bytes], today: date) -> tuple[dict, list[dict]]:
    thresholds = load_thresholds(cfg)
    cell = thresholds["cell"]
    data = json.loads(fetch(FLOOD_URL.format(lat=round(cell["latitude"], 3), lon=round(cell["longitude"], 3))))
    reading = reading_from(data, thresholds, cfg, today)
    alert = alert_from(reading, thresholds, cfg)
    return reading, [alert] if alert else []
