from app.simulation.engine import RunRequest, run_simulation


def test_run_simulation_against_scenario_a_normal():
    request = RunRequest(scenario_id="scenario_a_normal", plan_label="baseline")

    result = run_simulation(request)

    assert result.scenario_id == "scenario_a_normal"
    assert result.plan_label == "baseline"
    # Scenario A has 1,500 evacuees (600 + 900) across 3 shelters with
    # 1,800 places (600+700+500) on an all-open graph — everyone should fit,
    # though not everyone necessarily resolves before max_ticks.
    assert result.metrics.evacuated_count + result.metrics.unserved_count == 1500
    assert result.metrics.evacuated_count > 0  # the engine actually ran, not a stub


def _comparable(result) -> dict:
    # run_id is a fresh uuid and runtime_ms is wall-clock — everything else
    # must be identical for a fixed seed (PRD §13.3).
    dumped = result.model_dump()
    dumped.pop("run_id")
    dumped["metrics"].pop("runtime_ms")
    return dumped


def test_same_seed_produces_identical_run_result():
    request = RunRequest(scenario_id="scenario_a_normal")

    assert _comparable(run_simulation(request)) == _comparable(run_simulation(request))


def test_different_seed_is_recorded_on_the_result():
    from app.models.schemas import SimulationParams

    result = run_simulation(RunRequest(
        scenario_id="scenario_a_normal",
        params=SimulationParams(tick_seconds=30, max_ticks=240, random_seed=7),
    ))

    assert result.random_seed == 7


def test_simulate_does_not_mutate_input_scenario():
    # PRD §5.1 Journey A: "Resetting restores the initial state without
    # duplicating agents" holds by construction only if simulate() never
    # writes to the scenario it was given.
    from app.routing.assignment import assign_shelters_and_routes
    from app.routing.congestion import CongestionModel
    from app.routing.graph import build_graph
    from app.services.scenario_store import get_scenario
    from app.simulation.engine import simulate

    scenario = get_scenario("scenario_a_normal")
    before = scenario.model_dump()
    params = scenario.default_params
    plans = assign_shelters_and_routes(scenario, build_graph(scenario), params.random_seed)

    simulate(scenario, plans, params, CongestionModel(scenario, params), plan_label="baseline")

    assert scenario.shelters[0].occupied == 0
    assert scenario.model_dump() == before
