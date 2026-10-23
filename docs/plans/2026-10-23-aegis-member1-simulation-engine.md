# AEGIS — Member 1: Simulation Engine Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, fully-tested, deterministic simulation loop that turns a
list of `AgentPlan`s into a `RunResult` — agent state transitions, time
steps, shelter-capacity enforcement, and completion-vs-timeout detection —
plus the glue (`run_simulation`) the API layer calls.

**Architecture:** `simulate()` is a pure function with no I/O: scenario +
plans + params + a congestion model in, `RunResult` out. This is what makes
it unit-testable in isolation from Member 2's routing code and Member 5's
scenario loading. `run_simulation()` is the thin orchestration layer that
wires `simulate()` to the real scenario store and routing module.

**Tech Stack:** Python 3.11+, Pydantic v2, pytest.

**Spec:** See `2026-10-23-aegis-master-plan.md` in this folder for the full
shared contracts (`AgentPlan`, `RunResult`, etc.) and PRD §6 (Simulation
Engine Requirements), §13.3 (Simulation Tests).

## Global Constraints

- Agents never disappear — every agent ends the run as exactly one of
  `ARRIVED` or `UNSERVED`, with a reason traceable from `warnings` or
  `ShelterResult.rejected_count`.
- Shelter `occupied` must never exceed `total_capacity` (enforced at the
  moment of arrival, not at assignment time).
- Fixed `random_seed` on `SimulationParams` ⇒ byte-identical `RunResult`
  across runs (the loop itself is deterministic; only Member 2's
  assignment step uses the seed for tie-breaking).
- Distinguish "everyone resolved" (`hit_tick_limit=False`,
  `completion_tick` = max arrival tick) from "ran out of ticks"
  (`hit_tick_limit=True`, `completion_tick=None`, remaining agents forced
  to `UNSERVED` with a warning each).

---

### Task 1: Pure simulation loop (`simulate`)

**Files:**
- Create: `backend/app/simulation/protocols.py`
- Create: `backend/app/simulation/engine.py`
- Test: `backend/tests/simulation/test_engine.py`

**Interfaces:**
- Consumes: `AgentPlan`, `AgentStatus`, `AgentResult`, `EdgeCongestionResult`,
  `RoadEdge`, `RoadStatus`, `RoadNode`, `RunMetrics`, `RunResult`,
  `ScenarioConfig`, `Shelter`, `ShelterResult`, `SimulationParams` — all
  from `app.models.schemas` (master plan §3.1).
- Produces: `simulate(scenario, plans, params, congestion_model, plan_label) -> RunResult`
  from `engine.py`, and the `CongestionModelProtocol` structural type from
  `protocols.py` (**not** from `engine.py` — see master plan §3.4 for why
  it's a separate file) that Member 2's real `CongestionModel` must
  satisfy. This split is the seam between your module and theirs.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/simulation/test_engine.py
from app.models.schemas import (
    AgentPlan, AgentStatus, RoadEdge, RoadNode, RoadStatus, ScenarioConfig,
    Shelter, SimulationParams,
)
from app.simulation.engine import simulate
from app.simulation.protocols import CongestionModelProtocol


class FakeCongestionModel(CongestionModelProtocol):
    """No congestion at all — effective time == base time. Stands in for
    Member 2's real CongestionModel until it exists."""

    def __init__(self, edges_by_id: dict[str, RoadEdge]):
        self._edges = edges_by_id
        self.registered: list[tuple[str, int, int]] = []

    def effective_travel_time_s(self, edge_id, tick, agents_entering):
        return self._edges[edge_id].base_travel_time_s

    def register_tick(self, edge_id, tick, agents_entering):
        self.registered.append((edge_id, tick, agents_entering))

    def peak_congestion(self):
        return {}


def _tiny_scenario() -> ScenarioConfig:
    return ScenarioConfig(
        id="test_scenario", name="Test", description="", synthetic=True,
        nodes=[RoadNode(id="N1", lat=0, lon=0), RoadNode(id="N2", lat=0, lon=0)],
        edges=[
            RoadEdge(
                id="E1", source="N1", target="N2", length_m=100,
                capacity_per_tick=10, base_travel_time_s=90, status=RoadStatus.OPEN,
            ),
        ],
        zones=[],
        shelters=[Shelter(id="S1", name="Shelter 1", connector_node="N2", total_capacity=1, occupied=0)],
        hazards=[],
        default_params=SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42),
    )


