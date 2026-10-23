from __future__ import annotations

import math
import random

from app.models.schemas import AgentPlan, PopulationZone, ScenarioConfig
from app.routing.graph import compute_shortest_route


def split_zone_population(zone: PopulationZone) -> list[tuple[str, int]]:
    """Split a zone's evacuees across its movement profiles so the counts
    always sum to exactly `evacuee_count` (largest-remainder method).
    Rounding each fraction independently can lose or invent agents
    (3 x round(10/3) == 9), which would break the "agents never
    disappear" guarantee."""
    total_weight = sum(zone.movement_profile.values())
    if zone.evacuee_count == 0 or total_weight <= 0:
        return [(profile, 0) for profile in zone.movement_profile]

    exact = [
        (profile, zone.evacuee_count * weight / total_weight)
        for profile, weight in zone.movement_profile.items()
    ]
    counts = {profile: math.floor(value) for profile, value in exact}
    leftover = zone.evacuee_count - sum(counts.values())
    # Hand the leftover agents to the largest fractional remainders; ties
    # keep dict order so the split is deterministic.
    by_remainder = sorted(exact, key=lambda pv: pv[1] - math.floor(pv[1]), reverse=True)
    for profile, _ in by_remainder[:leftover]:
        counts[profile] += 1
    return [(profile, counts[profile]) for profile in zone.movement_profile]


def build_demand_units(scenario: ScenarioConfig, random_seed: int) -> list[tuple[PopulationZone, str]]:
    """One (zone, movement_profile) entry per evacuee, shuffled with the
    seeded RNG so tie-breaking between equally-near shelters is
    deterministic but not biased toward whichever zone is listed first
    (PRD §6.8 reproducibility)."""
    demand_units: list[tuple[PopulationZone, str]] = []
    for zone in scenario.zones:
        for profile, count in split_zone_population(zone):
            demand_units.extend([(zone, profile)] * count)
    random.Random(random_seed).shuffle(demand_units)
    return demand_units


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

    plans: list[AgentPlan] = []
    for i, (zone, profile) in enumerate(build_demand_units(scenario, random_seed)):
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
