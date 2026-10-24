from app.models.schemas import RunMetrics, RunResult
from app.services.comparison import CompareRequest, compare_runs


def _run(run_id: str, evacuated: int, unserved: int, completion_tick: int | None,
          hit_tick_limit: bool, congestion: float, seed: int = 42) -> RunResult:
    return RunResult(
        run_id=run_id, scenario_id="s", plan_label="baseline", random_seed=seed,
        metrics=RunMetrics(evacuated_count=evacuated, unserved_count=unserved,
                             completion_tick=completion_tick, hit_tick_limit=hit_tick_limit,
                             max_congestion_ratio=congestion, runtime_ms=1.0),
        agents=[], shelters=[], congestion=[], warnings=[],
    )


def test_undefined_percent_when_baseline_metric_is_zero():
    baseline = _run("b1", evacuated=0, unserved=0, completion_tick=0, hit_tick_limit=False, congestion=0.0)
    alternative = _run("a1", evacuated=5, unserved=0, completion_tick=10, hit_tick_limit=False, congestion=0.5)

    result = compare_runs(CompareRequest(baseline_run=baseline, alternative_run=alternative))

    evacuated_metric = next(m for m in result.metrics if m.metric_name == "Evacuated agents")
    assert evacuated_metric.percent_diff is None
    assert any("baseline is 0" in w for w in result.warnings)


def test_flags_mismatched_random_seeds():
    baseline = _run("b1", evacuated=10, unserved=0, completion_tick=5, hit_tick_limit=False, congestion=0.5, seed=1)
    alternative = _run("a1", evacuated=10, unserved=0, completion_tick=5, hit_tick_limit=False, congestion=0.5, seed=2)

    result = compare_runs(CompareRequest(baseline_run=baseline, alternative_run=alternative))

    assert any("different random seeds" in w for w in result.warnings)


def test_completion_time_marked_incomparable_when_either_run_hit_the_limit():
    baseline = _run("b1", evacuated=10, unserved=0, completion_tick=None, hit_tick_limit=True, congestion=0.5)
    alternative = _run("a1", evacuated=10, unserved=0, completion_tick=8, hit_tick_limit=False, congestion=0.5)

    result = compare_runs(CompareRequest(baseline_run=baseline, alternative_run=alternative))

    assert any("not comparable" in w for w in result.warnings)
    assert not any(m.metric_name.startswith("Clearance time") for m in result.metrics)


def test_lower_unserved_in_alternative_is_reported_as_improved():
    baseline = _run("b1", evacuated=90, unserved=10, completion_tick=50, hit_tick_limit=False, congestion=1.0)
    alternative = _run("a1", evacuated=100, unserved=0, completion_tick=45, hit_tick_limit=False, congestion=0.8)

    result = compare_runs(CompareRequest(baseline_run=baseline, alternative_run=alternative))

    unserved_metric = next(m for m in result.metrics if m.metric_name == "Unserved agents")
    assert unserved_metric.improved is True
    assert unserved_metric.absolute_diff == -10


def test_time_metrics_are_reported_in_minutes_when_the_tick_length_is_known():
    baseline = _run("b1", evacuated=10, unserved=0, completion_tick=40, hit_tick_limit=False, congestion=1.0)
    alternative = _run("a1", evacuated=10, unserved=0, completion_tick=20, hit_tick_limit=False, congestion=1.0)

    result = compare_runs(CompareRequest(baseline_run=baseline, alternative_run=alternative, tick_seconds=30))

    clearance = next(m for m in result.metrics if m.metric_name == "Clearance time (min)")
    assert (clearance.baseline_value, clearance.alternative_value, clearance.improved) == (20.0, 10.0, True)
