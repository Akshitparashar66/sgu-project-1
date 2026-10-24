from fastapi import APIRouter, Body
from pydantic import ValidationError

from app.api.errors import AegisError, validation_errors_to_fields
from app.ml.surrogate import predict_outcome
from app.models.schemas import ComparisonResult, RunResult, ScenarioConfig
from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.services.comparison import CompareRequest, compare_runs
from app.services.scenario_import import ImportRequest, ScenarioImportError, import_scenario
from app.services.scenario_overrides import InvalidOverrideError, WhatIfOverrides
from app.services.scenario_store import get_scenario, list_scenarios
from app.services.weak_points import weak_points
from app.services.river import GaugeNotFound, ReadingRequest, ThresholdsRequest, add_reading, river_status, set_thresholds
from app.services.plan_store import (
    ApproveRequest, PlanNotFound, PlanTampered, SavePlanRequest, approve_plan, audit_log, get_plan, list_plans, save_plan,
)
from app.services.scenario_validation import reference_errors, scenario_summary
from app.simulation.engine import RunRequest, run_simulation

router = APIRouter(prefix="/api")


def _scenario_not_found(scenario_id: str) -> AegisError:
    return AegisError("SCENARIO_NOT_FOUND", f"Unknown scenario_id '{scenario_id}'",
                      field="scenario_id", status_code=404)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0-mvp"}


@router.get("/scenarios")
def scenarios() -> list[dict]:
    return [
        {"id": s.id, "name": s.name, "description": s.description, "synthetic": s.synthetic}
        for s in list_scenarios()
    ]


def _invalid_scenario(errors: list[dict]) -> AegisError:
    first = errors[0]
    return AegisError(
        "VALIDATION_ERROR",
        f"Scenario has {len(errors)} validation error(s); first: {first['field']} — {first['message']}",
        field=first["field"], status_code=422, errors=errors,
    )


@router.post("/scenarios/validate")
def validate_scenario(body: dict = Body(...)) -> dict:
    """PRD §10.4: check a candidate scenario without saving or running it.
    Takes a raw dict (not ScenarioConfig) so Pydantic's errors come back
    through AegisError's actionable [{field, message}] list instead of
    FastAPI's generic request-validation shape."""
    try:
        scenario = ScenarioConfig.model_validate(body)
    except ValidationError as exc:
        raise _invalid_scenario(validation_errors_to_fields(exc.errors())) from exc
    errors = reference_errors(scenario)
    if errors:
        raise _invalid_scenario(errors)
    return {"valid": True, "scenarioId": scenario.id, "summary": scenario_summary(scenario)}


@router.post("/scenarios/import")
def import_data(request: ImportRequest) -> dict:
    """Build a scenario from a planner's own zones and/or shelters (CSV) on an
    existing scenario's street network, save it, and return its id."""
    base = get_scenario(request.base_scenario_id)
    if base is None:
        raise _scenario_not_found(request.base_scenario_id)
    try:
        return import_scenario(request, base)
    except ScenarioImportError as exc:
        raise AegisError("VALIDATION_ERROR", str(exc), field=exc.errors[0]["field"], status_code=422,
                         errors=exc.errors) from exc


@router.get("/scenarios/{scenario_id}", response_model=ScenarioConfig)
def scenario_detail(scenario_id: str) -> ScenarioConfig:
    scenario = get_scenario(scenario_id)
    if scenario is None:
        raise _scenario_not_found(scenario_id)
    return scenario


def _invalid_override(exc: InvalidOverrideError) -> AegisError:
    return AegisError("INVALID_OVERRIDE", str(exc), field=exc.field, status_code=400)


@router.post("/simulations/run", response_model=RunResult)
def run(request: RunRequest) -> RunResult:
    try:
        return run_simulation(request)
    except InvalidOverrideError as exc:  # a ValueError subclass — must be caught first
        raise _invalid_override(exc) from exc
    except ValueError as exc:
        raise AegisError("SCENARIO_NOT_FOUND", str(exc), field="scenario_id", status_code=404) from exc


