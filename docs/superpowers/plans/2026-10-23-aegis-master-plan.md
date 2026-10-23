# AEGIS Master Execution Plan

> **For agentic workers:** This master plan is the entry point. Each of the
> six per-workstream plans in this same folder
> (`2026-10-23-aegis-member{1-6}-*.md`) is a standalone implementation plan —
> use `superpowers:executing-plans` or `superpowers:subagent-driven-development`
> to run each one inside that member's own Claude Code / Antigravity session.
> This file defines what must exist *before* those six plans can run in
> parallel without merge hell.

**Goal:** Ship a working AEGIS prototype (PS 021) in a 24–30 hour hackathon
window with 6 people working in parallel, without the six workstreams only
meeting at the end.

**Spec:** PRD pasted by the user, 2026-10-23 (saved context — not a file on
disk; this plan + the six member plans quote every requirement that bears on
their tasks, so the PRD itself does not need to be re-read during execution).

**Tech Stack:** Next.js + React + TypeScript + Tailwind + React-Leaflet +
Recharts + Lucide (frontend). Python + FastAPI + NetworkX + Pydantic
(backend). Local JSON scenario fixtures (no DB for MVP).

## Global Constraints (apply to every task in every sub-plan)

- No ML model. Routing/optimization is Dijkstra/A* + a documented greedy
  heuristic. Never describe it as "trained" or "AI-predicted."
- A shelter's `occupied` must never exceed `total_capacity`. This is enforced
  in the Pydantic model itself (validator below) — don't re-implement the
  check ad hoc elsewhere; if you need to raise it at a different layer,
  catch the `ValidationError`, don't bypass it.
- Every metric must come from an actual run. No hardcoded "success" numbers,
  no `Math.random()` standing in for an unimplemented algorithm.
- Every run accepts a `random_seed` (default `42`) and is reproducible.
- Closed roads (`status: "closed"`) are never traversable by a route.
- Baseline and alternative runs must use the same `random_seed` unless the
  user explicitly changes scenario parameters.
- Three fixture scenarios: **A** (normal), **B** (critical bridge closed),
  **C** (one shelter capacity slashed). All three ship as JSON under
  `data/scenarios/`.

---

## 1. Why split into 7 documents instead of 1

The PRD assigns 6 independent-ish roles (PRD §14) to 6 people. Each role
touches different files and has its own test cycle (simulation engine tests,
routing tests, UI tests, etc.) — exactly the "multiple independent
subsystems" case where one linear plan would force people to wait on each
other for no reason. So:

| File | Owner | Content |
|---|---|---|
| `2026-10-23-aegis-master-plan.md` (this file) | Everyone, hour 0 | Schedule, tool assignment, shared contracts, integration rules |
| `2026-10-23-aegis-member1-simulation-engine.md` | Member 1 | Agent states, simulation loop, time steps |
| `2026-10-23-aegis-member2-routing-optimization.md` | Member 2 | Road graph, Dijkstra routing, congestion, alternative-plan heuristic |
| `2026-10-23-aegis-member3-map-visualization.md` | Member 3 | Leaflet map, layers, legend, agent/route rendering |
| `2026-10-23-aegis-member4-dashboard-ux.md` | Member 4 | Sidebar/header, scenario controls, results drawer, comparison view |
| `2026-10-23-aegis-member5-backend-integration.md` | Member 5 | FastAPI routes, scenario loading, error handling, frontend wiring |
| `2026-10-23-aegis-member6-qa-metrics-pitch.md` | Member 6 | Acceptance tests across all scenarios, metrics verification, demo script, README |

Every per-workstream plan's **Interfaces** section quotes the exact types
from Section 3 below — that's the contract. **Nobody changes those type
names or shapes without shouting in the team channel**, because 5 other
people's code imports them by name.

---

## 2. The 24–30 hour schedule (compressed from PRD §15's 4-day plan)

The PRD's own fallback for "only two days available" is: *"prioritize one
scenario, the road graph, basic movement, shelter capacity and the
baseline/alternative comparison. Defer 3D and all optional features."*
You have even less wall-clock time than that fallback assumes, but 6
people in parallel — so the target is: **nail Scenario A + B fully
(PRD §11, A and B), bring C online only if Hour 20 checkpoint is green.**
Do not start any PRD §3.2 (P1) item before all P0 acceptance boxes in
PRD §20 are checked for Scenario A and B.