def test_single_agent_arrives_after_expected_ticks():
    scenario = _tiny_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter="S1",
                        route_edge_ids=["E1"], movement_profile="standard", distance_m=100)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.metrics.evacuated_count == 1
    assert result.metrics.unserved_count == 0
    assert result.metrics.hit_tick_limit is False
    # 90s travel / 30s per tick = 3 ticks -> zero-indexed arrival tick 2
    assert result.agents[0].arrival_tick == 2
    assert result.agents[0].status == AgentStatus.ARRIVED
    assert result.shelters[0].final_occupied == 1


def test_agent_with_no_route_is_unserved_immediately():
    scenario = _tiny_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter=None,
                        route_edge_ids=[], movement_profile="standard", distance_m=0)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.metrics.unserved_count == 1
    assert result.agents[0].status == AgentStatus.UNSERVED
    assert result.agents[0].arrival_tick is None


def test_shelter_capacity_is_never_exceeded():
    scenario = _tiny_scenario()  # S1 total_capacity=1
    plans = [
        AgentPlan(agent_id=f"A{i}", origin_zone="Z1", assigned_shelter="S1",
                  route_edge_ids=["E1"], movement_profile="standard", distance_m=100)
        for i in range(3)
    ]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.shelters[0].final_occupied == 1
    assert result.metrics.evacuated_count == 1
    assert result.metrics.unserved_count == 2
    assert result.shelters[0].rejected_count == 2


