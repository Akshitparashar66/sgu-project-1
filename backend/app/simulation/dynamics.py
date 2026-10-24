from __future__ import annotations

import networkx as nx

from app.models.schemas import RoadStatus, ScenarioConfig
from app.routing.graph import routing_cost_s


class RoadClosures:
    """Roads that close during a run (a flood reaching them) and the detours
    people take when the road they're waiting for is gone. Shared by the
    engine and the cohort simulation so both re-route identically."""

    def __init__(self, scenario: ScenarioConfig):
        self._edges = [e for e in scenario.edges if e.status == RoadStatus.OPEN]
        self._close_at = {e.id: e.closes_at_tick for e in self._edges if e.closes_at_tick is not None}
        self._shelter_node = {s.id: s.connector_node for s in scenario.shelters}
        self._routes: dict[tuple, tuple[str, ...] | None] = {}

    @property
    def any(self) -> bool:
        return bool(self._close_at)

    def is_closed(self, edge_id: str, tick: int) -> bool:
        closes = self._close_at.get(edge_id)
        return closes is not None and tick >= closes

    def detour(self, from_node: str, shelter_id: str, tick: int) -> tuple[str, ...] | None:
        """Cheapest route (same hazard-weighted cost as planning) from where the
        person stands to their shelter over roads still open at `tick`, or None
        if the water has cut them off."""
        closed = frozenset(e for e, t in self._close_at.items() if tick >= t)
        key = (from_node, shelter_id, closed)
        if key not in self._routes:
            graph = nx.Graph()
            for e in self._edges:
                if e.id not in closed:
                    graph.add_edge(e.source, e.target, edge_id=e.id, weight=routing_cost_s(e))
            target = self._shelter_node.get(shelter_id)
            try:
                path = nx.shortest_path(graph, from_node, target, weight="weight")
                self._routes[key] = tuple(graph[u][v]["edge_id"] for u, v in zip(path, path[1:])) or None
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                self._routes[key] = None
        return self._routes[key]


def other_end(scenario_edges: dict, edge_id: str, node: str) -> str:
    edge = scenario_edges[edge_id]
    return edge.target if edge.source == node else edge.source