| Hours | Phase | Everyone does this |
|---|---|---|
| **0 – 1** | **Kickoff (synchronous, all 6 in one room/call)** | Create the repo, scaffold `frontend/` + `backend/` (see note below), commit Section 3's shared contracts verbatim (including `protocols.py`, §3.4), commit Section 4's fixture scenario, agree on the integration-captain rotation (Section 6) |
| **1 – 7** | **Vertical slice (PRD "Day 1")** | Each person starts their own numbered plan file, Task 1 only. Goal: a `curl` to `/api/simulations/run` returns a real (not mocked) `RunResult` for Scenario A, and the frontend can render *something* on the map from real API data. |
| **7 – 8** | **Sync checkpoint #1** | Everyone merges to `main`. Integration captain runs the full stack. If the vertical slice doesn't work end-to-end, this is the only thing that matters until it does — see PRD §17 risk table, row 2. |
| **8 – 16** | **Interactive experience (PRD "Day 2")** | Road closures, shelter inspector, results drawer, agent/aggregate rendering, dashboard shell |
| **16 – 17** | **Sync checkpoint #2** | Merge, full-stack smoke test of Journeys A and B (PRD §5.1, §5.2) |
| **17 – 23** | **The differentiator (PRD "Day 3")** | Baseline storage, alternative-plan heuristic, comparison view, rule-based recommendations, Scenario B and C tests |
| **23 – 24** | **Sync checkpoint #3** | Merge, run Member 6's full acceptance suite (all of PRD §20) |
| **24 – 28** | **Stabilize (PRD "Day 4", compressed)** | Bug fixes only — no new features. Benchmark agent count (PRD §12.1). Visual polish. Scenario labels/limitations copy. README. |
| **28 – 30** | **Rehearse + buffer** | Run the exact demo script (PRD §16.1) three times. Record the fallback video. Sleep rotation if the event spans overnight. |

**Hard rule:** if Sync checkpoint #1 (hour 7–8) fails — i.e. the vertical
slice isn't real end-to-end — everyone stops their Day-2 work and fixes the
slice together. This is cheaper than discovering at hour 23 that the API
shape nobody actually tested doesn't match what the frontend assumed.

**Scaffold note:** `npx create-next-app@latest frontend --typescript --tailwind --app`
prompts for an import-alias path — accept the default `@/*` (mapping to
the `frontend/` root). Every member plan's frontend code imports via
`@/lib/...` and `@/components/...`; if the alias is skipped or set to
something else at scaffold time, every one of those imports breaks
identically across all four frontend-touching plans (3, 4, 5), so get
this right once, in Hour 0, rather than finding it at Hour 7.

---

## 3. Shared contracts (commit these verbatim in Hour 0, before anyone branches off)

These are the PRD §6, §8, §10 data shapes made concrete. Every member's plan
file references these exact names.

### 3.1 `backend/app/models/schemas.py`

