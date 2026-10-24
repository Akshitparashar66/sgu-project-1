from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field

from app.models.schemas import (
    AgentPlan, AgentResult, AgentStatus, CamelModel, EdgeCongestionResult, RunMetrics,
    RunResult, ScenarioConfig, ShelterResult, SimulationParams,
)
from app.routing.assignment import assign_shelters_and_routes
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph
from app.services.scenario_overrides import WhatIfOverrides
from app.simulation.dynamics import RoadClosures, other_end
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
    # Reached its shelter's door and found it full. Distinct from running out
    # of time on the way, which also ends UNSERVED but was never turned away.
    rejected: bool = False
    entry_ticks: list[int] = field(default_factory=list)
    exit_ticks: list[int] = field(default_factory=list)
    # Tick it joined the line for its next road (its departure tick for the first one).
    ready_since: int = 0
    # The route actually walked: the plan's, unless a road flooded and it re-routed.
    route: list[str] = field(default_factory=list)
    node: str = ""  # junction it is at or last left
    at_door: bool = False  # walked the whole route, waiting to be let into the shelter
    door_since: int = 0
    cut_off: bool = False  # every way to its shelter flooded


def queue_order_key(plan: AgentPlan) -> tuple:
    """Tie-break between people who joined a road's line in the same tick: a
    fixed order over identical groups (same route, profile, departure and
    shelter). Any fixed order is as fair as another; this one lets the
    group-level simulation (app.simulation.cohort) reproduce the engine exactly."""
    return (tuple(plan.route_edge_ids), plan.movement_profile, plan.departure_tick, plan.assigned_shelter or "")


def _active(a: _AgentState) -> bool:
    return a.status in (AgentStatus.WAITING, AgentStatus.MOVING, AgentStatus.DELAYED)


def _not_yet_departed(a: _AgentState, tick: int) -> bool:
    return a.status == AgentStatus.WAITING and tick < a.plan.departure_tick


def _needs_next_edge(a: _AgentState) -> bool:
    """Not yet on a road: about to start, or just off one and in line for the next."""
    return not a.at_door and (a.status == AgentStatus.WAITING or a.ticks_remaining_on_edge <= 0)


def route_start(route, edges_by_id: dict, zone_node: str | None) -> str:
    """The junction a route starts from: the zone's, or worked out from the route itself."""
    if zone_node:
        return zone_node
    first = edges_by_id[route[0]]
    if len(route) > 1:
        second = edges_by_id[route[1]]
        return first.target if first.source in (second.source, second.target) else first.source
    return first.source


def admit_at_door(shelter, tick: int, waiting: int) -> int:
    """How many of `waiting` people a shelter lets in this tick: none before it
    opens, at most `intake_per_tick`, never past capacity."""
    if shelter is None or tick < shelter.opens_at_tick:
        return 0
    free = max(0, shelter.total_capacity - shelter.occupied)
    return min(waiting, free, shelter.intake_per_tick or waiting)


