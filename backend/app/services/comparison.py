from __future__ import annotations

from app.models.schemas import CamelModel, ComparisonResult, MetricComparison, RunResult

# (python_field_name, display_label, higher_is_better)
_METRICS: list[tuple[str, str, bool]] = [
    ("evacuated_count", "Evacuated agents", True),
    ("unserved_count", "Unserved agents", False),
    ("max_congestion_ratio", "Peak congestion ratio", False),
    ("runtime_ms", "Simulation runtime (ms)", False),
]


class CompareRequest(CamelModel):
    baseline_run: RunResult
    alternative_run: RunResult


def _metric_comparison(baseline: RunResult, alternative: RunResult, field: str, label: str, higher_is_better: bool) -> tuple[MetricComparison, str | None]:
    base_value = float(getattr(baseline.metrics, field))
    alt_value = float(getattr(alternative.metrics, field))
    absolute_diff = alt_value - base_value

    warning = None
    if base_value == 0:
        percent_diff = None
        warning = f"'{label}' baseline is 0 — percentage change is undefined"
    else:
        percent_diff = (absolute_diff / base_value) * 100

    improved = None if absolute_diff == 0 else ((absolute_diff > 0) if higher_is_better else (absolute_diff < 0))

    return (
        MetricComparison(metric_name=label, baseline_value=base_value, alternative_value=alt_value,
                           absolute_diff=absolute_diff, percent_diff=percent_diff, improved=improved),
        warning,
    )


def compare_runs(request: CompareRequest) -> ComparisonResult:
    baseline, alternative = request.baseline_run, request.alternative_run
    comparisons: list[MetricComparison] = []
    warnings: list[str] = []

    for field, label, higher_is_better in _METRICS:
        comparison, warning = _metric_comparison(baseline, alternative, field, label, higher_is_better)
        comparisons.append(comparison)
        if warning:
            warnings.append(warning)

    base_completion = baseline.metrics.completion_tick
    alt_completion = alternative.metrics.completion_tick
    if base_completion is None or alt_completion is None:
        warnings.append(
            "Completion time is not comparable — at least one run hit its tick limit "
            "before every agent resolved."
        )
    else:
        absolute_diff = float(alt_completion - base_completion)
        percent_diff = (absolute_diff / base_completion * 100) if base_completion != 0 else None
        comparisons.append(MetricComparison(
            metric_name="Completion tick", baseline_value=float(base_completion),
            alternative_value=float(alt_completion), absolute_diff=absolute_diff,
            percent_diff=percent_diff, improved=(absolute_diff < 0) if absolute_diff != 0 else None,
        ))

    if baseline.random_seed != alternative.random_seed:
        warnings.append(
            f"Runs used different random seeds ({baseline.random_seed} vs "
            f"{alternative.random_seed}) — differences may not be solely due to the plan change."
        )

    return ComparisonResult(
        baseline_run_id=baseline.run_id, alternative_run_id=alternative.run_id,
        metrics=comparisons, warnings=warnings,
    )
