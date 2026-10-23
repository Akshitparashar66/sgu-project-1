from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from app.models.schemas import AgentPlan, ScenarioConfig, SimulationParams
from app.routing.congestion import CongestionModel
from app.simulation.engine import MOVEMENT_PROFILE_TIME_MULTIPLIER


@dataclass(frozen=True)
class Cohort:
    """Evacuees who share a route, movement profile, departure tick and
    shelter. They enter every edge in the same tick and are delayed the same
    way, so the engine treats them identically until the shelter door."""
    route_edge_ids: tuple[str, ...]
    movement_profile: str
    departure_tick: int
    shelter_id: str
    count: int


@dataclass(frozen=True)
class CohortMetrics:
    evacuated: int
    unserved: int
    rejected: int  # reached a full shelter
    timed_out: int  # still walking at max_ticks
    completion_tick: int | None  # None when the run hit max_ticks
    hit_tick_limit: bool
    max_congestion_ratio: float
    mean_arrival_tick: float  # over evacuees who arrived; 0.0 if none did


@dataclass
class _State:
    cohort: Cohort
    multiplier: float
    edge_index: int = 0
    ticks_remaining: int = 0
    waiting: bool = True
    done: bool = False


def cohorts_from_plans(plans: list[AgentPlan]) -> tuple[list[Cohort], int]:
    """Group identical agent plans. Returns (cohorts, agents with no route)."""
    groups: Counter[tuple] = Counter()
    unassigned = 0
    for p in plans:
        if p.assigned_shelter is None or not p.route_edge_ids:
            unassigned += 1
        else:
            groups[(tuple(p.route_edge_ids), p.movement_profile, p.departure_tick, p.assigned_shelter)] += 1
    # First-seen order keeps evaluation order stable for the same plan list.
    return [Cohort(*key, count=n) for key, n in groups.items()], unassigned


def simulate_cohorts(
    scenario: ScenarioConfig, cohorts: list[Cohort], params: SimulationParams, unassigned: int = 0,
) -> CohortMetrics:
    """Run the engine's tick rules on groups instead of individuals.

    Gives the same metrics as app.simulation.engine.simulate for the same
    plans (tests/simulation/test_cohort.py checks this on random plans) at a
    fraction of the cost, so the plan optimizer and the surrogate's training
    data can afford thousands of runs. The engine stays the source of truth
    for every result shown to a user."""
    edges = {e.id: e for e in scenario.edges}
    free = {s.id: s.total_capacity - s.occupied for s in scenario.shelters}
    states = [_State(c, MOVEMENT_PROFILE_TIME_MULTIPLIER.get(c.movement_profile, 1.0)) for c in cohorts if c.count > 0]

    peak = 0.0
    evacuated = rejected = 0
    arrival_tick_sum = 0
    last_arrival: int | None = None
    tick = 0
    hit_tick_limit = False

    def departed(s: _State) -> bool:
        return not s.done and not (s.waiting and tick < s.cohort.departure_tick)

    while any(not s.done for s in states):
        if tick >= params.max_ticks:
            hit_tick_limit = True
            break

        entering: dict[str, int] = {}
        for s in states:
            if departed(s) and (s.waiting or s.ticks_remaining <= 0):
                edge_id = s.cohort.route_edge_ids[s.edge_index]
                entering[edge_id] = entering.get(edge_id, 0) + s.cohort.count

        for s in states:
            if not departed(s):
                continue
            if s.waiting:
                s.waiting = False
                s.ticks_remaining = -1

            if s.ticks_remaining < 0:
                edge = edges[s.cohort.route_edge_ids[s.edge_index]]
                ratio = entering.get(edge.id, 0) / edge.capacity_per_tick
                factor = 1.0 if ratio <= 1.0 else 1.0 + (ratio - 1.0) * CongestionModel.PENALTY
                peak = max(peak, ratio)
                s.ticks_remaining = max(1, round((edge.base_travel_time_s * factor * s.multiplier) / params.tick_seconds))

            s.ticks_remaining -= 1
            if s.ticks_remaining > 0:
                continue

            s.edge_index += 1
            if s.edge_index < len(s.cohort.route_edge_ids):
                s.ticks_remaining = -1
                continue

            s.done = True
            shelter_id = s.cohort.shelter_id
            admitted = max(0, min(s.cohort.count, free.get(shelter_id, 0)))
            if shelter_id in free:
                free[shelter_id] -= admitted
            evacuated += admitted
            rejected += s.cohort.count - admitted
            if admitted:
                arrival_tick_sum += admitted * tick
                last_arrival = tick

        tick += 1

    timed_out = sum(s.cohort.count for s in states if not s.done)
    return CohortMetrics(
        evacuated=evacuated,
        unserved=unassigned + rejected + timed_out,
        rejected=rejected,
        timed_out=timed_out,
        completion_tick=None if hit_tick_limit else last_arrival,
        hit_tick_limit=hit_tick_limit,
        max_congestion_ratio=peak,
        mean_arrival_tick=arrival_tick_sum / evacuated if evacuated else 0.0,
    )


def simulate_plans_fast(scenario: ScenarioConfig, plans: list[AgentPlan], params: SimulationParams) -> CohortMetrics:
    cohorts, unassigned = cohorts_from_plans(plans)
    return simulate_cohorts(scenario, cohorts, params, unassigned)