def test_max_ticks_limit_marks_remaining_agents_unserved_with_warning():
    scenario = _tiny_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter="S1",
                        route_edge_ids=["E1"], movement_profile="standard", distance_m=100)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    # 1 tick is not enough to cross a 90s / 30s-per-tick = 3-tick edge.
    params = SimulationParams(tick_seconds=30, max_ticks=1, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.metrics.hit_tick_limit is True
    assert result.metrics.unserved_count == 1
    assert result.metrics.completion_tick is None
    assert len(result.warnings) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/simulation/test_engine.py -v`
Expected: `ModuleNotFoundError: No module named 'app.simulation.engine'`

- [ ] **Step 3: Implement the protocol file and the simulation loop**

```python
# backend/app/simulation/protocols.py
class CongestionModelProtocol:
    """Structural contract between this module and Member 2's real
    CongestionModel (app.routing.congestion). Lives in its own file, not
    in engine.py and not in congestion.py, specifically so those two
    modules never need to import each other — see master plan §3.4."""

    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float:
        raise NotImplementedError

    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None:
        raise NotImplementedError

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        raise NotImplementedError
```

```python
# backend/app/simulation/engine.py
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from app.models.schemas import (
    AgentPlan, AgentResult, AgentStatus, EdgeCongestionResult, RunMetrics,
    RunResult, ScenarioConfig, ShelterResult, SimulationParams,
)
from app.simulation.protocols import CongestionModelProtocol

# Multiplier applied to an edge's effective travel time by movement profile.
# >1.0 = slower. MVP ships only these two; PRD P1 ("vulnerability-aware
# agents") adds more without changing this module's shape.
MOVEMENT_PROFILE_TIME_MULTIPLIER: dict[str, float] = {
    "standard": 1.0,
    "reduced_mobility": 1.6,
}


@dataclass
class _AgentState:
    plan: AgentPlan
    status: AgentStatus = AgentStatus.WAITING
    edge_index: int = 0
    ticks_remaining_on_edge: int = 0
    arrival_tick: int | None = None


def _active(a: _AgentState) -> bool:
    return a.status in (AgentStatus.WAITING, AgentStatus.MOVING, AgentStatus.DELAYED)


def simulate(
    scenario: ScenarioConfig,
    plans: list[AgentPlan],
    params: SimulationParams,
    congestion_model: CongestionModelProtocol,
    plan_label: str,
) -> RunResult:
    """Pure simulation loop: no scenario loading, no routing, no randomness
    beyond what's baked into `plans`. Deterministic given fixed inputs."""
    start = time.perf_counter()

    shelters_by_id = {s.id: s.model_copy(deep=True) for s in scenario.shelters}
    edges_by_id = {e.id: e for e in scenario.edges}
    agents = [_AgentState(plan=p) for p in plans]

    # Agents with no feasible route are unserved from tick 0 — never
    # silently dropped (PRD §6.3).
    for a in agents:
        if a.plan.assigned_shelter is None or not a.plan.route_edge_ids:
            a.status = AgentStatus.UNSERVED

    tick = 0
    hit_tick_limit = False

    while any(_active(a) for a in agents):
        if tick >= params.max_ticks:
            hit_tick_limit = True
            break

        entering_by_edge: dict[str, int] = {}
        for a in agents:
            if not _active(a):
                continue
            about_to_enter = a.status == AgentStatus.WAITING or a.ticks_remaining_on_edge <= 0
            if about_to_enter:
                edge_id = a.plan.route_edge_ids[a.edge_index]
                entering_by_edge[edge_id] = entering_by_edge.get(edge_id, 0) + 1

        for a in agents:
            if not _active(a):
                continue

            if a.status == AgentStatus.WAITING:
                a.status = AgentStatus.MOVING
                a.ticks_remaining_on_edge = -1  # force recompute below

            if a.ticks_remaining_on_edge < 0:
                edge_id = a.plan.route_edge_ids[a.edge_index]
                multiplier = MOVEMENT_PROFILE_TIME_MULTIPLIER.get(a.plan.movement_profile, 1.0)
                effective_s = congestion_model.effective_travel_time_s(
                    edge_id, tick, entering_by_edge.get(edge_id, 0)
                )
                congestion_model.register_tick(edge_id, tick, entering_by_edge.get(edge_id, 0))
                ticks_needed = max(1, round((effective_s * multiplier) / params.tick_seconds))
                a.ticks_remaining_on_edge = ticks_needed
                a.status = (
                    AgentStatus.DELAYED
                    if effective_s > edges_by_id[edge_id].base_travel_time_s * 1.1
                    else AgentStatus.MOVING
                )

            a.ticks_remaining_on_edge -= 1
            if a.ticks_remaining_on_edge > 0:
                continue

            a.edge_index += 1
            if a.edge_index < len(a.plan.route_edge_ids):
                a.ticks_remaining_on_edge = -1
                a.status = AgentStatus.MOVING
                continue

            shelter = shelters_by_id.get(a.plan.assigned_shelter)
            if shelter is not None and shelter.occupied < shelter.total_capacity:
                shelter.occupied += 1
                a.status = AgentStatus.ARRIVED
                a.arrival_tick = tick
            else:
                a.status = AgentStatus.UNSERVED

        tick += 1

    warnings: list[str] = []
    for a in agents:
        if _active(a):
            a.status = AgentStatus.UNSERVED
            warnings.append(
                f"Agent {a.plan.agent_id} did not resolve within max_ticks={params.max_ticks}"
            )

    agent_results = [
        AgentResult(
            id=a.plan.agent_id, origin_zone=a.plan.origin_zone,
            assigned_shelter=a.plan.assigned_shelter, route_edge_ids=a.plan.route_edge_ids,
            status=a.status, arrival_tick=a.arrival_tick, movement_profile=a.plan.movement_profile,
        )
        for a in agents
    ]

    shelter_results = [
        ShelterResult(
            shelter_id=s.id, total_capacity=s.total_capacity, final_occupied=s.occupied,
            rejected_count=sum(
                1 for a in agents
                if a.plan.assigned_shelter == s.id and a.status == AgentStatus.UNSERVED
            ),
        )
        for s in shelters_by_id.values()
    ]

    congestion_results = [
        EdgeCongestionResult(
            edge_id=edge_id, peak_demand_to_capacity=ratio, peak_tick=peak_tick,
            total_delay_s=0.0,  # refined once Member 2's real CongestionModel lands
        )
        for edge_id, (ratio, peak_tick) in congestion_model.peak_congestion().items()
    ]

    evacuated = sum(1 for a in agents if a.status == AgentStatus.ARRIVED)
    unserved = sum(1 for a in agents if a.status == AgentStatus.UNSERVED)
    completion_tick = (
        max((a.arrival_tick for a in agents if a.arrival_tick is not None), default=None)
        if not hit_tick_limit else None
    )

    metrics = RunMetrics(
        evacuated_count=evacuated,
        unserved_count=unserved,
        completion_tick=completion_tick,
        hit_tick_limit=hit_tick_limit,
        max_congestion_ratio=max((c.peak_demand_to_capacity for c in congestion_results), default=0.0),
        runtime_ms=(time.perf_counter() - start) * 1000,
    )

    return RunResult(
        run_id=str(uuid.uuid4()), scenario_id=scenario.id, plan_label=plan_label,
        random_seed=params.random_seed, metrics=metrics, agents=agent_results,
        shelters=shelter_results, congestion=congestion_results, warnings=warnings,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/simulation/test_engine.py -v`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/simulation/protocols.py backend/app/simulation/engine.py backend/tests/simulation/test_engine.py
git commit -m "feat(sim): pure simulation loop with capacity-safe shelter admission"
```

---

### Task 2: `run_simulation` glue + temporary routing stub

**Files:**
- Modify: `backend/app/simulation/engine.py` (append `RunRequest`, `run_simulation`)
- Create: `backend/app/routing/graph.py` (temporary stub — Member 2 will
  replace the body, not the signature)
- Create: `backend/app/routing/assignment.py` (temporary stub — same deal)
- Create: `backend/app/routing/congestion.py` (temporary stub implementing
  `CongestionModelProtocol` with zero congestion — Member 2 replaces the
  body)
- Test: `backend/tests/simulation/test_run_simulation.py`

**Interfaces:**
- Consumes: `get_scenario` from `app.services.scenario_store` (Member 5's
  module — see note below), `build_graph` / `assign_shelters_and_routes` /
  `CongestionModel` from `app.routing.*` (master plan §3.4).
- Produces: `RunRequest` (Pydantic model) and
  `run_simulation(request: RunRequest) -> RunResult`, which is exactly what
  `backend/app/api/routes.py` imports.

**Member 5 dependency note:** if `app.services.scenario_store.get_scenario`
doesn't exist yet when you reach this task, write this 6-line stand-in in
the same file and delete it once Member 5's real one lands (identical
signature, so no call-site changes):

```python
def get_scenario(scenario_id: str) -> ScenarioConfig | None:
    import json
    from pathlib import Path
    path = Path(__file__).parents[3] / "data" / "scenarios" / f"{scenario_id}.json"
    if not path.exists():
        return None
    return ScenarioConfig.model_validate_json(path.read_text())
```

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/simulation/test_run_simulation.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/simulation/test_run_simulation.py -v`
Expected: `ImportError: cannot import name 'RunRequest'`

- [ ] **Step 3: Implement the stubs and the glue**

```python
# backend/app/routing/graph.py (TEMPORARY — Member 2 replaces this body)
from app.models.schemas import ScenarioConfig


def build_graph(scenario: ScenarioConfig):
    """Returns an adjacency map {node_id: [(neighbor_id, edge_id), ...]}
    for OPEN edges only. Member 2 will replace this with a real
    networkx.Graph and a weighted shortest-path function — same function
    name and argument, different return type, so update the two call
    sites in assignment.py and congestion.py together when that lands."""
    adjacency: dict[str, list[tuple[str, str]]] = {n.id: [] for n in scenario.nodes}
    for e in scenario.edges:
        if e.status.value != "open":
            continue
        adjacency[e.source].append((e.target, e.id))
        adjacency[e.target].append((e.source, e.id))
    return adjacency


def compute_shortest_route(graph, edges_by_id, source_node: str, target_node: str) -> list[str] | None:
    """Naive breadth-first search (fewest hops, ignores length/congestion).
    Member 2 replaces this with Dijkstra/A* over real edge weights — same
    signature and return shape (list of edge ids, or None if unreachable)."""
    from collections import deque

    visited = {source_node}
    queue: deque[tuple[str, list[str]]] = deque([(source_node, [])])
    while queue:
        node, path = queue.popleft()
        if node == target_node:
            return path
        for neighbor, edge_id in graph.get(node, []):
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [edge_id]))
    return None
