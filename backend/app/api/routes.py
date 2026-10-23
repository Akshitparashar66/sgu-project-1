from fastapi import APIRouter

from app.api.errors import AegisError
from app.models.schemas import ComparisonResult, RunResult, ScenarioConfig
from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.services.comparison import CompareRequest, compare_runs
from app.services.scenario_store import get_scenario, list_scenarios
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


@router.get("/scenarios/{scenario_id}", response_model=ScenarioConfig)
def scenario_detail(scenario_id: str) -> ScenarioConfig:
    scenario = get_scenario(scenario_id)
    if scenario is None:
        raise _scenario_not_found(scenario_id)
    return scenario


@router.post("/simulations/run", response_model=RunResult)
def run(request: RunRequest) -> RunResult:
    try:
        return run_simulation(request)
    except ValueError as exc:
        raise AegisError("SCENARIO_NOT_FOUND", str(exc), field="scenario_id", status_code=404) from exc


@router.post("/optimization/plan")
def optimize(request: OptimizationRequest) -> dict:
    if get_scenario(request.scenario_id) is None:
        raise _scenario_not_found(request.scenario_id)
    return generate_alternative_plan(request)


@router.post("/simulations/compare", response_model=ComparisonResult)
def compare(request: CompareRequest) -> ComparisonResult:
    return compare_runs(request)
