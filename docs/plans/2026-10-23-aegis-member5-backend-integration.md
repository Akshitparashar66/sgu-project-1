# AEGIS — Member 5: Backend & Integration Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The FastAPI app itself (CORS, structured errors), the scenario
file loader every other backend module depends on, the `compare_runs`
service (PRD §10.7), and the typed frontend API client Members 3/4
consume.

**Architecture:** `scenario_store` is a pure file-reading module with no
caching across requests (so a scenario edited on disk mid-demo is picked
up on the next request — useful for live-tweaking fixtures). `compare_runs`
takes two full `RunResult` payloads directly rather than looking up run
IDs from a database, since the PRD's own API spec allows "baseline run ID
*or result*" and the MVP has no run-storage database (master plan global
constraints: "no DB unless required by a concrete feature").

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, pytest,
`fastapi.testclient.TestClient`. TypeScript for the frontend client.

**Spec:** `2026-10-23-aegis-master-plan.md` §3 (all contracts) in this
folder. PRD §10 (API Requirements), §10.8 (Error Handling).

## Global Constraints

- Every endpoint returns structured errors on failure: a stable code, a
  human-readable message, and the relevant field/scenario reference —
  never a bare 500 with a stack trace, never a fabricated 200 success.
- `scenario_store` never caches a scenario across the process lifetime in
  a way that survives editing the JSON file on disk (the team will be
  live-tweaking fixture values during rehearsal).
- CORS must allow the Next.js dev origin (`http://localhost:3000`) — this
  is the single most common "works on my machine, fails in the demo"
  bug, so it's a named task, not an afterthought.

---

### Task 1: `scenario_store` — scenario file loader

**Files:**
- Create: `backend/app/services/scenario_store.py`
- Test: `backend/tests/services/test_scenario_store.py`

**Interfaces:**
- Consumes: `ScenarioConfig` from `app.models.schemas`.
- Produces: `list_scenarios() -> list[ScenarioConfig]`,
  `get_scenario(scenario_id: str) -> ScenarioConfig | None` — Member 1's
  `run_simulation` and Member 2's `generate_alternative_plan` both import
  `get_scenario` by this exact name from this exact module path.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/services/test_scenario_store.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/services/test_scenario_store.py -v`
Expected: `ModuleNotFoundError: No module named 'app.services.scenario_store'`

- [ ] **Step 3: Implement**

```python
# backend/app/services/scenario_store.py
from __future__ import annotations

import os
from pathlib import Path

from app.models.schemas import ScenarioConfig

_DEFAULT_SCENARIOS_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"


def _scenarios_dir() -> Path:
    override = os.environ.get("AEGIS_SCENARIOS_DIR")
    return Path(override) if override else _DEFAULT_SCENARIOS_DIR


def list_scenarios() -> list[ScenarioConfig]:
    """Re-reads the directory every call — no cross-request caching, so a
    fixture edited on disk mid-demo is picked up immediately."""
    directory = _scenarios_dir()
    if not directory.exists():
        return []
    return [
        ScenarioConfig.model_validate_json(path.read_text())
        for path in sorted(directory.glob("*.json"))
    ]


def get_scenario(scenario_id: str) -> ScenarioConfig | None:
    for scenario in list_scenarios():
        if scenario.id == scenario_id:
            return scenario
    return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/services/test_scenario_store.py -v`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/scenario_store.py backend/tests/services/test_scenario_store.py
git commit -m "feat(backend): scenario file loader, re-reads disk on every call"
```

---

### Task 2: FastAPI app, CORS, structured errors, health check

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/app/api/errors.py`
- Modify: `backend/app/api/routes.py` (the master-plan §3.3 version —
  swap the bare `HTTPException` for the new `AegisError`, and catch the
  `ValueError`s Member 1/2's modules raise for an unknown scenario id)
- Test: `backend/tests/api/test_health.py`
- Test: `backend/tests/api/test_errors.py`

**Interfaces:**
- Produces: `app` (the FastAPI instance, importable as `app.main:app` for
  `uvicorn`), `AegisError(code, message, field=None)`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/api/test_health.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_check_returns_ok_and_a_version():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body
```