def shelter_full(shelter) -> bool:
    return shelter is None or shelter.occupied >= shelter.total_capacity


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
    zone_nodes = {z.id: z.connector_node for z in scenario.zones}
    closures = RoadClosures(scenario)
    agents = [
        _AgentState(plan=p, ready_since=p.departure_tick, route=list(p.route_edge_ids),
                    node=route_start(p.route_edge_ids, edges_by_id, zone_nodes.get(p.origin_zone)) if p.route_edge_ids else "")
        for p in plans
    ]
    order_keys = [queue_order_key(p) for p in plans]
    door: dict[str, list[int]] = {}
    # Seconds spent waiting in line for each road, summed over everyone.
    delay_by_edge: dict[str, float] = {}

    # Agents with no feasible route are unserved from tick 0 — never
    # silently dropped (PRD §6.3). They were never turned away at a shelter
    # door, so rejected_count can't explain them; a per-zone warning does.
    unassigned_by_zone: dict[str, int] = {}
    for a in agents:
        if a.plan.assigned_shelter is None or not a.plan.route_edge_ids:
            a.status = AgentStatus.UNSERVED
            unassigned_by_zone[a.plan.origin_zone] = unassigned_by_zone.get(a.plan.origin_zone, 0) + 1
    warnings: list[str] = [
        f"{count} agents from zone {zone_id} had no feasible shelter assignment "
        f"(no reachable shelter with remaining capacity)"
        for zone_id, count in unassigned_by_zone.items()
    ]

    tick = 0
    hit_tick_limit = False

    while any(_active(a) for a in agents):
        if tick >= params.max_ticks:
            hit_tick_limit = True
            break

        # Everyone who wants to start along a road this tick, by road. Anyone
        # whose next road has flooded re-routes from where they stand first.
        in_line: dict[str, list[int]] = {}
        for i, a in enumerate(agents):
            if _active(a) and not _not_yet_departed(a, tick) and _needs_next_edge(a):
                if closures.any and closures.is_closed(a.route[a.edge_index], tick):
                    detour = closures.detour(a.node, a.plan.assigned_shelter, tick)
                    if detour is None:
                        a.status = AgentStatus.UNSERVED
                        a.cut_off = True
                        continue
                    a.route = a.route[:a.edge_index] + list(detour)
                in_line.setdefault(a.route[a.edge_index], []).append(i)

        # Each road lets in at most its capacity, longest-waiting first.
        admitted: set[int] = set()
        for edge_id, line in in_line.items():
            congestion_model.register_tick(edge_id, tick, len(line))
            line.sort(key=lambda i: (agents[i].ready_since, order_keys[i], i))
            admitted.update(line[:congestion_model.entry_capacity(edge_id)])

        for i, a in enumerate(agents):
            if not _active(a) or _not_yet_departed(a, tick):
                continue

            if a.at_door:
                continue
            if _needs_next_edge(a):
                edge_id = a.route[a.edge_index]
                if i not in admitted:
                    a.status = AgentStatus.DELAYED
                    a.ticks_remaining_on_edge = 0
                    delay_by_edge[edge_id] = delay_by_edge.get(edge_id, 0.0) + params.tick_seconds
                    continue
                multiplier = MOVEMENT_PROFILE_TIME_MULTIPLIER.get(a.plan.movement_profile, 1.0)
                travel_s = congestion_model.travel_time_s(edge_id)
                a.ticks_remaining_on_edge = max(1, round((travel_s * multiplier) / params.tick_seconds))
                a.entry_ticks.append(tick)
                a.status = AgentStatus.MOVING

            a.ticks_remaining_on_edge -= 1
            if a.ticks_remaining_on_edge > 0:
                continue

            a.exit_ticks.append(tick)
            a.node = other_end(edges_by_id, a.route[a.edge_index], a.node)
            a.edge_index += 1
            if a.edge_index < len(a.route):
                a.ticks_remaining_on_edge = 0
                a.ready_since = tick + 1
                continue

            a.at_door = True
            a.door_since = tick
            a.status = AgentStatus.DELAYED
            door.setdefault(a.plan.assigned_shelter, []).append(i)

        # Shelter doors: let people in, keep them waiting outside, or turn them away once full.
        for shelter_id, queue in door.items():
            if not queue:
                continue
            shelter = shelters_by_id.get(shelter_id)
            queue.sort(key=lambda i: (agents[i].door_since, order_keys[i], i))
            take = admit_at_door(shelter, tick, len(queue))
            for i in queue[:take]:
                shelter.occupied += 1
                agents[i].status = AgentStatus.ARRIVED
                agents[i].arrival_tick = tick
            del queue[:take]
            if shelter_full(shelter):
                for i in queue:
                    agents[i].status = AgentStatus.UNSERVED
                    agents[i].rejected = True
                queue.clear()

        tick += 1

    for a in agents:
        if _active(a):
            a.status = AgentStatus.UNSERVED
            warnings.append(
                f"Agent {a.plan.agent_id} did not resolve within max_ticks={params.max_ticks}"
            )
    cut_off_by_zone: dict[str, int] = {}
    for a in agents:
        if a.cut_off:
            cut_off_by_zone[a.plan.origin_zone] = cut_off_by_zone.get(a.plan.origin_zone, 0) + 1
    warnings.extend(f"{count} agents from zone {zone_id} were cut off: every road to their shelter flooded"
                    for zone_id, count in cut_off_by_zone.items())

    agent_results = [
        AgentResult(
            id=a.plan.agent_id, origin_zone=a.plan.origin_zone,
            assigned_shelter=a.plan.assigned_shelter, route_edge_ids=a.route,
            status=a.status, arrival_tick=a.arrival_tick, movement_profile=a.plan.movement_profile,
            departure_tick=a.plan.departure_tick,
            edge_entry_ticks=a.entry_ticks, edge_exit_ticks=a.exit_ticks,
        )
        for a in agents
    ]

    shelter_results = [
        ShelterResult(
            shelter_id=s.id, total_capacity=s.total_capacity, final_occupied=s.occupied,
            rejected_count=sum(1 for a in agents if a.plan.assigned_shelter == s.id and a.rejected),
        )
        for s in shelters_by_id.values()
    ]

    congestion_results = [
        EdgeCongestionResult(
            edge_id=edge_id, peak_demand_to_capacity=ratio, peak_tick=peak_tick,
            total_delay_s=delay_by_edge.get(edge_id, 0.0),
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


class RunRequest(WhatIfOverrides):
    # CamelModel (not plain BaseModel) so the frontend can POST
    # {"scenarioId": "...", "planLabel": "baseline"} directly — see master
    # plan §3.1's note on CamelModel and §3.3's "already camelCase" note.
    scenario_id: str
    plan_label: str = "baseline"
    params: SimulationParams | None = None


def run_simulation(request: RunRequest) -> RunResult:
    # Local import: scenario_store only imports app.models.schemas, so there
    # is no circular-import risk; keeping it local lets tests monkeypatch
    # app.services.scenario_store.get_scenario.
    from app.services.scenario_store import get_scenario

    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        raise ValueError(f"Unknown scenario_id '{request.scenario_id}'")
    scenario = request.apply_to(scenario)

    params = request.params or scenario.default_params
    graph = build_graph(scenario)
    plans = assign_shelters_and_routes(scenario, graph, params.random_seed)
    congestion_model = CongestionModel(scenario, params)

    return simulate(scenario, plans, params, congestion_model, plan_label=request.plan_label)
