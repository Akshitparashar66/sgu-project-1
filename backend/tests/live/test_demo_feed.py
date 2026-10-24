from datetime import datetime, timedelta, timezone

from app.live.config import load_config
from app.live.sources import demo

CFG = load_config()["demo"]
T0 = datetime(2026, 10, 24, 9, 0, tzinfo=timezone.utc)


def at(seconds: int) -> list[dict]:
    return demo.alerts_at(T0, T0 + timedelta(seconds=seconds), CFG)


def test_the_flood_day_unfolds_in_order_and_every_alert_says_demo():
    assert [a["id"] for a in at(0)] == ["demo:imd-rain"]
    assert [a["id"] for a in at(35)] == ["demo:imd-rain", "demo:river-warning"]
    assert [a["id"] for a in at(65)] == ["demo:imd-rain", "demo:river-danger"]  # danger replaces warning
    assert [a["id"] for a in at(95)] == ["demo:imd-rain", "demo:river-danger", "demo:traffic-nh9-bypass"]
    for a in at(95):
        assert a["isDemo"] and a["title"].startswith("DEMO") and a["source"] == "demo"


def test_the_demo_jam_offers_the_same_what_if_a_real_one_would():
    jam = at(95)[-1]
    assert jam["severity"] == "severe"
    assert jam["action"]["edgeCapacityFactors"] == {"E1": 0.25, "E4": 0.25}
    river = at(65)[1]
    assert river["action"]["scenarioId"] == "scenario_d_hindon_flood"
    assert river["marksHazard"] and not jam.get("marksHazard")
    assert "at 14:31 IST, 24 Oct" in river["detail"]  # 09:01 UTC, read as local time
