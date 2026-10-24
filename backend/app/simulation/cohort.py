from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, replace

from app.models.schemas import AgentPlan, ScenarioConfig, SimulationParams
from app.simulation.dynamics import RoadClosures, other_end
from app.simulation.engine import MOVEMENT_PROFILE_TIME_MULTIPLIER, admit_at_door, route_start, shelter_full


@dataclass(frozen=True)
class Cohort:
    """Evacuees who share a route, movement profile, departure tick and
    shelter. The engine treats them identically, except that a road's line
    or a shelter's door may let only part of the group through in a tick,
    which splits it."""
    route_edge_ids: tuple[str, ...]
    movement_profile: str
    departure_tick: int
    shelter_id: str
    count: int
    origin_node: str = ""  # the zone's junction; worked out from the route when empty


@dataclass(frozen=True)
class CohortMetrics:
    evacuated: int
    unserved: int
    rejected: int  # reached a full shelter
    timed_out: int  # still walking (or waiting at a door) at max_ticks
    completion_tick: int | None  # None when the run hit max_ticks
    hit_tick_limit: bool
    max_congestion_ratio: float
    mean_arrival_tick: float  # over evacuees who arrived; 0.0 if none did
    cut_off: int = 0  # every road to their shelter flooded


@dataclass
class _State:
    cohort: Cohort
    count: int
    multiplier: float
    ready_since: int
    route: tuple[str, ...]
    node: str
    edge_index: int = 0
    ticks_remaining: int = 0
    waiting: bool = True
    done: bool = False
    at_door: bool = False
    door_since: int = 0

    @property
    def order_key(self) -> tuple:
        # Same tie-break as app.simulation.engine.queue_order_key (the planned route, not a detour).
        c = self.cohort
        return (c.route_edge_ids, c.movement_profile, c.departure_tick, c.shelter_id)


def cohorts_from_plans(plans: list[AgentPlan], scenario: ScenarioConfig | None = None) -> tuple[list[Cohort], int]:
    """Group identical agent plans. Returns (cohorts, agents with no route)."""
    zone_nodes = {z.id: z.connector_node for z in scenario.zones} if scenario else {}
    groups: Counter[tuple] = Counter()
    unassigned = 0
    for p in plans:
        if p.assigned_shelter is None or not p.route_edge_ids:
            unassigned += 1
        else:
            groups[(tuple(p.route_edge_ids), p.movement_profile, p.departure_tick, p.assigned_shelter,
                    zone_nodes.get(p.origin_zone, ""))] += 1
    # First-seen order keeps evaluation order stable for the same plan list.
    return [Cohort(route, profile, dep, shelter, n, node) for (route, profile, dep, shelter, node), n in groups.items()], unassigned


