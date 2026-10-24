from __future__ import annotations

import math

import networkx as nx

from app.models.schemas import ScenarioConfig, SimulationParams
from app.routing.assignment import split_zone_population
from app.simulation.engine import MOVEMENT_PROFILE_TIME_MULTIPLIER


def clearance_lower_bound(scenario: ScenarioConfig, params: SimulationParams) -> int | None:
    """A completion tick no plan can beat, so a plan's quality can be judged
    against the best possible, not just against the baseline.

    Two independent limits, the larger of which binds:

    * Walking: each group needs at least its shortest walk, in the engine's
      own whole ticks per road, to reach any open shelter.
    * Throughput: every evacuee must cross any cut between the zones and the
      shelters, and a road lets at most `capacity_per_tick` people in per
      tick. With F the network's maximum flow per tick, sheltering N people
      takes at least ceil(N / F) ticks of entries.

    Returns None when nobody can reach a shelter. Ignores shelter opening
    times and roads that close mid-run, which only make the true optimum
    later, so the bound stays valid (if looser) for those scenarios.
    """
    open_shelters = [s for s in scenario.shelters if s.available and s.total_capacity > s.occupied]
    shelter_nodes = {s.connector_node for s in open_shelters}
    open_edges = [e for e in scenario.edges if e.status.value == "open"]

    def walk_ticks(multiplier: float) -> nx.Graph:
        g = nx.Graph()
        g.add_nodes_from(n.id for n in scenario.nodes)
        for e in open_edges:
            g.add_edge(e.source, e.target,
                       ticks=max(1, round(e.base_travel_time_s * multiplier / params.tick_seconds)))
        return g

    walk_bound = -1
    reachable_people = 0
    graphs: dict[float, nx.Graph] = {}
    for zone in scenario.zones:
        for profile, count in split_zone_population(zone):
            if count == 0:
                continue
            m = MOVEMENT_PROFILE_TIME_MULTIPLIER.get(profile, 1.0)
            g = graphs.setdefault(m, walk_ticks(m))
            if zone.connector_node not in g:
                continue
            dist = nx.single_source_dijkstra_path_length(g, zone.connector_node, weight="ticks")
            reachable = [dist[n] for n in shelter_nodes if n in dist]
            if reachable:
                # Enter the first road at tick 0 at the earliest; arrive on the tick the last road is left.
                walk_bound = max(walk_bound, min(reachable) - 1)
                reachable_people += count
    if walk_bound < 0:
        return None

    flow = nx.DiGraph()
    for e in open_edges:
        # Each direction gets the full capacity: overstating the flow only loosens the bound.
        flow.add_edge(e.source, e.target, capacity=e.capacity_per_tick)
        flow.add_edge(e.target, e.source, capacity=e.capacity_per_tick)
    for zone in scenario.zones:
        flow.add_edge("_zones", zone.connector_node, capacity=math.inf)
    for node in shelter_nodes:
        flow.add_edge(node, "_shelters", capacity=math.inf)
    per_tick = nx.maximum_flow_value(flow, "_zones", "_shelters")
    served = min(reachable_people, sum(s.total_capacity - s.occupied for s in open_shelters))
    throughput_bound = math.ceil(served / per_tick) - 1 if per_tick > 0 and served > 0 else 0

    return max(walk_bound, throughput_bound)
