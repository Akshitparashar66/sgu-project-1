from __future__ import annotations

import networkx as nx

from app.models.schemas import ScenarioConfig
from app.routing.assignment import assign_shelters_and_routes
from app.routing.graph import build_graph
from app.simulation.engine import MOVEMENT_PROFILE_TIME_MULTIPLIER

# Order matters: the trained model reads features by position.
FEATURE_NAMES = [
    "evacuees",
    "reduced_mobility_share",
    "reachable_capacity",
    "capacity_shortfall",
    "unreachable_evacuees",
    "open_edge_share",
    "walking_speed_m_s",
    "mean_free_flow_min",
    "max_free_flow_min",
    "max_free_flow_slow_min",
    "throughput_per_tick",
    "evacuees_per_throughput",
    "max_edge_load_ratio",
    "mean_edge_load_ratio",
    "first_edge_load_ratio",
    "share_not_at_nearest_shelter",
    "mean_hazard_on_route",
    "time_limit_min",
    "share_on_flooding_roads",
    "first_flood_min",
    "latest_shelter_opening_min",
    "slowest_door_min",
]


def scenario_features(scenario: ScenarioConfig, random_seed: int | None = None) -> list[float]:
    """Describe a scenario (with its closures and offline shelters already
    applied) by quantities that don't depend on its road or shelter ids, so
    the surrogate generalises to networks it was not trained on.

    Several features come from the baseline assignment (who goes where,
    before any simulation). That costs a few milliseconds; the congestion
    and timing that follow are what the model predicts."""
    seed = scenario.default_params.random_seed if random_seed is None else random_seed
    edges = {e.id: e for e in scenario.edges}
    tick_minutes = scenario.default_params.tick_seconds / 60
    graph = build_graph(scenario)

    evacuees = sum(z.evacuee_count for z in scenario.zones)
    slow = sum(z.evacuee_count * z.movement_profile.get("reduced_mobility", 0.0) / (sum(z.movement_profile.values()) or 1)
               for z in scenario.zones)

    # Free-flow walking time (no congestion, no hazard tie-breaker) to the nearest open shelter.
    open_shelters = [s for s in scenario.shelters if s.available and s.total_capacity > s.occupied]
    time_graph = nx.Graph()
    time_graph.add_nodes_from(n.id for n in scenario.nodes)
    for e in scenario.edges:
        if e.status.value == "open":
            time_graph.add_edge(e.source, e.target, t=e.base_travel_time_s, cap=e.capacity_per_tick)
    nearest_s: dict[str, float] = {}
    reachable_shelters: set[str] = set()
    for zone in scenario.zones:
        if zone.connector_node not in time_graph:
            continue
        times = nx.single_source_dijkstra_path_length(time_graph, zone.connector_node, weight="t")
        reach = [(times[s.connector_node], s.id) for s in open_shelters if s.connector_node in times]
        reachable_shelters.update(sid for _, sid in reach)
        if reach:
            nearest_s[zone.id] = min(reach)[0]
    reachable_capacity = sum(s.total_capacity - s.occupied for s in open_shelters if s.id in reachable_shelters)
    reachable_people = sum(z.evacuee_count for z in scenario.zones if z.id in nearest_s)
    mean_free_flow = (sum(nearest_s[z.id] * z.evacuee_count for z in scenario.zones if z.id in nearest_s)
                      / reachable_people / 60) if reachable_people else 0.0
    max_free_flow = max(nearest_s.values(), default=0.0) / 60

    # Max people per tick the open roads can carry from all zones to all open shelters.
    flow_graph = nx.DiGraph()
    for u, v, data in time_graph.edges(data=True):
        flow_graph.add_edge(u, v, capacity=data["cap"])
        flow_graph.add_edge(v, u, capacity=data["cap"])
    for zone in scenario.zones:
        if zone.id in nearest_s:
            flow_graph.add_edge("_source", zone.connector_node, capacity=float("inf"))
    for s in open_shelters:
        if s.id in reachable_shelters:
            flow_graph.add_edge(s.connector_node, "_sink", capacity=float("inf"))
    throughput = (nx.maximum_flow_value(flow_graph, "_source", "_sink")
                  if "_source" in flow_graph and "_sink" in flow_graph else 0.0)

    # How the baseline assignment loads each road.
    plans = assign_shelters_and_routes(scenario, graph, seed)
    routed = [p for p in plans if p.route_edge_ids]
    load: dict[str, int] = {}
    first_load: dict[str, int] = {}
    hazard = 0.0
    off_nearest = 0
    slowest_route_min = 0.0
    nearest_shelter = {}
    for p in routed:
        for e in p.route_edge_ids:
            load[e] = load.get(e, 0) + 1
            hazard += edges[e].hazard_risk
        first_load[p.route_edge_ids[0]] = first_load.get(p.route_edge_ids[0], 0) + 1
        route_min = sum(edges[e].base_travel_time_s for e in p.route_edge_ids) / 60
        slowest_route_min = max(slowest_route_min, route_min * MOVEMENT_PROFILE_TIME_MULTIPLIER.get(p.movement_profile, 1.0))
        nearest_shelter.setdefault(p.origin_zone, p.assigned_shelter)
    # The first evacuee assigned from each zone took its nearest shelter; anyone else sent elsewhere overflowed.
    off_nearest = sum(1 for p in routed if p.assigned_shelter != nearest_shelter[p.origin_zone])
    ratios = [n / edges[e].capacity_per_tick for e, n in load.items()]

    # Roads that flood mid-run, and shelters that open late or register slowly.
    limit_min = scenario.default_params.max_ticks * tick_minutes
    floods = {e.id: e.closes_at_tick for e in scenario.edges if e.closes_at_tick is not None}
    on_flooding = sum(1 for p in routed if floods.keys() & set(p.route_edge_ids))
    first_flood = min((floods[e] for p in routed for e in p.route_edge_ids if e in floods), default=None)
    shelters = {s.id: s for s in scenario.shelters}
    assigned: dict[str, int] = {}
    for p in routed:
        assigned[p.assigned_shelter] = assigned.get(p.assigned_shelter, 0) + 1
    latest_opening = max((shelters[s].opens_at_tick for s in assigned), default=0) * tick_minutes
    slowest_door = max((n / shelters[s].intake_per_tick for s, n in assigned.items() if shelters[s].intake_per_tick),
                       default=0.0) * tick_minutes

    total_length = sum(e.length_m for e in scenario.edges)
    total_time = sum(e.base_travel_time_s for e in scenario.edges)

    return [
        float(evacuees),
        slow / evacuees if evacuees else 0.0,
        float(reachable_capacity),
        float(max(0, reachable_people - reachable_capacity)),
        float(evacuees - reachable_people),
        sum(1 for e in scenario.edges if e.status.value == "open") / len(scenario.edges),
        total_length / total_time if total_time else 0.0,
        mean_free_flow,
        max_free_flow,
        slowest_route_min,
        float(throughput),
        evacuees / throughput * tick_minutes if throughput else 0.0,
        max(ratios, default=0.0),
        sum(ratios) / len(ratios) if ratios else 0.0,
        max((n / edges[e].capacity_per_tick for e, n in first_load.items()), default=0.0),
        off_nearest / len(routed) if routed else 0.0,
        hazard / len(routed) if routed else 0.0,
        limit_min,
        on_flooding / len(routed) if routed else 0.0,
        first_flood * tick_minutes if first_flood is not None else limit_min,
        latest_opening,
        slowest_door,
    ]
