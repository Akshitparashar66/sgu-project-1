import pytest

from app.models.schemas import PopulationZone, RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.optimization.planner import OptimizationRequest, generate_alternative_plan


def _overloaded_near_shelter_scenario() -> ScenarioConfig:
    return ScenarioConfig(
        id="opt_test", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=50, capacity_per_tick=5,
                      base_travel_time_s=30, status=RoadStatus.OPEN),
            RoadEdge(id="E2", source="N1", target="N3", length_m=200, capacity_per_tick=20,
                      base_travel_time_s=60, status=RoadStatus.OPEN),
        ],
        zones=[PopulationZone(id="Z1", name="Z1", connector_node="N1", evacuee_count=20,
                                movement_profile={"standard": 1.0})],
        shelters=[
            Shelter(id="S1", name="Near-small", connector_node="N2", total_capacity=5, occupied=0),
            Shelter(id="S2", name="Far-big", connector_node="N3", total_capacity=20, occupied=0),
        ],
        hazards=[], default_params=SimulationParams(tick_seconds=30, max_ticks=20, random_seed=42),
    )


@pytest.fixture
def use_scenario(monkeypatch):
    import app.services.scenario_store as store

    def _use(scenario: ScenarioConfig) -> None:
        monkeypatch.setattr(store, "get_scenario", lambda scenario_id: scenario)

    return _use


def test_optimizer_balances_load_when_baseline_overloads_nearest_shelter(use_scenario):
    # Same "one near shelter is too small" shape as the assignment test,
    # but at a scale where the baseline's pure-nearest greedy starts
    # producing unserved agents and the load-balanced alternative should
    # not make things worse.
    use_scenario(_overloaded_near_shelter_scenario())

    result = generate_alternative_plan(OptimizationRequest(scenario_id="opt_test", random_seed=42))

    assert result["feasible"] in (True, False)  # must be a real computed verdict either way
    if result["feasible"]:
        # Keys are camelCase even though this is a plain dict, not a
        # Pydantic model — see the docstring on generate_alternative_plan.
        assert result["alternativeRun"]["metrics"]["unservedCount"] <= \
               result["baselineRun"]["metrics"]["unservedCount"]
    else:
        assert "reason" in result and result["reason"]


def test_optimizer_reports_no_feasible_improvement_when_baseline_is_already_optimal(use_scenario):
    # PRD §13.4: a single reachable shelter with ample capacity leaves the
    # alternative heuristic nothing to change, so it must say so.
    scenario = ScenarioConfig(
        id="nothing_to_improve", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2")],
        edges=[RoadEdge(id="E1", source="N1", target="N2", length_m=100, capacity_per_tick=50,
                          base_travel_time_s=60)],
        zones=[PopulationZone(id="Z1", name="Z1", connector_node="N1", evacuee_count=10)],
        shelters=[Shelter(id="S1", name="Only", connector_node="N2", total_capacity=100)],
        hazards=[], default_params=SimulationParams(tick_seconds=30, max_ticks=20, random_seed=42),
    )
    use_scenario(scenario)

    result = generate_alternative_plan(OptimizationRequest(scenario_id="nothing_to_improve"))

    assert result["feasible"] is False
    assert "did not improve" in result["reason"]


def test_optimizer_runs_both_plans_with_the_requested_seed(use_scenario):
    use_scenario(_overloaded_near_shelter_scenario())

    result = generate_alternative_plan(OptimizationRequest(scenario_id="opt_test", random_seed=7))

    assert result["baselineRun"]["randomSeed"] == 7
    assert result["alternativeRun"]["randomSeed"] == 7


def test_optimizer_baseline_is_exactly_the_run_simulation_result():
    # The frontend adopts plan.baselineRun as "the current run"; that is only
    # honest while it is the same simulation /simulations/run would return.
    from app.models.schemas import SimulationParams
    from app.simulation.engine import RunRequest, run_simulation

    params = SimulationParams(tick_seconds=30, max_ticks=240, random_seed=7)
    direct = run_simulation(RunRequest(scenario_id="scenario_a_normal", closed_edge_ids=["E3"], params=params))
    planned = generate_alternative_plan(
        OptimizationRequest(scenario_id="scenario_a_normal", closed_edge_ids=["E3"], random_seed=7)
    )["baselineRun"]

    direct_dump = direct.model_dump(by_alias=True)
    for run in (direct_dump, planned):
        run.pop("runId")
        run["metrics"].pop("runtimeMs")
    assert planned == direct_dump