@router.post("/optimization/plan")
def optimize(request: OptimizationRequest) -> dict:
    if get_scenario(request.scenario_id) is None:
        raise _scenario_not_found(request.scenario_id)
    try:
        return generate_alternative_plan(request)
    except InvalidOverrideError as exc:
        raise _invalid_override(exc) from exc


@router.post("/simulations/compare", response_model=ComparisonResult)
def compare(request: CompareRequest) -> ComparisonResult:
    return compare_runs(request)



class PredictRequest(WhatIfOverrides):
    scenario_id: str
    # Same seed as the run being estimated; the scenario default when omitted.
    random_seed: int | None = None


@router.post("/predict")
def predict(request: PredictRequest) -> dict:
    """Instant machine-learning estimate of a run's headline numbers for the
    current what-if changes, shown while the planner edits. Running the
    simulation gives the real numbers."""
    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        raise _scenario_not_found(request.scenario_id)
    try:
        scenario = request.apply_to(scenario)
    except InvalidOverrideError as exc:
        raise _invalid_override(exc) from exc
    return predict_outcome(scenario, request.random_seed)


class WeakPointsRequest(WhatIfOverrides):
    scenario_id: str
    random_seed: int | None = None


@router.post("/analysis/weak-points")
def analyse_weak_points(request: WeakPointsRequest) -> dict:
    """Which single road or shelter loss would hurt the current setup most."""
    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        raise _scenario_not_found(request.scenario_id)
    try:
        scenario = request.apply_to(scenario)
    except InvalidOverrideError as exc:
        raise _invalid_override(exc) from exc
    params = scenario.default_params
    if request.random_seed is not None:
        params = params.model_copy(update={"random_seed": request.random_seed})
    return weak_points(scenario, params)


def _plan_not_found(plan_id: str) -> AegisError:
    return AegisError("PLAN_NOT_FOUND", f"No saved plan '{plan_id}'", field="plan_id", status_code=404)


@router.post("/plans")
def save(request: SavePlanRequest) -> dict:
    """Save the optimized plan for these inputs as a new version, for review and approval."""
    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        raise _scenario_not_found(request.scenario_id)
    try:
        return save_plan(request, scenario)
    except InvalidOverrideError as exc:
        raise _invalid_override(exc) from exc


@router.get("/plans")
def saved_plans() -> list[dict]:
    return list_plans()


@router.get("/plans/audit")
def plans_audit() -> list[dict]:
    """Every save and approval, newest first."""
    return audit_log()


@router.get("/plans/{plan_id}")
def saved_plan(plan_id: str) -> dict:
    try:
        return get_plan(plan_id)
    except PlanNotFound as exc:
        raise _plan_not_found(plan_id) from exc


@router.post("/plans/{plan_id}/approve")
def approve(plan_id: str, request: ApproveRequest) -> dict:
    try:
        return approve_plan(plan_id, request)
    except PlanNotFound as exc:
        raise _plan_not_found(plan_id) from exc
    except PlanTampered as exc:
        raise AegisError("PLAN_MODIFIED", str(exc), field="plan_id", status_code=409) from exc


def _gauge_not_found(gauge_id: str) -> AegisError:
    return AegisError("GAUGE_NOT_FOUND", f"No river gauge '{gauge_id}'", field="gauge_id", status_code=404)


@router.get("/river")
def river() -> dict:
    """River gauges: latest level, status against the district's thresholds,
    and a flood-scenario suggestion at warning level or above."""
    return river_status()


@router.post("/river/{gauge_id}/reading")
def river_reading(gauge_id: str, request: ReadingRequest) -> dict:
    try:
        return add_reading(gauge_id, request)
    except GaugeNotFound as exc:
        raise _gauge_not_found(gauge_id) from exc


@router.post("/river/{gauge_id}/thresholds")
def river_thresholds(gauge_id: str, request: ThresholdsRequest) -> dict:
    try:
        return set_thresholds(gauge_id, request)
    except GaugeNotFound as exc:
        raise _gauge_not_found(gauge_id) from exc