def simulate_cohorts(
    scenario: ScenarioConfig, cohorts: list[Cohort], params: SimulationParams, unassigned: int = 0,
) -> CohortMetrics:
    """Run the engine's tick rules on groups instead of individuals.

    Gives the same metrics as app.simulation.engine.simulate for the same
    plans (tests/simulation/test_cohort.py checks this on random plans,
    flooding roads and slow shelter doors included) at a fraction of the
    cost, so the plan optimizer and the surrogate's training data can afford
    thousands of runs. The engine stays the source of truth for every result
    shown to a user."""
    edges = {e.id: e for e in scenario.edges}
    shelters = {s.id: s.model_copy() for s in scenario.shelters}
    closures = RoadClosures(scenario)
    states = [
        _State(c, c.count, MOVEMENT_PROFILE_TIME_MULTIPLIER.get(c.movement_profile, 1.0), c.departure_tick,
               c.route_edge_ids, route_start(c.route_edge_ids, edges, c.origin_node))
        for c in cohorts if c.count > 0
    ]
    door: dict[str, list[_State]] = {}

    peak = 0.0
    evacuated = rejected = cut_off = 0
    arrival_tick_sum = 0
    last_arrival: int | None = None
    tick = 0
    hit_tick_limit = False

    def departed(s: _State) -> bool:
        return not s.done and not s.at_door and not (s.waiting and tick < s.cohort.departure_tick)

    while any(not s.done for s in states):
        if tick >= params.max_ticks:
            hit_tick_limit = True
            break

        in_line: dict[str, list[_State]] = {}
        for s in states:
            if departed(s) and (s.waiting or s.ticks_remaining <= 0):
                if closures.any and closures.is_closed(s.route[s.edge_index], tick):
                    detour = closures.detour(s.node, s.cohort.shelter_id, tick)
                    if detour is None:
                        s.done = True
                        cut_off += s.count
                        continue
                    s.route = s.route[:s.edge_index] + detour
                in_line.setdefault(s.route[s.edge_index], []).append(s)

        if not in_line and not any(door.values()):
            # Nobody is starting along a road or waiting at a door, so nothing
            # changes until someone leaves home or reaches the end of a road.
            upcoming = min((s.cohort.departure_tick if s.waiting else tick + s.ticks_remaining - 1
                            for s in states if not s.done), default=tick)
            if upcoming > tick:
                for s in states:
                    if not s.done and not s.waiting:
                        s.ticks_remaining -= upcoming - tick
                tick = upcoming
                continue

        # Admit up to capacity per road, longest-waiting first; split the group at the cut.
        admitted: set[int] = set()
        for edge_id, line in in_line.items():
            room = edges[edge_id].capacity_per_tick
            peak = max(peak, sum(s.count for s in line) / room)
            line.sort(key=lambda s: (s.ready_since, s.order_key))
            for s in line:
                if room <= 0:
                    break
                if s.count > room:
                    states.append(replace(s, count=s.count - room))  # stays in line
                    s.count = room
                admitted.add(id(s))
                room -= s.count

        for s in states:
            if not departed(s):
                continue
            if s.waiting or s.ticks_remaining <= 0:
                s.waiting = False
                if id(s) not in admitted:
                    s.ticks_remaining = 0
                    continue
                edge = edges[s.route[s.edge_index]]
                s.ticks_remaining = max(1, round((edge.base_travel_time_s * s.multiplier) / params.tick_seconds))

            s.ticks_remaining -= 1
            if s.ticks_remaining > 0:
                continue

            s.node = other_end(edges, s.route[s.edge_index], s.node)
            s.edge_index += 1
            if s.edge_index < len(s.route):
                s.ticks_remaining = 0
                s.ready_since = tick + 1
                continue

            s.at_door = True
            s.door_since = tick
            door.setdefault(s.cohort.shelter_id, []).append(s)

        # Shelter doors, as in the engine; split the group at the intake cut.
        for shelter_id, queue in door.items():
            if not queue:
                continue
            shelter = shelters.get(shelter_id)
            queue.sort(key=lambda s: (s.door_since, s.order_key))
            take = admit_at_door(shelter, tick, sum(s.count for s in queue))
            while take > 0:
                s = queue[0]
                if s.count > take:
                    rest = replace(s, count=s.count - take)
                    states.append(rest)
                    queue[0] = rest
                    s.count = take
                else:
                    queue.pop(0)
                s.done = True
                shelter.occupied += s.count
                evacuated += s.count
                arrival_tick_sum += s.count * tick
                last_arrival = tick
                take -= s.count
            if shelter_full(shelter):
                for s in queue:
                    s.done = True
                    rejected += s.count
                queue.clear()

        tick += 1

    timed_out = sum(s.count for s in states if not s.done)
    return CohortMetrics(
        evacuated=evacuated,
        unserved=unassigned + rejected + timed_out + cut_off,
        rejected=rejected,
        timed_out=timed_out,
        completion_tick=None if hit_tick_limit else last_arrival,
        hit_tick_limit=hit_tick_limit,
        max_congestion_ratio=peak,
        mean_arrival_tick=arrival_tick_sum / evacuated if evacuated else 0.0,
        cut_off=cut_off,
    )


def simulate_plans_fast(scenario: ScenarioConfig, plans: list[AgentPlan], params: SimulationParams) -> CohortMetrics:
    cohorts, unassigned = cohorts_from_plans(plans, scenario)
    return simulate_cohorts(scenario, cohorts, params, unassigned)