```python
# backend/tests/api/test_errors.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_unknown_scenario_returns_a_structured_404_error():
    response = client.get("/api/scenarios/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["errorCode"] == "SCENARIO_NOT_FOUND"
    assert "does-not-exist" in body["message"]


def test_run_simulation_with_unknown_scenario_returns_a_structured_error():
    response = client.post("/api/simulations/run", json={"scenarioId": "does-not-exist"})
    assert response.status_code == 404
    body = response.json()
    assert body["errorCode"] == "SCENARIO_NOT_FOUND"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/api/ -v`
Expected: `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement**

```python
# backend/app/api/errors.py
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse


class AegisError(Exception):
    """Every endpoint raises this instead of a bare HTTPException so every
    error on the wire has the same {errorCode, message, field} shape
    (PRD §10.8)."""

    def __init__(self, code: str, message: str, field: str | None = None, status_code: int = 400):
        self.code = code
        self.message = message
        self.field = field
        self.status_code = status_code
        super().__init__(message)


async def aegis_error_handler(request: Request, exc: AegisError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"errorCode": exc.code, "message": exc.message, "field": exc.field},
    )
```

```python
# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import AegisError, aegis_error_handler
from app.api.routes import router

app = FastAPI(title="AEGIS", version="0.1.0-mvp")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AegisError, aegis_error_handler)
app.include_router(router)
```

```python
# backend/app/api/routes.py — replace the file from master plan §3.3 with this version
from fastapi import APIRouter

from app.api.errors import AegisError
from app.models.schemas import ComparisonResult, RunResult, ScenarioConfig
from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.services.comparison import CompareRequest, compare_runs
from app.services.scenario_store import get_scenario, list_scenarios
from app.simulation.engine import RunRequest, run_simulation

router = APIRouter(prefix="/api")


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
        raise AegisError("SCENARIO_NOT_FOUND", f"Unknown scenario_id '{scenario_id}'",
                           field="scenario_id", status_code=404)
    return scenario


@router.post("/simulations/run", response_model=RunResult)
def run(request: RunRequest) -> RunResult:
    try:
        return run_simulation(request)
    except ValueError as exc:
        raise AegisError("SCENARIO_NOT_FOUND", str(exc), field="scenario_id", status_code=404) from exc


@router.post("/optimization/plan")
def optimize(request: OptimizationRequest) -> dict:
    return generate_alternative_plan(request)


@router.post("/simulations/compare", response_model=ComparisonResult)
def compare(request: CompareRequest) -> ComparisonResult:
    return compare_runs(request)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/api/ -v`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/app/api/errors.py backend/app/api/routes.py backend/tests/api/
git commit -m "feat(backend): FastAPI app, CORS for the Next.js dev origin, structured errors"
```

---

### Task 3: `compare_runs`

**Files:**
- Create: `backend/app/services/comparison.py`
- Test: `backend/tests/services/test_comparison.py`

**Interfaces:**
- Consumes: `CamelModel`, `ComparisonResult`, `MetricComparison`,
  `RunResult`, `RunMetrics` from `app.models.schemas`.
- Produces: `CompareRequest` (Pydantic model) and
  `compare_runs(request: CompareRequest) -> ComparisonResult` — exactly
  what `routes.py`'s `compare` endpoint (Task 2) imports.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/services/test_comparison.py
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
    assert not any(m.metric_name == "Completion tick" for m in result.metrics)