```

```python
# backend/app/routing/assignment.py (TEMPORARY — Member 2 replaces this body)
from app.models.schemas import AgentPlan, ScenarioConfig
from app.routing.graph import build_graph, compute_shortest_route


def assign_shelters_and_routes(
    scenario: ScenarioConfig, graph, random_seed: int
) -> list[AgentPlan]:
    """Naive nearest-reachable-shelter-by-hop-count, no capacity awareness,
    no congestion weighting. Member 2 replaces this with the real
    capacity-respecting greedy heuristic (PRD §7.3) — same signature."""
    edges_by_id = {e.id: e for e in scenario.edges}
    plans: list[AgentPlan] = []
    agent_counter = 0

    for zone in scenario.zones:
        for profile, fraction in zone.movement_profile.items():
            count = round(zone.evacuee_count * fraction)
            for _ in range(count):
                best_route: list[str] | None = None
                best_shelter_id: str | None = None
                for shelter in scenario.shelters:
                    if not shelter.available:
                        continue
                    route = compute_shortest_route(
                        graph, edges_by_id, zone.connector_node, shelter.connector_node
                    )
                    if route is not None and (best_route is None or len(route) < len(best_route)):
                        best_route = route
                        best_shelter_id = shelter.id
                agent_counter += 1
                distance = sum(edges_by_id[e].length_m for e in (best_route or []))
                plans.append(
                    AgentPlan(
                        agent_id=f"{zone.id}-{agent_counter}",
                        origin_zone=zone.id,
                        assigned_shelter=best_shelter_id,
                        route_edge_ids=best_route or [],
                        movement_profile=profile,
                        distance_m=distance,
                    )
                )
    return plans
