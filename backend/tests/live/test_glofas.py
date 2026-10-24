"""The Hindon flow forecast (GloFAS via Open-Meteo), on a saved real response
from 2026-10-24 (about 14 m3/s, far below any flood level) and copies of it
with the forecast raised past each threshold."""
import copy
import json
from datetime import date
from pathlib import Path

from app.live.config import load_config
from app.live.sources import glofas

CFG = load_config()["glofas"]
THRESHOLDS = glofas.load_thresholds(CFG)
REAL = json.loads((Path(__file__).parent / "fixtures" / "glofas_hindon_2026-10-24.json").read_text(encoding="utf-8"))
TODAY = date(2026, 10, 24)


def with_median(day_index: int, flow: float, high: float | None = None) -> dict:
    data = copy.deepcopy(REAL)
    data["daily"]["river_discharge_median"][day_index] = flow
    data["daily"]["river_discharge_max"][day_index] = high if high is not None else flow
    return data


def test_the_thresholds_are_the_committed_return_period_flows():
    assert THRESHOLDS["thresholdsM3s"] == {"warning": 232, "severe": 457, "extreme": 750}
    assert THRESHOLDS["yearCount"] == 29 and "2023" in THRESHOLDS["knownMiss"]


def test_todays_real_forecast_is_a_reading_but_not_an_alert():
    reading = glofas.reading_from(REAL, THRESHOLDS, CFG, TODAY)
    assert reading["todayM3s"] == 13.89 and reading["peakDate"] >= "2026-10-24"
    assert reading["peakM3s"] < 20 and reading["level"] == "normal"
    assert reading["thresholdsM3s"]["warning"] == 232
    assert glofas.alert_from(reading, THRESHOLDS, CFG) is None


def test_a_forecast_above_the_2_and_5_year_flows_raises_warning_then_severe():
    warning = glofas.reading_from(with_median(5, 300), THRESHOLDS, CFG, TODAY)
    alert = glofas.alert_from(warning, THRESHOLDS, CFG)
    assert alert["id"] == "glofas:hindon" and alert["severity"] == "warning"
    assert "300 m³/s" in alert["title"] and "2-year" in alert["title"] and "28 Oct" in alert["title"]
    assert alert["marksHazard"] and alert["action"]["scenarioId"] == "scenario_d_hindon_flood"
    assert "not a gauge" in alert["detail"] and alert["titleHi"]

    severe = glofas.alert_from(glofas.reading_from(with_median(6, 500), THRESHOLDS, CFG, TODAY), THRESHOLDS, CFG)
    assert severe["severity"] == "severe" and "5-year" in severe["title"]


def test_only_the_next_seven_days_count_and_past_days_are_ignored():
    beyond = glofas.reading_from(with_median(9, 900), THRESHOLDS, CFG, TODAY)  # 1 Nov: 8 days out
    assert beyond["level"] == "normal"
    yesterday = glofas.reading_from(with_median(0, 900), THRESHOLDS, CFG, TODAY)
    assert yesterday["level"] == "normal"


def test_when_only_the_wettest_forecasts_cross_it_is_information_only():
    reading = glofas.reading_from(with_median(4, 100, high=260), THRESHOLDS, CFG, TODAY)
    alert = glofas.alert_from(reading, THRESHOLDS, CFG)
    assert alert["severity"] == "info" and "some forecasts" in alert["title"].lower()
    assert alert["action"] is None


def test_polling_asks_for_the_hindon_cell_once():
    asked = []

    def fetch(url: str) -> bytes:
        asked.append(url)
        return json.dumps(REAL).encode()

    reading, alerts = glofas.poll(CFG, fetch, TODAY)
    assert len(asked) == 1 and "latitude=28.675" in asked[0] and "longitude=77.375" in asked[0]
    assert alerts == [] and reading["level"] == "normal"
