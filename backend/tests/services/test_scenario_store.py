import json

import pytest

from app.services.scenario_store import get_scenario, list_scenarios

MINIMAL_SCENARIO = {
    "id": "unit_test_scenario", "name": "Unit Test", "description": "", "synthetic": True,
    "nodes": [{"id": "N1", "lat": 0, "lon": 0}, {"id": "N2", "lat": 0, "lon": 0}],
    "edges": [{"id": "E1", "source": "N1", "target": "N2", "length_m": 10, "capacity_per_tick": 5,
                "base_travel_time_s": 10, "status": "open", "hazard_risk": 0}],
    "zones": [],
    "shelters": [{"id": "S1", "name": "S1", "connector_node": "N2", "total_capacity": 10,
                    "occupied": 0, "available": True}],
    "hazards": [],
    "default_params": {"tick_seconds": 30, "max_ticks": 10, "random_seed": 1},
}


@pytest.fixture
def scenarios_dir(tmp_path, monkeypatch):
    (tmp_path / "unit_test_scenario.json").write_text(json.dumps(MINIMAL_SCENARIO))
    monkeypatch.setenv("AEGIS_SCENARIOS_DIR", str(tmp_path))
    yield tmp_path


def test_list_scenarios_returns_every_json_file(scenarios_dir):
    scenarios = list_scenarios()
    assert len(scenarios) == 1
    assert scenarios[0].id == "unit_test_scenario"


def test_get_scenario_returns_none_for_unknown_id(scenarios_dir):
    assert get_scenario("does_not_exist") is None


def test_get_scenario_returns_the_matching_scenario(scenarios_dir):
    scenario = get_scenario("unit_test_scenario")
    assert scenario is not None
    assert scenario.shelters[0].total_capacity == 10
