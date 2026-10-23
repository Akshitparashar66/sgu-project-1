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
    # Seconds of congestion delay (effective minus free-flow travel time),
    # summed over every agent that entered each edge.
    delay_by_edge: dict[str, float] = {}

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
                base_s = edges_by_id[edge_id].base_travel_time_s
                delay_by_edge[edge_id] = delay_by_edge.get(edge_id, 0.0) + max(0.0, effective_s - base_s)
                ticks_needed = max(1, round((effective_s * multiplier) / params.tick_seconds))
                a.ticks_remaining_on_edge = ticks_needed
                a.status = (
                    AgentStatus.DELAYED
                    if effective_s > base_s * 1.1
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
