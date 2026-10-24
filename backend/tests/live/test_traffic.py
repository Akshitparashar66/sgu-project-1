"""TomTom flow → road alerts, on a saved real response (Gaur Cascades Rd at
free flow, 2026-10-24) and copies of it with the speed or closure changed."""
import copy
import json
from pathlib import Path

from app.live.config import load_config
from app.live.sources import traffic

CFG = load_config()["traffic"]
GAUR = next(s for s in CFG["sections"] if s["id"] == "gaur-cascades")
REAL = json.loads((Path(__file__).parent / "fixtures" / "tomtom_gaur_cascades_free_flow.json").read_text(encoding="utf-8"))


def with_flow(current: float, closure: bool = False, confidence: float = 1.0) -> dict:
    data = copy.deepcopy(REAL)
    data["flowSegmentData"].update(currentSpeed=current, roadClosure=closure, confidence=confidence)
    return data


def test_free_flow_is_a_reading_but_not_an_alert():
    reading = traffic.reading_from_flow(GAUR, REAL, CFG)
    assert reading["ratio"] == 1.0 and reading["edgeIds"] == ["E2", "E3"] and reading["usable"]
    assert traffic.alert_from_reading(GAUR, reading, CFG) is None


def test_slow_traffic_becomes_a_warning_and_offers_reduced_capacity():
    reading = traffic.reading_from_flow(GAUR, with_flow(12), CFG)  # 12 of 26 km/h = 0.46
    alert = traffic.alert_from_reading(GAUR, reading, CFG)
    assert alert["id"] == "traffic:gaur-cascades" and alert["severity"] == "warning"
    assert alert["action"]["edgeCapacityFactors"] == {"E2": 0.5, "E3": 0.5}
    assert "12 km/h" in alert["title"] and alert["titleHi"]


def test_a_near_standstill_is_severe_and_never_below_a_quarter_capacity():
    alert = traffic.alert_from_reading(GAUR, traffic.reading_from_flow(GAUR, with_flow(3), CFG), CFG)
    assert alert["severity"] == "severe"
    assert alert["action"]["edgeCapacityFactors"] == {"E2": 0.25, "E3": 0.25}


def test_a_road_tomtom_reports_closed_offers_closing_it():
    alert = traffic.alert_from_reading(GAUR, traffic.reading_from_flow(GAUR, with_flow(0, closure=True), CFG), CFG)
    assert alert["severity"] == "severe" and alert["action"]["closedEdgeIds"] == ["E2", "E3"]


def test_low_confidence_or_a_far_away_match_is_not_used():
    unsure = traffic.reading_from_flow(GAUR, with_flow(3, confidence=0.3), CFG)
    assert not unsure["usable"] and traffic.alert_from_reading(GAUR, unsure, CFG) is None
    elsewhere = {**GAUR, "point": [28.69, 77.40]}  # the road TomTom returned is far from where we asked
    assert not traffic.reading_from_flow(elsewhere, with_flow(3), CFG)["usable"]


def test_polling_needs_a_key_and_asks_once_per_section():
    asked = []

    def fetch(url: str) -> bytes:
        asked.append(url)
        lat, lon = (float(v) for v in url.split("point=")[1].split("&")[0].split(","))
        data = with_flow(5)  # a road through the point asked about
        data["flowSegmentData"]["coordinates"]["coordinate"] = [
            {"latitude": lat - 0.001, "longitude": lon}, {"latitude": lat + 0.001, "longitude": lon}]
        return json.dumps(data).encode()

    readings, alerts = traffic.poll(CFG, "test-key", fetch)
    assert len(asked) == len(CFG["sections"]) and all("key=test-key" in u for u in asked)
    assert {a["id"] for a in alerts} == {"traffic:nh9-bypass", "traffic:gaur-cascades"}
    assert {r["sectionId"] for r in readings} == {"nh9-bypass", "gaur-cascades"}
