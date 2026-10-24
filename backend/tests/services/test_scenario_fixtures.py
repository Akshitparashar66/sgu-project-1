from pathlib import Path

from app.models.schemas import RoadStatus, ScenarioConfig

SCENARIOS_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"


def _load(scenario_id: str) -> ScenarioConfig:
    return ScenarioConfig.model_validate_json((SCENARIOS_DIR / f"{scenario_id}.json").read_text(encoding="utf-8"))


def test_scenario_a_is_fully_open_and_all_shelters_available():
    scenario = _load("scenario_a_normal")
    assert all(e.status == RoadStatus.OPEN for e in scenario.edges)
    assert all(s.available for s in scenario.shelters if not s.standby)
    # The standby hall is for the optimizer to open, never part of the default plan.
    assert [s.id for s in scenario.shelters if s.standby and not s.available] == ["S4"]


def test_scenario_b_closes_exactly_the_critical_bridge_and_nothing_else():
    scenario = _load("scenario_b_bridge_closure")
    closed_ids = [e.id for e in scenario.edges if e.status == RoadStatus.CLOSED]
    assert closed_ids == ["E3"]

    a_edges = {e.id: e.status for e in _load("scenario_a_normal").edges if e.id != "E3"}
    b_edges = {e.id: e.status for e in scenario.edges if e.id != "E3"}
    assert a_edges == b_edges


def test_scenario_c_shrinks_exactly_one_shelter_and_nothing_else():
    scenario = _load("scenario_c_shelter_shortage")
    s1 = next(s for s in scenario.shelters if s.id == "S1")
    assert s1.total_capacity == 80

    a_shelters = {s.id: s.total_capacity for s in _load("scenario_a_normal").shelters if s.id != "S1"}
    c_shelters = {s.id: s.total_capacity for s in scenario.shelters if s.id != "S1"}
    assert a_shelters == c_shelters

    a_edges = [e.status for e in _load("scenario_a_normal").edges]
    c_edges = [e.status for e in scenario.edges]
    assert a_edges == c_edges  # Scenario C changes ONLY shelter capacity, not roads
