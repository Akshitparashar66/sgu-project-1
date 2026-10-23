from __future__ import annotations

import networkx as nx

from app.models.schemas import RoadEdge, RoadStatus, ScenarioConfig

# Extra routing cost, in seconds, for an edge at hazard_risk 1.0 (scaled
# linearly below that). A tie-breaker that steers routes off hazardous
# edges when travel times are close (PRD §7.2 objective #1) — not a
# closure: an edge that saves more time than its penalty still wins.
# Only route *choice* uses it; simulated travel time stays physical.
HAZARD_PENALTY_SECONDS = 120.0


def routing_cost_s(edge: RoadEdge) -> float:
    return edge.base_travel_time_s + edge.hazard_risk * HAZARD_PENALTY_SECONDS


def build_graph(scenario: ScenarioConfig) -> nx.Graph:
    """Undirected graph of OPEN edges only. Closed/restricted edges are
    never added, so no shortest-path call can ever route through one."""
    graph = nx.Graph()
    for node in scenario.nodes:
        graph.add_node(node.id)
    for edge in scenario.edges:
        if edge.status != RoadStatus.OPEN:
            continue
        graph.add_edge(edge.source, edge.target, edge_id=edge.id, weight=routing_cost_s(edge))
    return graph


def compute_shortest_route(
    graph: nx.Graph, edges_by_id: dict[str, RoadEdge], source_node: str, target_node: str
) -> list[str] | None:
    """Dijkstra over hazard-weighted travel time (routing_cost_s). Returns
    an ordered list of edge ids, or None if no open-road path exists."""
    try:
        node_path = nx.shortest_path(graph, source_node, target_node, weight="weight")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None
    return [graph[u][v]["edge_id"] for u, v in zip(node_path[:-1], node_path[1:])]