```python
"""Shared Pydantic contracts for AEGIS. Mirrors frontend/lib/schemas/types.ts.
Keep the two files in sync by hand — any shape change here must be reflected
there in the same commit."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for every model below. Python/JSON-in stays snake_case
    (`total_capacity`), but JSON-out is camelCase (`totalCapacity`) to
    match frontend/lib/schemas/types.ts exactly — FastAPI's response
    serialization uses aliases by default, and `populate_by_name=True`
    means incoming request bodies can use either spelling. This is why
    the TypeScript interfaces below are camelCase while the Python
    classes are snake_case: same contract, each language's convention."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RoadStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    RESTRICTED = "restricted"


class AgentStatus(str, Enum):
    WAITING = "waiting"
    MOVING = "moving"
    DELAYED = "delayed"
    ARRIVED = "arrived"
    UNSERVED = "unserved"


class RoadNode(CamelModel):
    id: str
    lat: float
    lon: float
    label: Optional[str] = None


class RoadEdge(CamelModel):
    id: str
    source: str  # RoadNode.id
    target: str  # RoadNode.id
    length_m: float = Field(gt=0)
    capacity_per_tick: int = Field(gt=0)
    base_travel_time_s: float = Field(gt=0)
    status: RoadStatus = RoadStatus.OPEN
    hazard_risk: float = Field(default=0.0, ge=0.0, le=1.0)


class PopulationZone(CamelModel):
    id: str
    name: str
    connector_node: str  # RoadNode.id
    evacuee_count: int = Field(ge=0)
    # e.g. {"standard": 0.7, "reduced_mobility": 0.3} — must sum to ~1.0
    movement_profile: dict[str, float] = Field(default_factory=lambda: {"standard": 1.0})


class Shelter(CamelModel):
    id: str
    name: str
    connector_node: str
    total_capacity: int = Field(gt=0)
    occupied: int = Field(default=0, ge=0)
    available: bool = True

    @field_validator("occupied")
    @classmethod
    def occupied_within_capacity(cls, v: int, info) -> int:
        total = info.data.get("total_capacity")
        if total is not None and v > total:
            raise ValueError(
                f"occupied ({v}) cannot exceed total_capacity ({total})"
            )
        return v


class HazardZone(CamelModel):
    id: str
    polygon: list[tuple[float, float]]  # [(lat, lon), ...], closed ring
    severity: float = Field(ge=0.0, le=1.0)
    start_tick: int = 0
    end_tick: Optional[int] = None


class SimulationParams(CamelModel):
    tick_seconds: float = Field(default=30.0, gt=0)
    max_ticks: int = Field(default=240, gt=0)
    random_seed: int = 42


class ScenarioConfig(CamelModel):
    id: str
    name: str
    description: str
    synthetic: bool = True
    nodes: list[RoadNode]
    edges: list[RoadEdge]
    zones: list[PopulationZone]
    shelters: list[Shelter]
    hazards: list[HazardZone] = Field(default_factory=list)
    default_params: SimulationParams


class AgentPlan(CamelModel):
    """Output of Member 2's assignment step; input to Member 1's simulation
    loop. One instance per individual evacuee (not per zone) — a zone with
    450 evacuees becomes 450 AgentPlan rows, split across movement_profile
    keys roughly in proportion to the zone's movement_profile dict."""
    agent_id: str
    origin_zone: str  # PopulationZone.id
    assigned_shelter: Optional[str] = None  # None => no feasible shelter found
    route_edge_ids: list[str] = Field(default_factory=list)  # [] if assigned_shelter is None
    movement_profile: str = "standard"  # key into the zone's movement_profile dict
    distance_m: float = 0.0  # sum of route_edge_ids' length_m, for reference/debugging


class AgentResult(CamelModel):
    id: str
    origin_zone: str
    assigned_shelter: Optional[str] = None
    route_edge_ids: list[str] = Field(default_factory=list)
    status: AgentStatus
    arrival_tick: Optional[int] = None
    movement_profile: str = "standard"


class EdgeCongestionResult(CamelModel):
    edge_id: str
    peak_demand_to_capacity: float
    peak_tick: int
    total_delay_s: float


class ShelterResult(CamelModel):
    shelter_id: str
    total_capacity: int
    final_occupied: int
    rejected_count: int


class RunMetrics(CamelModel):
    evacuated_count: int
    unserved_count: int
    completion_tick: Optional[int]  # None => hit max_ticks before everyone resolved
    hit_tick_limit: bool
    max_congestion_ratio: float
    runtime_ms: float


class RunResult(CamelModel):
    run_id: str
    scenario_id: str
    plan_label: str  # "baseline" | "alternative"
    random_seed: int
    metrics: RunMetrics
    agents: list[AgentResult]
    shelters: list[ShelterResult]
    congestion: list[EdgeCongestionResult]
    warnings: list[str] = Field(default_factory=list)


class MetricComparison(CamelModel):
    metric_name: str
    baseline_value: float
    alternative_value: float
    absolute_diff: float
    percent_diff: Optional[float]  # None when baseline_value == 0
    improved: Optional[bool]  # None when not meaningfully comparable


class ComparisonResult(CamelModel):
    baseline_run_id: str
    alternative_run_id: str
    metrics: list[MetricComparison]
    warnings: list[str] = Field(default_factory=list)
```

