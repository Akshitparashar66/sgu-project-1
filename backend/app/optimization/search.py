from __future__ import annotations

import math
import random
from collections import Counter
from dataclasses import dataclass
from itertools import islice

import networkx as nx

from app.models.schemas import AgentPlan, ScenarioConfig, SimulationParams
from app.routing.assignment import build_demand_units
from app.routing.graph import HAZARD_PENALTY_SECONDS
from app.simulation.cohort import Cohort, CohortMetrics, simulate_cohorts

# Search space. Departures go out in waves a planner can announce
# ("Zone 2, reduced mobility: leave at +10 min"), on up to three routes per
# shelter, decided per block of evacuees rather than per person.
WAVE_MINUTES = 5
WAVES = 7  # leave at +0, +5, ... +30 min
ROUTES_PER_SHELTER = 3
MAX_DETOUR = 1.5  # an alternative route may be at most this much longer than the shortest one
TARGET_BLOCKS = 24
MIN_BLOCK_SIZE = 10

# Simulated annealing schedule. Fixed iteration count (not a time budget) so
# the same request always returns the same plan on any machine.
ITERATIONS = 1200
START_TEMPERATURE = 200.0  # in score units: about 20 ticks of clearance time
END_TEMPERATURE = 1.0


def plan_score(unserved: int, completion_tick: int | None, mean_arrival_tick: float,
               max_congestion_ratio: float, max_ticks: int, mean_hazard_ticks: float = 0.0) -> float:
    """Lower is better. Lexicographic in effect: one unserved evacuee
    outweighs any time saving, then clearance time (last arrival) dominates
    the average time to shelter. Hazard exposure is charged like extra
    walking time, at the baseline router's rate (HAZARD_PENALTY_SECONDS per
    unit of risk), so a hazardous shortcut must save more than it costs.
    Peak congestion only breaks ties."""
    completion = max_ticks if completion_tick is None else completion_tick
    return (unserved * 10_000 + completion * 10 + mean_arrival_tick + mean_hazard_ticks
            + max_congestion_ratio * 0.01)


def mean_hazard_ticks(scenario: ScenarioConfig, routes: list[tuple[tuple[str, ...], int]], tick_seconds: float) -> float:
    """Average hazard charge per routed evacuee, in ticks. `routes` holds (route, people) pairs."""
    risk = {e.id: e.hazard_risk for e in scenario.edges}
    people = sum(n for _, n in routes)
    if not people:
        return 0.0
    total = sum(n * sum(risk[e] for e in route) for route, n in routes)
    return total * HAZARD_PENALTY_SECONDS / tick_seconds / people


@dataclass(frozen=True)
class RouteOption:
    shelter_id: str
    route_edge_ids: tuple[str, ...]
    distance_m: float


@dataclass(frozen=True)
class Block:
    zone_id: str
    movement_profile: str
    count: int


@dataclass(frozen=True)
class EvacuationOrder:
    zone_id: str
    movement_profile: str
    people: int
    shelter_id: str
    route_edge_ids: tuple[str, ...]
    departure_tick: int


@dataclass
class SearchResult:
    plans: list[AgentPlan]
    orders: list[EvacuationOrder]
    predicted: CohortMetrics
    evaluations: int
    block_size: int


def route_options(scenario: ScenarioConfig, graph: nx.Graph) -> dict[str, list[RouteOption]]:
    """Per zone: up to ROUTES_PER_SHELTER open routes to every available
    shelter, by the same hazard-weighted cost the baseline routes on."""
    edges = {e.id: e for e in scenario.edges}
    options: dict[str, list[RouteOption]] = {}
    for zone in scenario.zones:
        zone_options = []
        for shelter in scenario.shelters:
            if not shelter.available or shelter.total_capacity - shelter.occupied <= 0:
                continue
            try:
                paths = list(islice(nx.shortest_simple_paths(
                    graph, zone.connector_node, shelter.connector_node, weight="weight"), ROUTES_PER_SHELTER))
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                continue
            shortest = None
            for path in paths:
                route = tuple(graph[u][v]["edge_id"] for u, v in zip(path, path[1:]))
                distance = sum(edges[e].length_m for e in route)
                shortest = shortest or distance
                if route and distance <= shortest * MAX_DETOUR:
                    zone_options.append(RouteOption(shelter.id, route, distance))
        options[zone.id] = sorted(zone_options, key=lambda o: o.distance_m)
    return options


