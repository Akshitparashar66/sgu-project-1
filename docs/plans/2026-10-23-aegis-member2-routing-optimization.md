# AEGIS — Member 2: Routing & Optimization Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Member 1's temporary stubs (`build_graph`,
`compute_shortest_route`, `assign_shelters_and_routes`,
`CongestionModel`) with real, tested implementations, then build the
alternative-plan optimizer (PRD §7).

**Architecture:** `networkx` for the graph and Dijkstra routing. A
documented, unit-tested capacity-ratio congestion formula (PRD §6.6). A
capacity-respecting greedy assignment for the baseline, and a
load-balancing "k-nearest, least-loaded" heuristic for the alternative
plan — both run through Member 1's `simulate()` so their metrics are
directly comparable (same engine, different input plans).

**Tech Stack:** Python 3.11+, `networkx`, Pydantic v2, pytest.

**Spec:** `2026-10-23-aegis-master-plan.md` §3.4 (module boundary with
Member 1) in this folder. PRD §6.5 (Routing), §6.6 (Congestion Model), §7
(Alternative-Plan Optimizer).

## Global Constraints

- Closed edges (`RoadStatus.CLOSED`) must never appear in a computed route.
- The congestion formula must be a documented function in code, unit
  tested — never call it "a validated real-traffic model."
- The optimizer must never claim a candidate is better than the baseline
  unless the calculated metrics support that claim; if no feasible
  improvement exists, say so explicitly (`"feasible": False` + a reason),
  never fabricate a "success."
- Shelter capacity is respected at assignment time too (not just at
  simulation arrival time in Member 1's engine) — assignment should not
  even attempt to send more demand to a shelter than its remaining
  capacity, so Member 1's rejection path is a safety net, not the primary
  mechanism.

---

### Task 1: Real graph + Dijkstra routing + congestion model

**Files:**
- Modify: `backend/app/routing/graph.py` (replace Member 1's stub body)
- Modify: `backend/app/routing/congestion.py` (replace Member 1's stub body)
- Test: `backend/tests/routing/test_graph.py`
- Test: `backend/tests/routing/test_congestion.py`

**Interfaces:**
- Consumes: `RoadEdge`, `RoadNode`, `RoadStatus`, `ScenarioConfig`,
  `SimulationParams` from `app.models.schemas`.
- Produces (same names/shapes Member 1's stub already established — see
  master plan §3.4): `build_graph(scenario) -> networkx.Graph`,
  `compute_shortest_route(graph, edges_by_id, source_node, target_node) -> list[str] | None`,
  class `CongestionModel` satisfying `app.simulation.protocols.CongestionModelProtocol`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/routing/test_graph.py
from app.models.schemas import RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.routing.graph import build_graph, compute_shortest_route


def _scenario_with_closed_shortcut() -> ScenarioConfig:
    # N1--E1(closed, 1 hop)-->N2
    # N1--E2-->N3--E3-->N2  (open, 2 hops, the only usable path)
    return ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=30, status=RoadStatus.CLOSED),
            RoadEdge(id="E2", source="N1", target="N3", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=30, status=RoadStatus.OPEN),
            RoadEdge(id="E3", source="N3", target="N2", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=30, status=RoadStatus.OPEN),
        ],
        zones=[], shelters=[Shelter(id="S1", name="S1", connector_node="N2", total_capacity=10)],
        hazards=[], default_params=SimulationParams(),
    )


def test_closed_edge_is_excluded_from_route():
    scenario = _scenario_with_closed_shortcut()
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    route = compute_shortest_route(graph, edges_by_id, "N1", "N2")

    assert route == ["E2", "E3"]  # NOT ["E1"] — that edge is closed


def test_unreachable_target_returns_none():
    scenario = _scenario_with_closed_shortcut()
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    # Close every path by also closing E2.
    scenario.edges[1].status = RoadStatus.CLOSED
    graph = build_graph(scenario)

    route = compute_shortest_route(graph, edges_by_id, "N1", "N2")

    assert route is None
```

```python
# backend/tests/routing/test_congestion.py
from app.models.schemas import RoadEdge, RoadStatus, ScenarioConfig, RoadNode, Shelter, SimulationParams
from app.routing.congestion import CongestionModel


