from app.simulation.engine import RunRequest, run_simulation


def test_run_simulation_against_scenario_a_normal():
    request = RunRequest(scenario_id="scenario_a_normal", plan_label="baseline")

    result = run_simulation(request)

    assert result.scenario_id == "scenario_a_normal"
    assert result.plan_label == "baseline"
    # Scenario A has 750 total evacuees (300 + 450) across 3 shelters
    # totalling 750 capacity (250+300+200) on an all-open graph — everyone
    # should fit, though not everyone necessarily resolves before max_ticks.
    assert result.metrics.evacuated_count + result.metrics.unserved_count == 750
    assert result.metrics.evacuated_count > 0  # the engine actually ran, not a stub