def make_blocks(group_sizes: dict[tuple[str, str], int]) -> tuple[list[Block], int]:
    """Split each (zone, movement profile) group into near-equal blocks."""
    total = sum(group_sizes.values())
    block_size = max(MIN_BLOCK_SIZE, math.ceil(total / TARGET_BLOCKS))
    blocks = []
    for (zone_id, profile), n in group_sizes.items():
        parts = max(1, math.ceil(n / block_size))
        base, extra = divmod(n, parts)
        blocks.extend(Block(zone_id, profile, base + (1 if i < extra else 0)) for i in range(parts))
    return [b for b in blocks if b.count > 0], block_size


def optimize_plan(scenario: ScenarioConfig, graph: nx.Graph, params: SimulationParams, random_seed: int) -> SearchResult:
    """Simulated annealing over (shelter + route, departure wave) per block,
    scored by the cohort simulation (exactly the engine's metrics, ~100x
    faster). Deterministic for a given scenario and seed."""
    rng = random.Random(random_seed)
    wave_ticks = max(1, round(WAVE_MINUTES * 60 / params.tick_seconds))
    options = route_options(scenario, graph)
    demand = build_demand_units(scenario, random_seed)
    group_sizes = Counter((zone.id, profile) for zone, profile in demand)
    blocks, block_size = make_blocks(dict(group_sizes))
    # Blocks with no reachable shelter stay unserved, as in the baseline.
    unroutable = sum(b.count for b in blocks if not options[b.zone_id])
    movable = [i for i, b in enumerate(blocks) if options[b.zone_id]]

    def cohorts(solution: list[tuple[int, int]]) -> list[Cohort]:
        return [Cohort(p.option.route_edge_ids, blocks[p.block].movement_profile, p.departure_tick,
                       p.option.shelter_id, p.count)
                for p in _allocate(scenario, blocks, solution, options, movable, wave_ticks)]

    cache: dict[tuple, tuple[float, CohortMetrics]] = {}

    def evaluate(solution: list[tuple[int, int]]) -> float:
        key = tuple(solution)
        if key not in cache:
            groups = cohorts(solution)
            metrics = simulate_cohorts(scenario, groups, params, unassigned=unroutable)
            hazard = mean_hazard_ticks(scenario, [(c.route_edge_ids, c.count) for c in groups], params.tick_seconds)
            cache[key] = (plan_score(metrics.unserved, metrics.completion_tick, metrics.mean_arrival_tick,
                                     metrics.max_congestion_ratio, params.max_ticks, hazard), metrics)
        return cache[key][0]

    # Start like the baseline: nearest shelter with room for the block, everyone leaves at once.
    remaining = {s.id: s.total_capacity - s.occupied for s in scenario.shelters}
    current: list[tuple[int, int]] = [(0, 0)] * len(blocks)
    for i in movable:
        zone_options = options[blocks[i].zone_id]
        fits = [k for k, o in enumerate(zone_options) if remaining[o.shelter_id] >= blocks[i].count]
        k = fits[0] if fits else max(range(len(zone_options)), key=lambda k: remaining[zone_options[k].shelter_id])
        remaining[zone_options[k].shelter_id] -= blocks[i].count
        current[i] = (k, 0)

    current_score = evaluate(current)
    best, best_score = list(current), current_score
    for step in range(ITERATIONS if movable else 0):
        temperature = START_TEMPERATURE * (END_TEMPERATURE / START_TEMPERATURE) ** (step / ITERATIONS)
        candidate = list(current)
        i = rng.choice(movable)
        option, wave = candidate[i]
        move = rng.random()
        if move < 0.45:
            option = rng.randrange(len(options[blocks[i].zone_id]))
        elif move < 0.9:
            wave = min(WAVES - 1, max(0, wave + rng.choice((-1, 1))))
        else:  # follow another block of the same zone
            peers = [j for j in movable if blocks[j].zone_id == blocks[i].zone_id]
            option, wave = candidate[rng.choice(peers)]
        candidate[i] = (option, wave)

        score = evaluate(candidate)
        if score <= current_score or rng.random() < math.exp((current_score - score) / temperature):
            current, current_score = candidate, score
            if score < best_score:
                best, best_score = list(candidate), score

    best = _tidy(best, best_score, movable, evaluate)
    pieces = _allocate(scenario, blocks, best, options, movable, wave_ticks)

    return SearchResult(
        plans=_expand(demand, blocks, pieces),
        orders=_orders(blocks, pieces),
        predicted=cache[tuple(best)][1],
        evaluations=len(cache),
        block_size=block_size,
    )