def _scenario() -> ScenarioConfig:
    return ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id="N1", lat=0, lon=0), RoadNode(id="N2", lat=0, lon=0)],
        edges=[RoadEdge(id="E1", source="N1", target="N2", length_m=100, capacity_per_tick=10,
                          base_travel_time_s=100, status=RoadStatus.OPEN)],
        zones=[], shelters=[Shelter(id="S1", name="S1", connector_node="N2", total_capacity=10)],
        hazards=[], default_params=SimulationParams(),
    )


def test_at_or_under_capacity_has_no_penalty():
    model = CongestionModel(_scenario(), SimulationParams())
    assert model.effective_travel_time_s("E1", tick=0, agents_entering=10) == 100.0


def test_over_capacity_increases_travel_time():
    model = CongestionModel(_scenario(), SimulationParams())
    effective = model.effective_travel_time_s("E1", tick=0, agents_entering=20)  # ratio = 2.0
    assert effective > 100.0


def test_peak_congestion_tracks_highest_ratio_and_its_tick():
    model = CongestionModel(_scenario(), SimulationParams())
    model.register_tick("E1", tick=0, agents_entering=5)   # ratio 0.5
    model.register_tick("E1", tick=1, agents_entering=25)  # ratio 2.5 <- peak
    model.register_tick("E1", tick=2, agents_entering=10)  # ratio 1.0

    peak = model.peak_congestion()

    assert peak["E1"] == (2.5, 1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/routing/ -v`
Expected: failures against the naive BFS/no-op stub bodies (e.g.
`test_closed_edge_is_excluded_from_route` may pass by luck on BFS, but
`test_over_capacity_increases_travel_time` and the peak-tracking test will
fail against the stub's always-zero congestion)

- [ ] **Step 3: Implement**

```python
# backend/app/routing/graph.py
from __future__ import annotations

import networkx as nx

from app.models.schemas import RoadEdge, RoadStatus, ScenarioConfig


def build_graph(scenario: ScenarioConfig) -> nx.Graph:
    """Undirected graph of OPEN edges only. Closed/restricted edges are
    never added, so no shortest-path call can ever route through one."""
    graph = nx.Graph()
    for node in scenario.nodes:
        graph.add_node(node.id)
    for edge in scenario.edges:
        if edge.status != RoadStatus.OPEN:
            continue
        graph.add_edge(edge.source, edge.target, edge_id=edge.id, weight=edge.base_travel_time_s)
    return graph


def compute_shortest_route(
    graph: nx.Graph, edges_by_id: dict[str, RoadEdge], source_node: str, target_node: str
) -> list[str] | None:
    """Dijkstra over base_travel_time_s. Returns an ordered list of edge
    ids, or None if no open-road path exists."""
    try:
        node_path = nx.shortest_path(graph, source_node, target_node, weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None
    return [graph[u][v]["edge_id"] for u, v in zip(node_path[:-1], node_path[1:])]
```

```python
# backend/app/routing/congestion.py
from __future__ import annotations

from app.models.schemas import ScenarioConfig, SimulationParams
from app.simulation.protocols import CongestionModelProtocol  # NOT from app.simulation.engine — see master plan §3.4


class CongestionModel(CongestionModelProtocol):
    """Capacity-ratio congestion model (PRD §6.6). Documented formula, not
    a validated real-traffic model:

        ratio = agents_entering_this_tick / edge.capacity_per_tick
        factor = 1.0                              if ratio <= 1.0
                 1.0 + (ratio - 1.0) * PENALTY     otherwise
        effective_time_s = edge.base_travel_time_s * factor
    """

    PENALTY = 1.5  # tunable; documented here, not buried in a magic number elsewhere

    def __init__(self, scenario: ScenarioConfig, params: SimulationParams):
        self._edges_by_id = {e.id: e for e in scenario.edges}
        self._peak: dict[str, tuple[float, int]] = {}

    def _ratio(self, edge_id: str, agents_entering: int) -> float:
        edge = self._edges_by_id[edge_id]
        if edge.capacity_per_tick <= 0:
            return 0.0
        return agents_entering / edge.capacity_per_tick

    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float:
        edge = self._edges_by_id[edge_id]
        ratio = self._ratio(edge_id, agents_entering)
        factor = 1.0 if ratio <= 1.0 else 1.0 + (ratio - 1.0) * self.PENALTY
        return edge.base_travel_time_s * factor

    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None:
        ratio = self._ratio(edge_id, agents_entering)
        prev_ratio, _ = self._peak.get(edge_id, (-1.0, tick))
        if ratio > prev_ratio:
            self._peak[edge_id] = (ratio, tick)

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        return dict(self._peak)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/routing/ -v`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routing/graph.py backend/app/routing/congestion.py backend/tests/routing/
git commit -m "feat(routing): real Dijkstra routing + documented congestion formula"
```

---

### Task 2: Capacity-respecting shelter assignment

**Files:**
- Modify: `backend/app/routing/assignment.py` (replace Member 1's naive stub)
- Test: `backend/tests/routing/test_assignment.py`

**Interfaces:**
- Consumes: `build_graph`, `compute_shortest_route` (Task 1, this file),
  `AgentPlan`, `ScenarioConfig` from `app.models.schemas`.
- Produces: `assign_shelters_and_routes(scenario, graph, random_seed) -> list[AgentPlan]`
  (same signature Member 1 already calls from `run_simulation`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/routing/test_assignment.py
from app.models.schemas import PopulationZone, RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.routing.assignment import assign_shelters_and_routes
from app.routing.graph import build_graph


def _scenario_two_shelters_one_full() -> ScenarioConfig:
    # One zone of 5 evacuees. Nearest shelter S1 only has room for 2;
    # the rest must spill over to the farther shelter S2 — never exceed
    # S1's capacity, never silently drop anyone.
    return ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=10, status=RoadStatus.OPEN),
            RoadEdge(id="E2", source="N1", target="N3", length_m=500, capacity_per_tick=10,
                      base_travel_time_s=100, status=RoadStatus.OPEN),
        ],
        zones=[PopulationZone(id="Z1", name="Z1", connector_node="N1", evacuee_count=5,
                                movement_profile={"standard": 1.0})],
        shelters=[
            Shelter(id="S1", name="Near", connector_node="N2", total_capacity=2, occupied=0),
            Shelter(id="S2", name="Far", connector_node="N3", total_capacity=10, occupied=0),
        ],
        hazards=[], default_params=SimulationParams(),
    )


def test_assignment_never_exceeds_shelter_capacity_and_serves_everyone_reachable():
    scenario = _scenario_two_shelters_one_full()
    graph = build_graph(scenario)

    plans = assign_shelters_and_routes(scenario, graph, random_seed=42)

    assert len(plans) == 5
    assigned_to_s1 = [p for p in plans if p.assigned_shelter == "S1"]
    assigned_to_s2 = [p for p in plans if p.assigned_shelter == "S2"]
    assert len(assigned_to_s1) == 2  # never exceeds S1's total_capacity
    assert len(assigned_to_s2) == 3  # the overflow spills to S2
    assert all(p.assigned_shelter is not None for p in plans)  # both shelters reachable
    assert all(p.route_edge_ids for p in plans)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/routing/test_assignment.py -v`
Expected: FAIL — the naive stub ignores capacity and would send all 5 to S1

- [ ] **Step 3: Implement**

```python
# backend/app/routing/assignment.py
from __future__ import annotations

import random

from app.models.schemas import AgentPlan, ScenarioConfig
from app.routing.graph import compute_shortest_route


def assign_shelters_and_routes(scenario: ScenarioConfig, graph, random_seed: int) -> list[AgentPlan]:
    """Greedy nearest-reachable-shelter-with-remaining-capacity. Demand
    units are shuffled with the seeded RNG first so tie-breaking between
    equally-near shelters is deterministic but not alphabetically biased
    (PRD §6.8 reproducibility)."""
    edges_by_id = {e.id: e for e in scenario.edges}
    remaining_capacity = {s.id: s.total_capacity - s.occupied for s in scenario.shelters}

    route_cache: dict[tuple[str, str], list[str] | None] = {}

    def route(zone_node: str, shelter_node: str) -> list[str] | None:
        key = (zone_node, shelter_node)
        if key not in route_cache:
            route_cache[key] = compute_shortest_route(graph, edges_by_id, zone_node, shelter_node)
        return route_cache[key]

    rng = random.Random(random_seed)
    demand_units: list[tuple] = []
    for zone in scenario.zones:
        for profile, fraction in zone.movement_profile.items():
            count = round(zone.evacuee_count * fraction)
            demand_units.extend([(zone, profile)] * count)
    rng.shuffle(demand_units)

    plans: list[AgentPlan] = []
    for i, (zone, profile) in enumerate(demand_units):
        candidates = []
        for shelter in scenario.shelters:
            if not shelter.available or remaining_capacity.get(shelter.id, 0) <= 0:
                continue
            r = route(zone.connector_node, shelter.connector_node)
            if r is not None:
                distance = sum(edges_by_id[e].length_m for e in r)
                candidates.append((distance, shelter.id, r))
        candidates.sort(key=lambda c: c[0])

        if candidates:
            distance, shelter_id, r = candidates[0]
            remaining_capacity[shelter_id] -= 1
            plans.append(AgentPlan(
                agent_id=f"{zone.id}-{i}", origin_zone=zone.id, assigned_shelter=shelter_id,
                route_edge_ids=r, movement_profile=profile, distance_m=distance,
            ))
        else:
            plans.append(AgentPlan(
                agent_id=f"{zone.id}-{i}", origin_zone=zone.id, assigned_shelter=None,
                route_edge_ids=[], movement_profile=profile, distance_m=0.0,
            ))
    return plans
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/routing/test_assignment.py -v`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/routing/assignment.py backend/tests/routing/test_assignment.py
git commit -m "feat(routing): capacity-respecting greedy shelter assignment"
```

---

### Task 3: Alternative-plan optimizer

**Files:**
- Create: `backend/app/optimization/planner.py`
- Test: `backend/tests/optimization/test_planner.py`

**Interfaces:**
- Consumes: `assign_shelters_and_routes`, `build_graph`,
  `compute_shortest_route` (Tasks 1–2), `CongestionModel` (Task 1),
  `simulate` from `app.simulation.engine` (Member 1, already merged).
- Produces: `OptimizationRequest` (Pydantic model) and
  `generate_alternative_plan(request: OptimizationRequest) -> dict` —
  exactly what `backend/app/api/routes.py` imports.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/optimization/test_planner.py
from app.models.schemas import PopulationZone, RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.optimization.planner import OptimizationRequest, generate_alternative_plan


def test_optimizer_balances_load_when_baseline_overloads_nearest_shelter(monkeypatch):
    # Same "one near shelter is too small" shape as the assignment test,
    # but at a scale where the baseline's pure-nearest greedy starts
    # producing unserved agents and the load-balanced alternative should
    # not make things worse.
    scenario = ScenarioConfig(
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

    import app.services.scenario_store as store
    monkeypatch.setattr(store, "get_scenario", lambda scenario_id: scenario)

    result = generate_alternative_plan(OptimizationRequest(scenario_id="opt_test", random_seed=42))

    assert result["feasible"] in (True, False)  # must be a real computed verdict either way
    if result["feasible"]:
        # Keys are camelCase even though this is a plain dict, not a
        # Pydantic model — see the docstring on generate_alternative_plan.
        assert result["alternativeRun"]["metrics"]["unservedCount"] <= \
               result["baselineRun"]["metrics"]["unservedCount"]
    else:
        assert "reason" in result and result["reason"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/optimization/test_planner.py -v`
Expected: `ModuleNotFoundError: No module named 'app.optimization.planner'`

- [ ] **Step 3: Implement**

```python
# backend/app/optimization/planner.py
from __future__ import annotations

import random
import uuid

from app.models.schemas import AgentPlan, CamelModel, ScenarioConfig
from app.routing.assignment import assign_shelters_and_routes
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph, compute_shortest_route
from app.simulation.engine import simulate


class OptimizationRequest(CamelModel):
    # CamelModel so the frontend can POST {"scenarioId": "..."} directly.
    scenario_id: str
    random_seed: int = 42


def _k_nearest_balanced_assignment(
    scenario: ScenarioConfig, graph, random_seed: int, k: int = 2
) -> list[AgentPlan]:
    """Alternative heuristic (PRD §7.3 steps 5-6): instead of always
    picking the single nearest reachable shelter, each demand unit picks
    the LEAST-LOADED shelter (highest remaining-capacity ratio) among its
    k nearest reachable ones. Spreads load instead of piling everyone
    onto the closest shelter until it's full."""
    edges_by_id = {e.id: e for e in scenario.edges}
    remaining = {s.id: s.total_capacity - s.occupied for s in scenario.shelters}
    total = {s.id: s.total_capacity for s in scenario.shelters}
    route_cache: dict[tuple[str, str], list[str] | None] = {}

    def route(zone_node: str, shelter_node: str) -> list[str] | None:
        key = (zone_node, shelter_node)
        if key not in route_cache:
            route_cache[key] = compute_shortest_route(graph, edges_by_id, zone_node, shelter_node)
        return route_cache[key]

    rng = random.Random(random_seed)
    demand_units: list[tuple] = []
    for zone in scenario.zones:
        for profile, fraction in zone.movement_profile.items():
            count = round(zone.evacuee_count * fraction)
            demand_units.extend([(zone, profile)] * count)
    rng.shuffle(demand_units)

    plans: list[AgentPlan] = []
    for i, (zone, profile) in enumerate(demand_units):
        candidates = []
        for shelter in scenario.shelters:
            if not shelter.available or remaining.get(shelter.id, 0) <= 0:
                continue
            r = route(zone.connector_node, shelter.connector_node)
            if r is not None:
                distance = sum(edges_by_id[e].length_m for e in r)
                candidates.append((distance, shelter.id, r))
        candidates.sort(key=lambda c: c[0])
        top_k = candidates[:k]
        if top_k:
            top_k.sort(key=lambda c: remaining[c[1]] / total[c[1]], reverse=True)
            distance, shelter_id, r = top_k[0]
            remaining[shelter_id] -= 1
            plans.append(AgentPlan(agent_id=f"{zone.id}-alt-{i}", origin_zone=zone.id,
                                     assigned_shelter=shelter_id, route_edge_ids=r,
                                     movement_profile=profile, distance_m=distance))
        else:
            plans.append(AgentPlan(agent_id=f"{zone.id}-alt-{i}", origin_zone=zone.id,
                                     assigned_shelter=None, route_edge_ids=[], movement_profile=profile,
                                     distance_m=0.0))
    return plans


def generate_alternative_plan(request: OptimizationRequest) -> dict:
    """Returns a plain dict (routes.py's `optimize` endpoint has no
    response_model — see master plan §3.3), so CamelModel's alias
    generation does NOT apply automatically here the way it does for
    every Pydantic response elsewhere in the API. Every key below is
    therefore written camelCase by hand, and nested RunResults are
    dumped with `by_alias=True`, to match frontend/lib/api/client.ts's
    `AlternativePlanResponse` interface exactly — do not add a
    snake_case key here, it will silently fail to deserialize on the
    frontend."""
    from app.services.scenario_store import get_scenario

    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        return {"feasible": False, "reason": f"Unknown scenario_id '{request.scenario_id}'",
                "changes": [], "tradeOffs": []}

    graph = build_graph(scenario)
    params = scenario.default_params

    baseline_plans = assign_shelters_and_routes(scenario, graph, request.random_seed)
    baseline_result = simulate(scenario, baseline_plans, params,
                                 CongestionModel(scenario, params), plan_label="baseline")

    alt_plans = _k_nearest_balanced_assignment(scenario, graph, request.random_seed)
    alt_result = simulate(scenario, alt_plans, params,
                            CongestionModel(scenario, params), plan_label="alternative")

    improved_unserved = alt_result.metrics.unserved_count < baseline_result.metrics.unserved_count
    improved_congestion = alt_result.metrics.max_congestion_ratio < baseline_result.metrics.max_congestion_ratio
    not_worse_unserved = alt_result.metrics.unserved_count <= baseline_result.metrics.unserved_count

    if not (not_worse_unserved and (improved_unserved or improved_congestion)):
        return {
            "feasible": False,
            "reason": (
                f"Load-balanced reassignment did not improve on the baseline: "
                f"unserved {alt_result.metrics.unserved_count} vs baseline "
                f"{baseline_result.metrics.unserved_count}, peak congestion "
                f"{alt_result.metrics.max_congestion_ratio:.2f} vs baseline "
                f"{baseline_result.metrics.max_congestion_ratio:.2f}."
            ),
            "changes": [], "tradeOffs": [],
        }

    changes = []
    for alt_plan, base_plan in zip(alt_plans, baseline_plans):
        if alt_plan.assigned_shelter != base_plan.assigned_shelter:
            changes.append({
                "agentId": alt_plan.agent_id,
                "originZone": alt_plan.origin_zone,
                "oldShelter": base_plan.assigned_shelter,
                "newShelter": alt_plan.assigned_shelter,
                "reason": "reassigned to balance shelter load",
            })

    return {
        "feasible": True,
        "runId": str(uuid.uuid4()),
        "planLabel": "alternative",
        "baselineRun": baseline_result.model_dump(by_alias=True),
        "alternativeRun": alt_result.model_dump(by_alias=True),
        "changes": changes,
        "tradeOffs": [
            f"{len(changes)} of {len(alt_plans)} agents reassigned to a different shelter",
            f"unserved: {baseline_result.metrics.unserved_count} -> {alt_result.metrics.unserved_count}",
            f"peak congestion ratio: {baseline_result.metrics.max_congestion_ratio:.2f} -> "
            f"{alt_result.metrics.max_congestion_ratio:.2f}",
        ],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/optimization/test_planner.py -v`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/app/optimization/planner.py backend/tests/optimization/
git commit -m "feat(optimization): load-balanced alternative-plan heuristic with honest feasibility check"
```

---

### Remaining tasks (checklist)

- [ ] **PRD §13.1 "Route cost is calculated correctly for a known small graph"** — add one more `test_graph.py` case with 3 parallel routes of different `base_travel_time_s` and assert Dijkstra picks the cheapest, not the fewest-hops one (this matters once hop-count and time-cost disagree).
- [ ] **PRD §13.4 "The optimizer can report that no feasible improvement was found"** — add a test where both shelters have ample capacity and are equally reachable (optimizer should have nothing to improve); assert `feasible: False` with a non-empty `reason`.
- [ ] **PRD §7.2 objective #1, "avoid unsafe routes"** — once Member 3/4 wire up hazard-zone geometry, extend `compute_shortest_route`'s edge weight to add `edge.hazard_risk * HAZARD_PENALTY_SECONDS` on top of `base_travel_time_s`, so routes prefer lower-hazard edges when travel time is close. Keep the constant named and documented, same as `CongestionModel.PENALTY`.
- [ ] **Hand off to Member 5:** confirm `POST /api/optimization/plan` (routes.py) round-trips your `generate_alternative_plan` dict correctly — in particular that `baselineRun`/`alternativeRun`'s nested `.model_dump(by_alias=True)` output deserializes cleanly against `frontend/lib/api/client.ts`'s `AlternativePlanResponse` interface (Member 4 consumes this for the comparison view). This dict is hand-written camelCase (see the docstring on `generate_alternative_plan`) specifically because `routes.py`'s `optimize` endpoint has no `response_model` to apply `CamelModel`'s aliasing automatically — if you ever add a response_model here, re-verify the casing hasn't flipped back to snake_case.
- [ ] **Scenario B/C sanity check:** once those two derived fixture files exist (Member 6 owns creating them), run `generate_alternative_plan` against both and confirm it doesn't crash when a shelter has `available: false` (Scenario C) or when the only route to a shelter is closed (Scenario B) — the "no feasible shelter" candidate list should just come back empty for that demand unit, not throw.