### 3.2 `frontend/lib/schemas/types.ts`

```typescript
// Mirrors backend/app/models/schemas.py. Keep in sync by hand.
export type RoadStatus = "open" | "closed" | "restricted";
export type AgentStatus = "waiting" | "moving" | "delayed" | "arrived" | "unserved";

export interface RoadNode {
  id: string;
  lat: number;
  lon: number;
  label?: string;
}

export interface RoadEdge {
  id: string;
  source: string;
  target: string;
  lengthM: number;
  capacityPerTick: number;
  baseTravelTimeS: number;
  status: RoadStatus;
  hazardRisk: number;
}

export interface PopulationZone {
  id: string;
  name: string;
  connectorNode: string;
  evacueeCount: number;
  movementProfile: Record<string, number>;
}

export interface Shelter {
  id: string;
  name: string;
  connectorNode: string;
  totalCapacity: number;
  occupied: number;
  available: boolean;
}

export interface HazardZone {
  id: string;
  polygon: [number, number][];
  severity: number;
  startTick: number;
  endTick?: number;
}

export interface SimulationParams {
  tickSeconds: number;
  maxTicks: number;
  randomSeed: number;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  synthetic: boolean;
  nodes: RoadNode[];
  edges: RoadEdge[];
  zones: PopulationZone[];
  shelters: Shelter[];
  hazards: HazardZone[];
  defaultParams: SimulationParams;
}

// Output of Member 2's assignment step — not normally fetched directly by
// the frontend, but mirrored here because Member 3/4 may want to render an
// in-progress "planning" state before a run completes.
export interface AgentPlan {
  agentId: string;
  originZone: string;
  assignedShelter?: string;
  routeEdgeIds: string[];
  movementProfile: string;
  distanceM: number;
}

export interface AgentResult {
  id: string;
  originZone: string;
  assignedShelter?: string;
  routeEdgeIds: string[];
  status: AgentStatus;
  arrivalTick?: number;
  movementProfile: string;
}

export interface EdgeCongestionResult {
  edgeId: string;
  peakDemandToCapacity: number;
  peakTick: number;
  totalDelayS: number;
}

export interface ShelterResult {
  shelterId: string;
  totalCapacity: number;
  finalOccupied: number;
  rejectedCount: number;
}

export interface RunMetrics {
  evacuatedCount: number;
  unservedCount: number;
  completionTick: number | null;
  hitTickLimit: boolean;
  maxCongestionRatio: number;
  runtimeMs: number;
}

export interface RunResult {
  runId: string;
  scenarioId: string;
  planLabel: "baseline" | "alternative";
  randomSeed: number;
  metrics: RunMetrics;
  agents: AgentResult[];
  shelters: ShelterResult[];
  congestion: EdgeCongestionResult[];
  warnings: string[];
}

export interface MetricComparison {
  metricName: string;
  baselineValue: number;
  alternativeValue: number;
  absoluteDiff: number;
  percentDiff: number | null;
  improved: boolean | null;
}

export interface ComparisonResult {
  baselineRunId: string;
  alternativeRunId: string;
  metrics: MetricComparison[];
  warnings: string[];
}
```

**Because of `CamelModel` above, the JSON actually on the wire is already
camelCase** — `GET /api/scenarios/scenario_a_normal` returns
`{"totalCapacity": 250, ...}`, not `{"total_capacity": 250, ...}`. Members
3/4/5: `fetch(...).then(r => r.json())` and cast straight to these TS
interfaces — there is no manual case conversion step, and there should
never be one. If you ever see a snake_case key in a network response,
that's a bug in the Python model (missing `CamelModel` inheritance), not
something to patch around on the frontend.

### 3.3 `backend/app/api/routes.py` (the contract every endpoint must match — PRD §10)