def test_lower_unserved_in_alternative_is_reported_as_improved():
    baseline = _run("b1", evacuated=90, unserved=10, completion_tick=50, hit_tick_limit=False, congestion=1.0)
    alternative = _run("a1", evacuated=100, unserved=0, completion_tick=45, hit_tick_limit=False, congestion=0.8)

    result = compare_runs(CompareRequest(baseline_run=baseline, alternative_run=alternative))

    unserved_metric = next(m for m in result.metrics if m.metric_name == "Unserved agents")
    assert unserved_metric.improved is True
    assert unserved_metric.absolute_diff == -10
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/services/test_comparison.py -v`
Expected: `ModuleNotFoundError: No module named 'app.services.comparison'`

- [ ] **Step 3: Implement**

```python
# backend/app/services/comparison.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/services/test_comparison.py -v`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/services/test_comparison.py
git commit -m "feat(backend): honest run comparison — undefined %, mismatched-seed and tick-limit warnings"
```

---

### Task 4: Frontend API client

**Files:**
- Create: `frontend/lib/api/client.ts`
- Test: `frontend/lib/api/client.test.ts`

**Interfaces:**
- Consumes: `ComparisonResult`, `RunResult`, `ScenarioConfig` from
  `@/lib/schemas/types`.
- Produces: `fetchHealth`, `fetchScenarios`, `fetchScenario`,
  `runSimulation`, `generateAlternativePlan`, `compareRuns` — Member 4's
  dashboard page and Member 3's map-data-loading both import these.

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/lib/api/client.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchScenario, runSimulation } from "./client";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("apiFetch error handling", () => {
  it("throws a readable error using the backend's structured error message", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ errorCode: "SCENARIO_NOT_FOUND", message: "Unknown scenario_id 'nope'" }),
    } as Response);

    await expect(fetchScenario("nope")).rejects.toThrow("Unknown scenario_id 'nope'");
  });

  it("returns the parsed JSON on success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true, json: async () => ({ runId: "r1" }),
    } as Response);

    const result = await runSimulation({ scenarioId: "scenario_a_normal" });
    expect(result).toEqual({ runId: "r1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run lib/api/client.test.ts`
Expected: `Cannot find module './client'`

- [ ] **Step 3: Implement**

```typescript
// frontend/lib/api/client.ts
import type { ComparisonResult, RunResult, ScenarioConfig } from "@/lib/schemas/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request to ${path} failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  synthetic: boolean;
}

export const fetchHealth = () => apiFetch<{ status: string; version: string }>("/api/health");

export const fetchScenarios = () => apiFetch<ScenarioSummary[]>("/api/scenarios");

export const fetchScenario = (scenarioId: string) =>
  apiFetch<ScenarioConfig>(`/api/scenarios/${scenarioId}`);

export const runSimulation = (request: { scenarioId: string; planLabel?: string }) =>
  apiFetch<RunResult>("/api/simulations/run", { method: "POST", body: JSON.stringify(request) });

export interface AlternativePlanResponse {
  feasible: boolean;
  reason?: string;
  baselineRun?: RunResult;
  alternativeRun?: RunResult;
  changes: unknown[];
  tradeOffs: string[];
}

export const generateAlternativePlan = (request: { scenarioId: string; randomSeed?: number }) =>
  apiFetch<AlternativePlanResponse>("/api/optimization/plan", {
    method: "POST", body: JSON.stringify(request),
  });

export const compareRuns = (baselineRun: RunResult, alternativeRun: RunResult) =>
  apiFetch<ComparisonResult>("/api/simulations/compare", {
    method: "POST", body: JSON.stringify({ baselineRun, alternativeRun }),
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run lib/api/client.test.ts`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/api/client.ts frontend/lib/api/client.test.ts
git commit -m "feat(frontend): typed API client with structured-error passthrough"
```

---

### Remaining tasks (checklist)

- [ ] **PRD §10.4 "Validate Scenario" endpoint** — `POST /api/scenarios/validate`
  wasn't in the master plan's pinned `routes.py` because nothing else
  depends on its exact shape; add it once Task 1–3 are merged. Reuse
  Pydantic's own validation: attempt `ScenarioConfig.model_validate(body)`
  and translate a `pydantic.ValidationError` into a list of
  `{field, message}` entries in the `AegisError`'s response (PRD:
  "actionable validation errors").
- [ ] **Smoke-test the full stack at each sync checkpoint (master plan §2
  and §6)** — this is explicitly your job as a frequent integration
  captain candidate: `uvicorn app.main:app --reload` +
  `npm run dev` in the other terminal, then click through PRD §5.1
  Journey A by hand.
- [ ] **PRD §12.2 Reliability — "Prevent duplicate runs from corrupting
  state"** — since `run_simulation` and `generate_alternative_plan` never
  mutate the loaded `ScenarioConfig` (Member 1/2 already copy shelters
  with `model_copy(deep=True)` before mutating occupancy), concurrent
  requests are naturally safe; add one test that fires `run_simulation`
  twice in a row against the same scenario and asserts both results have
  identical metrics (proves no shared mutable state leaked between calls).
- [ ] **CORS for the deployed demo URL**, if the team ends up hosting the
  frontend anywhere other than `localhost:3000` for the actual
  presentation — update `allow_origins` in `main.py` before walking on
  stage, not during the pitch.
