"""Live road traffic from TomTom's Flow Segment Data API: the current and
free-flow speed of the road nearest a point.

It measures vehicles, not people on foot. AEGIS uses the share of free-flow
speed left as the share of a road's capacity left for evacuees on foot (a
disclosed assumption), and only on roads TomTom actually covers."""
from __future__ import annotations

import json
import math
from collections.abc import Callable

FLOW_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point={lat},{lon}&unit=KMPH&key={key}"


def _metres_to_polyline(point: list[float], line: list[tuple[float, float]]) -> float:
    lat0 = math.radians(point[0])

    def xy(p):  # local flat projection around `point`, in metres
        return ((p[1] - point[1]) * 111_320 * math.cos(lat0), (p[0] - point[0]) * 111_320)

    best = math.inf
    for a, b in zip(line, line[1:]):
        (ax, ay), (bx, by) = xy(a), xy(b)
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def reading_from_flow(section: dict, data: dict, cfg: dict) -> dict:
    flow = data["flowSegmentData"]
    line = [(c["latitude"], c["longitude"]) for c in flow["coordinates"]["coordinate"]]
    snap = _metres_to_polyline(section["point"], line) if len(line) > 1 else math.inf
    free = flow["freeFlowSpeed"] or 0
    ratio = round(min(1.0, flow["currentSpeed"] / free), 2) if free else 1.0
    usable = flow.get("confidence", 0) >= cfg["minConfidence"] and snap <= cfg["maxSnapMetres"]
    return {"sectionId": section["id"], "name": section["name"], "edgeIds": section["edgeIds"],
            "currentSpeed": flow["currentSpeed"], "freeFlowSpeed": free, "ratio": ratio,
            "closed": bool(flow.get("roadClosure")), "confidence": flow.get("confidence"),
            "snapMetres": round(snap), "usable": usable}


def alert_from_reading(section: dict, reading: dict, cfg: dict) -> dict | None:
    if not reading["usable"]:
        return None
    edges = section["edgeIds"]
    roads = ", ".join(edges)
    base = {"id": f"traffic:{section['id']}", "source": "traffic", "isDemo": False, "edgeIds": edges,
            "area": f"{section['name']} (roads {roads})", "link": None, "expiresAt": None}
    if reading["closed"]:
        return {**base, "severity": "severe",
                "title": f"{section['name']} reported closed",
                "titleHi": f"{section['name']} बंद बताया गया (सड़क {roads})",
                "detail": "TomTom reports this road closed to traffic.",
                "action": {"label": f"Close {roads} in the Scenario Lab", "closedEdgeIds": edges}}
    ratio = reading["ratio"]
    if ratio >= cfg["warningBelow"]:
        return None
    # The share of capacity left, to the nearest quarter, never below a quarter:
    # a road at a standstill for cars still lets people walk along its edge.
    factor = max(0.25, round(ratio * 4) / 4)
    speeds = f"{reading['currentSpeed']:g} km/h against {reading['freeFlowSpeed']:g} km/h usually"
    return {**base, "severity": "severe" if ratio < cfg["severeBelow"] else "warning",
            "title": f"{section['name']} jammed: {speeds} ({ratio:.0%})",
            "titleHi": f"{section['name']} पर जाम: सामान्य {reading['freeFlowSpeed']:g} की जगह {reading['currentSpeed']:g} किमी/घंटा",
            "detail": (f"Live traffic from TomTom (confidence {reading['confidence']}). Applied as {factor:.0%} of the "
                       "road's capacity for people on foot, an assumption: TomTom measures vehicles."),
            "action": {"label": f"Set {roads} to {factor:.0%} capacity", "edgeCapacityFactors": {e: factor for e in edges}}}


def poll(cfg: dict, key: str, fetch: Callable[[str], bytes]) -> tuple[list[dict], list[dict]]:
    """(readings for every covered section, alerts for the jammed ones)."""
    readings, alerts = [], []
    for section in cfg["sections"]:
        lat, lon = section["point"]
        reading = reading_from_flow(section, json.loads(fetch(FLOW_URL.format(lat=lat, lon=lon, key=key))), cfg)
        readings.append(reading)
        alert = alert_from_reading(section, reading, cfg)
        if alert:
            alerts.append(alert)
    return readings, alerts