def _tidy(solution, score, movable, evaluate):
    """Annealing leaves arbitrary choices wherever they didn't matter. Move
    each block to an earlier wave, then to a shorter route (options are
    sorted by distance), whenever that is no worse, so every delay and
    detour left in the plan is one that pays for itself."""
    solution = list(solution)
    for i in movable:
        option, wave = solution[i]
        for earlier in range(wave):
            trial = solution[:i] + [(option, earlier)] + solution[i + 1:]
            if (s := evaluate(trial)) <= score:
                solution, score = trial, s
                break
        option, wave = solution[i]
        for shorter in range(option):
            trial = solution[:i] + [(shorter, wave)] + solution[i + 1:]
            if (s := evaluate(trial)) <= score:
                solution, score = trial, s
                break
    return solution


@dataclass(frozen=True)
class _Piece:
    block: int
    option: RouteOption
    departure_tick: int
    count: int


def _allocate(scenario, blocks, solution, options, movable, wave_ticks: int) -> list[_Piece]:
    """Turn a solution into who-goes-where, repairing shelter capacity: the
    part of a block that won't fit its chosen shelter is sent (same wave) to
    the nearest shelter that still has room. Blocks are coarse, so without
    this a plan could turn people away that a per-person plan would house.
    Earlier waves claim places first."""
    remaining = {s.id: s.total_capacity - s.occupied for s in scenario.shelters}
    pieces = []
    for i in sorted(movable, key=lambda i: (solution[i][1], i)):
        option_index, wave = solution[i]
        zone_options = options[blocks[i].zone_id]
        left = blocks[i].count
        for option in [zone_options[option_index], *zone_options]:
            take = min(left, remaining[option.shelter_id])
            if take > 0:
                remaining[option.shelter_id] -= take
                pieces.append(_Piece(i, option, wave * wave_ticks, take))
                left -= take
            if left == 0:
                break
        if left:  # every shelter is full: they go as planned and are turned away at the door
            pieces.append(_Piece(i, zone_options[option_index], wave * wave_ticks, left))
    return sorted(pieces, key=lambda p: p.block)


def _expand(demand, blocks: list[Block], pieces: list[_Piece]) -> list[AgentPlan]:
    """Hand each evacuee (in the baseline's seeded order, so agent i is the
    same person in both plans) to the next open place in its group's pieces."""
    slots: dict[tuple[str, str], list[_Piece]] = {}
    for p in pieces:
        b = blocks[p.block]
        slots.setdefault((b.zone_id, b.movement_profile), []).extend([p] * p.count)
    taken: Counter[tuple[str, str]] = Counter()

    plans = []
    for n, (zone, profile) in enumerate(demand):
        key = (zone.id, profile)
        group = slots.get(key, [])
        if taken[key] < len(group):
            p = group[taken[key]]
            plans.append(AgentPlan(agent_id=f"{zone.id}-alt-{n}", origin_zone=zone.id,
                                   assigned_shelter=p.option.shelter_id, route_edge_ids=list(p.option.route_edge_ids),
                                   movement_profile=profile, distance_m=p.option.distance_m,
                                   departure_tick=p.departure_tick))
        else:  # no reachable shelter from this zone
            plans.append(AgentPlan(agent_id=f"{zone.id}-alt-{n}", origin_zone=zone.id, assigned_shelter=None,
                                   route_edge_ids=[], movement_profile=profile))
        taken[key] += 1
    return plans


def _orders(blocks: list[Block], pieces: list[_Piece]) -> list[EvacuationOrder]:
    people: Counter[tuple] = Counter()
    for p in pieces:
        b = blocks[p.block]
        people[(b.zone_id, b.movement_profile, p.option.shelter_id, p.option.route_edge_ids, p.departure_tick)] += p.count
    return sorted((EvacuationOrder(zone, profile, n, shelter, route, tick)
                   for (zone, profile, shelter, route, tick), n in people.items()),
                  key=lambda o: (o.departure_tick, o.zone_id, o.movement_profile, o.shelter_id))