```python
from fastapi import APIRouter, HTTPException

from app.models.schemas import ComparisonResult, RunResult, ScenarioConfig
from app.services.scenario_store import get_scenario, list_scenarios
from app.simulation.engine import RunRequest, run_simulation
from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.services.comparison import CompareRequest, compare_runs

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
        raise HTTPException(status_code=404, detail=f"Unknown scenario_id '{scenario_id}'")
    return scenario


@router.post("/simulations/run", response_model=RunResult)
def run(request: RunRequest) -> RunResult:
    return run_simulation(request)


@router.post("/optimization/plan")
def optimize(request: OptimizationRequest) -> dict:
    return generate_alternative_plan(request)


@router.post("/simulations/compare", response_model=ComparisonResult)
def compare(request: CompareRequest) -> ComparisonResult:
    return compare_runs(request)
```

This pins down the function signatures `run_simulation(RunRequest) ->
RunResult`, `generate_alternative_plan(OptimizationRequest) -> dict`, and
`compare_runs(CompareRequest) -> ComparisonResult` that Members 1, 2 and 5
each implement — nobody needs to wait for anybody else to agree on these
names, they're fixed as of this commit.

### 3.4 The Member 1 / Member 2 module boundary

This is the one boundary in the whole system where two people's code calls
each other directly, so it's worth being explicit: Member 2 owns and
implements

```python
# backend/app/routing/graph.py
def build_graph(scenario: ScenarioConfig) -> "networkx.Graph": ...

# backend/app/routing/assignment.py
def assign_shelters_and_routes(
    scenario: ScenarioConfig, graph: "networkx.Graph", random_seed: int
) -> list[AgentPlan]: ...

# backend/app/routing/congestion.py
class CongestionModel:
    def __init__(self, scenario: ScenarioConfig, params: SimulationParams): ...
    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float: ...
    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None: ...
    def peak_congestion(self) -> dict[str, tuple[float, int]]: ...  # edge_id -> (ratio, tick)
```