```

```python
# backend/app/routing/congestion.py (TEMPORARY — Member 2 replaces this body)
from app.models.schemas import ScenarioConfig, SimulationParams
from app.simulation.protocols import CongestionModelProtocol


class CongestionModel(CongestionModelProtocol):
    """No congestion modelling yet — effective time == base time, and no
    edge ever reports a peak. Member 2 replaces the two method bodies
    below with the real capacity-based formula (PRD §6.6) and starts
    tracking real peak ratios — the class name and method signatures stay
    identical, so engine.py and its tests don't change."""

    def __init__(self, scenario: ScenarioConfig, params: SimulationParams):
        self._edges_by_id = {e.id: e for e in scenario.edges}

    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float:
        return self._edges_by_id[edge_id].base_travel_time_s

    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None:
        pass

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        return {}
```

```python
# backend/app/simulation/engine.py — append to the file from Task 1
from app.models.schemas import CamelModel
from app.routing.assignment import assign_shelters_and_routes
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph


class RunRequest(CamelModel):
    # CamelModel (not plain BaseModel) so the frontend can POST
    # {"scenarioId": "...", "planLabel": "baseline"} directly — see master
    # plan §3.1's note on CamelModel and §3.3's "already camelCase" note.
    scenario_id: str
    plan_label: str = "baseline"
    params: SimulationParams | None = None


def run_simulation(request: RunRequest) -> RunResult:
    # Local import: no actual circular-import risk (scenario_store only
    # imports app.models.schemas), but if Member 5's real module doesn't
    # exist yet when you reach this step, define a 6-line get_scenario
    # stand-in directly below instead of adding this import — see the
    # "Member 5 dependency note" above this task.
    from app.services.scenario_store import get_scenario

    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        raise ValueError(f"Unknown scenario_id '{request.scenario_id}'")

    params = request.params or scenario.default_params
    graph = build_graph(scenario)
    plans = assign_shelters_and_routes(scenario, graph, params.random_seed)
    congestion_model = CongestionModel(scenario, params)

    return simulate(scenario, plans, params, congestion_model, plan_label=request.plan_label)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/simulation/test_run_simulation.py -v`
Expected: `1 passed` (if it's `0 passed, 1 error` because
`scenario_a_normal.json` doesn't exist yet at `data/scenarios/`, pull it
from the master plan §4 and commit it — this file is everyone's Hour-0
responsibility, not just yours, but don't block on waiting for someone
else to do it)

- [ ] **Step 5: Commit**

```bash
git add backend/app/simulation/engine.py backend/app/routing/ backend/tests/simulation/test_run_simulation.py
git commit -m "feat(sim): wire run_simulation end-to-end with naive routing stub"
```

---

### Remaining tasks (checklist — flesh out against the PRD once Tasks 1–2 are merged)

- [ ] **Swap in Member 2's real `CongestionModel`/`assign_shelters_and_routes`/`compute_shortest_route`** as soon as they land on `main` — no changes needed on your side beyond re-running the Task 1 + Task 2 tests to confirm nothing broke. If a test's exact numeric assertions (e.g. `arrival_tick == 2`) now differ because real congestion adds delay, update the fixture scenario's expected values, don't weaken the assertion.
- [ ] **PRD §13.3 "A fixed random seed produces reproducible results"** — add `test_same_seed_produces_identical_run_result()`: call `run_simulation` twice with the same `RunRequest` and assert the two `RunResult`s are equal except for `run_id` and `runtime_ms`.
- [ ] **PRD §5.1 Journey A, "Resetting restores the initial state without duplicating agents"** — confirm this is true by construction: `simulate()` takes a fresh `scenario.shelters` copy (`model_copy(deep=True)`) every call and never mutates its inputs. Add `test_simulate_does_not_mutate_input_scenario()` asserting `scenario.shelters[0].occupied == 0` after calling `simulate()`.
- [ ] **Benchmark at Scenario A's real agent count (750)** for PRD §12.1 — add a quick `time python -c "from app.simulation.engine import run_simulation, RunRequest; run_simulation(RunRequest(scenario_id='scenario_a_normal'))"` and record the number in `docs/ASSUMPTIONS.md` (Member 6 owns that file, but you own the number).
- [ ] **Hand off to Member 6:** once Scenario B (closed bridge) and Scenario C (shelter shortage) fixture files exist, run `run_simulation` against both and sanity-check by eye that B produces more `UNSERVED` agents on the N3-side zone than A, and C produces a non-zero `ShelterResult.rejected_count` for the shrunk shelter. These become Member 6's automated acceptance tests (PRD §13.6 items 4–5) — you're just confirming the engine *can* produce the expected failure before QA locks in the exact numbers.
