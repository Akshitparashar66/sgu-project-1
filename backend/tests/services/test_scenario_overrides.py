import pytest

from app.models.schemas import RoadStatus
from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.services.scenario_overrides import InvalidOverrideError, apply_overrides
from app.services.scenario_store import get_scenario
from app.simulation.engine import RunRequest, run_simulation


def test_apply_overrides_closes_edges_and_disables_shelters_on_a_copy():
    scenario = get_scenario("scenario_a_normal")

    overridden = apply_overrides(scenario, closed_edge_ids=["E3"], unavailable_shelter_ids=["S2"])

    assert next(e for e in overridden.edges if e.id == "E3").status == RoadStatus.CLOSED
    assert next(s for s in overridden.shelters if s.id == "S2").available is False
    # The loaded scenario itself is untouched.
    assert next(e for e in scenario.edges if e.id == "E3").status == RoadStatus.OPEN
    assert all(s.available for s in scenario.shelters)


def test_unknown_override_ids_are_rejected_with_the_offending_field():
    scenario = get_scenario("scenario_a_normal")

    with pytest.raises(InvalidOverrideError) as exc_info:
        apply_overrides(scenario, closed_edge_ids=["E99"])
    assert exc_info.value.field == "closedEdgeIds"

    with pytest.raises(InvalidOverrideError) as exc_info:
        apply_overrides(scenario, unavailable_shelter_ids=["S9"])
    assert exc_info.value.field == "unavailableShelterIds"


def test_closing_e3_on_scenario_a_reproduces_scenario_b_exactly():
    # Scenario B is defined as "Scenario A with E3 closed", so a user
    # closing E3 interactively must get the identical simulation.
    interactive = run_simulation(RunRequest(scenario_id="scenario_a_normal", closed_edge_ids=["E3"]))
    fixture = run_simulation(RunRequest(scenario_id="scenario_b_bridge_closure"))

    for field in ("evacuated_count", "unserved_count", "completion_tick", "max_congestion_ratio"):
        assert getattr(interactive.metrics, field) == getattr(fixture.metrics, field)
    assert all("E3" not in a.route_edge_ids for a in interactive.agents)


def test_unavailable_shelter_receives_nobody():
    result = run_simulation(RunRequest(scenario_id="scenario_a_normal", unavailable_shelter_ids=["S1"]))

    assert all(a.assigned_shelter != "S1" for a in result.agents)
    s1 = next(s for s in result.shelters if s.shelter_id == "S1")
    assert s1.final_occupied == 0
    assert result.metrics.unserved_count == 300  # S1's 600 places are gone; S2+S3 hold 1,200 of 1,500


def test_optimizer_honours_the_same_overrides():
    result = generate_alternative_plan(OptimizationRequest(scenario_id="scenario_a_normal", closed_edge_ids=["E3"]))

    for run_key in ("baselineRun", "alternativeRun"):
        assert all("E3" not in a["routeEdgeIds"] for a in result[run_key]["agents"])