Member 1 owns and implements `simulate()` (pure function over a
`list[AgentPlan]` — see Member 1's plan, Task 1) and does **not** need
Member 2's real implementation to start: Member 1's own Task 1 hand-builds
`AgentPlan` fixtures directly in a test, with zero import from
`app.routing`. Only the top-level `run_simulation()` glue (Member 1's
Task 3) calls Member 2's three functions above — if Member 2 isn't done by
then, Member 1 writes a 10-line naive stand-in with the exact same
signatures (nearest-shelter-by-hop-count, no congestion weighting) so the
vertical slice isn't blocked, and Member 2's real version is a drop-in
replacement with no call-site changes.

**Where `CongestionModelProtocol` actually lives (avoiding a circular
import):** `app.simulation.engine` needs this type to type-hint
`simulate()`'s congestion-model parameter, and `app.routing.congestion`'s
`CongestionModel` needs to implement it. If either module imported the
type from the *other*, that's a circular import
(`engine` → `routing.congestion` → `engine`) that Python cannot resolve.
So it lives in its own file with no dependencies on either:

```python
# backend/app/simulation/protocols.py
class CongestionModelProtocol:
    """Structural contract between Member 1's simulation loop and Member
    2's congestion model. Lives here — not in engine.py, not in
    congestion.py — specifically so neither of those two modules has to
    import the other."""

    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float:
        raise NotImplementedError

    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None:
        raise NotImplementedError

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        raise NotImplementedError
```

`app.simulation.engine` does `from app.simulation.protocols import
CongestionModelProtocol`; `app.routing.congestion`'s `CongestionModel`
does the same. Neither imports from `app.simulation.engine`. Commit this
file in Hour 0 alongside the other shared contracts — both member plans
below assume it already exists at this path.

---

## 4. Seed fixture: `data/scenarios/scenario_a_normal.json`

Commit this in Hour 0 too, so Members 1–5 all have real data to run against
instead of waiting for someone to build a scenario. It's intentionally
tiny (6 nodes) so routing/simulation logic is easy to hand-verify.

```json
{
  "id": "scenario_a_normal",
  "name": "Normal Conditions",
  "description": "Baseline synthetic city: all roads open, all shelters available.",
  "synthetic": true,
  "nodes": [
    { "id": "N1", "lat": 16.700, "lon": 74.230, "label": "Zone A connector" },
    { "id": "N2", "lat": 16.705, "lon": 74.235, "label": "Central junction" },
    { "id": "N3", "lat": 16.710, "lon": 74.240, "label": "Hazard-adjacent junction" },
    { "id": "N4", "lat": 16.715, "lon": 74.245, "label": "Shelter S1 connector" },
    { "id": "N5", "lat": 16.702, "lon": 74.242, "label": "Shelter S3 connector" },
    { "id": "N6", "lat": 16.720, "lon": 74.250, "label": "Shelter S2 connector" }
  ],
  "edges": [
    { "id": "E1", "source": "N1", "target": "N2", "length_m": 900,  "capacity_per_tick": 40, "base_travel_time_s": 90,  "status": "open", "hazard_risk": 0.0 },
    { "id": "E2", "source": "N2", "target": "N3", "length_m": 700,  "capacity_per_tick": 35, "base_travel_time_s": 70,  "status": "open", "hazard_risk": 0.2 },
    { "id": "E3", "source": "N3", "target": "N4", "length_m": 500,  "capacity_per_tick": 20, "base_travel_time_s": 60,  "status": "open", "hazard_risk": 0.1 },
    { "id": "E4", "source": "N2", "target": "N5", "length_m": 600,  "capacity_per_tick": 30, "base_travel_time_s": 65,  "status": "open", "hazard_risk": 0.0 },
    { "id": "E5", "source": "N5", "target": "N6", "length_m": 1100, "capacity_per_tick": 25, "base_travel_time_s": 100, "status": "open", "hazard_risk": 0.0 },
    { "id": "E6", "source": "N4", "target": "N6", "length_m": 800,  "capacity_per_tick": 20, "base_travel_time_s": 85,  "status": "open", "hazard_risk": 0.0 },
    { "id": "E7", "source": "N1", "target": "N5", "length_m": 1000, "capacity_per_tick": 30, "base_travel_time_s": 95,  "status": "open", "hazard_risk": 0.0 }
  ],
  "zones": [
    { "id": "Z1", "name": "Riverside Colony", "connector_node": "N1", "evacuee_count": 300, "movement_profile": { "standard": 0.8, "reduced_mobility": 0.2 } },
    { "id": "Z2", "name": "Market Ward",     "connector_node": "N2", "evacuee_count": 450, "movement_profile": { "standard": 0.85, "reduced_mobility": 0.15 } }
  ],
  "shelters": [
    { "id": "S1", "name": "Highland School",   "connector_node": "N4", "total_capacity": 250, "occupied": 0, "available": true },
    { "id": "S2", "name": "Community Hall",    "connector_node": "N6", "total_capacity": 300, "occupied": 0, "available": true },
    { "id": "S3", "name": "Sports Complex",    "connector_node": "N5", "total_capacity": 200, "occupied": 0, "available": true }
  ],
  "hazards": [
    {
      "id": "H1",
      "polygon": [[16.708, 74.238], [16.712, 74.238], [16.712, 74.243], [16.708, 74.243]],
      "severity": 0.6,
      "start_tick": 0,
      "end_tick": null
    }
  ],
  "default_params": { "tick_seconds": 30, "max_ticks": 240, "random_seed": 42 }
}
```

**Note on casing here vs. §3.3's "already camelCase" note:** this fixture
is written snake_case because `CamelModel` sets `populate_by_name=True` —
Pydantic accepts a field by *either* its Python name (`total_capacity`,
used in hand-authored fixture files, easier for humans to type) *or* its
camelCase alias (`totalCapacity`, used over the wire). Both are valid
input. Only API *output* is camelCase-only (FastAPI's `response_model`
serializes by alias). So: fixtures on disk stay snake_case, the frontend
only ever sees camelCase — nobody needs to convert anything by hand either
way.

**Scenario B** (critical bridge closure) = this same file with `E3`'s
`status` set to `"closed"` (E3 is the only edge connecting the N3 side to
shelter S1 — that's deliberate, it's the "critical bridge"). **Scenario C**
(shelter shortage) = this same file with `S1.total_capacity` dropped to
`30`. Member 6 owns creating these two derived files once Scenario A is
confirmed working (see Member 6's plan).

---

## 5. Tool assignment: Claude Code vs. Antigravity

Both tools can drive either side of the stack, but each has a sweet spot —
assign by where that sweet spot lands, not arbitrarily:

| Workstream | Tool | Why |
|---|---|---|
| Member 1 — Simulation engine | **Claude Code** | Pure logic, no UI. Tight `pytest` red/green loops run fastest from a terminal agent. |
| Member 2 — Routing & optimization | **Claude Code** | Same reason — NetworkX, Dijkstra, the heuristic optimizer are all unit-testable without a browser. |
| Member 3 — Map & visualization | **Antigravity** | Needs constant visual verification (does the hazard polygon actually render, is the legend readable, do agent markers animate). Antigravity's browser-verification loop (screenshot → compare → fix) is built for exactly this. |
| Member 4 — Dashboard & UX | **Antigravity** | Same reason — this is Tailwind layout and component polish, judged by eye. |
| Member 5 — Backend & integration | **Claude Code** | FastAPI wiring, Pydantic validation, CORS, error handling — terminal-first work, plus this person runs the cross-stack smoke tests at each sync checkpoint. |
| Member 6 — QA, metrics, pitch | **Claude Code** for the acceptance-test suite; a **docs/slide artifact** (not an IDE) for the pitch deck itself | Test automation is terminal work; the pitch deck is a presentation artifact, not code. |

**Practical setup:** each person opens their own Claude Code terminal
session *or* Antigravity workspace pointed at their own clone of the same
repo, on their own feature branch (`member1-sim-engine`,
`member2-routing`, etc.). Nobody shares a live session — six people in one
IDE session is how you get the "six independent modules that only meet at
the end" failure mode the PRD explicitly warns about (§17).

---

## 6. Integration rules (this is what actually prevents the PRD's #1 listed risk)

1. **Integration captain rotates every sync checkpoint** (hours 7, 16, 23).
   Captain = whoever is *least* blocked at that moment, not a fixed
   person. Captain's job for that checkpoint only: pull everyone's branch,
   resolve merge conflicts in shared files (should be near-zero if nobody
   touched `schemas.py`/`types.ts`), run the full stack, and confirm the
   relevant Journey (A, then A+B, then A+B+C) still works.
2. **Nobody edits `backend/app/models/schemas.py` or
   `frontend/lib/schemas/types.ts` after Hour 1** without posting in the
   team channel first and getting a thumbs-up — every other file depends
   on these two by name.
3. **Commit at least once an hour**, even mid-feature, to your own branch.
   Small diffs merge cleanly; a 6-hour uncommitted branch is a guaranteed
   conflict storm at the next checkpoint.
4. **The frontend never hand-writes a fake `RunResult`.** If Member 5's
   endpoint isn't ready yet, Member 3/4 point their fetch calls at a local
   mock server seeded from `data/scenarios/scenario_a_normal.json` run
   through a stub that returns a structurally-valid (but clearly labeled
   `"warnings": ["MOCK DATA — backend not yet wired"]`) `RunResult` — never
   silently fabricate a "success" demo, per PRD Global Principle #2.
5. **No one starts a PRD §3.2 (P1) feature before PRD §20's checklist
   passes for Scenario A and B.** Vulnerability-aware agents, bottleneck
   highlighting charts, exportable reports — all after, time permitting.

---

## 7. Next step

Hand each person their numbered file:
- Member 1 → `2026-10-23-aegis-member1-simulation-engine.md`
- Member 2 → `2026-10-23-aegis-member2-routing-optimization.md`
- Member 3 → `2026-10-23-aegis-member3-map-visualization.md`
- Member 4 → `2026-10-23-aegis-member4-dashboard-ux.md`
- Member 5 → `2026-10-23-aegis-member5-backend-integration.md`
- Member 6 → `2026-10-23-aegis-member6-qa-metrics-pitch.md`

Each of those six files follows the same pattern: fully-worked Task 1 (the
piece that unblocks the vertical slice, with real code, real test, run
command), then a checklist of the remaining PRD-mapped tasks at
acceptance-criteria granularity so the person's own Claude Code / Antigravity
session can flesh out the implementation against the PRD + this plan's
contracts.
