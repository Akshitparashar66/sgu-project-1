from __future__ import annotations

import math

from app.models.schemas import ScenarioConfig

# How far a road's drawn path may start/end from its nodes' coordinates.
GEOMETRY_END_TOLERANCE_M = 50.0


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    # Equirectangular approximation: plenty for a tolerance check at city scale.
    dlat = math.radians(b[0] - a[0])
    dlon = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(dlat, dlon)


def reference_errors(scenario: ScenarioConfig) -> list[dict]:
    """Checks Pydantic can't express on a single field: duplicate ids and
    references to nodes that don't exist. Returns [{field, message}] with
    camelCase field paths, matching Pydantic's own alias-based error
    locations, so the frontend shows both kinds identically."""
    errors: list[dict] = []

    for collection_name, items in (
        ("nodes", scenario.nodes), ("edges", scenario.edges),
        ("zones", scenario.zones), ("shelters", scenario.shelters),
    ):
        seen: set[str] = set()
        for index, item in enumerate(items):
            if item.id in seen:
                errors.append({"field": f"{collection_name}.{index}.id",
                               "message": f"Duplicate {collection_name[:-1]} id '{item.id}'"})
            seen.add(item.id)

    node_ids = {n.id for n in scenario.nodes}

    def check_node(field: str, node_id: str) -> None:
        if node_id not in node_ids:
            errors.append({"field": field, "message": f"References unknown node '{node_id}'"})

    nodes = {n.id: n for n in scenario.nodes}
    for index, edge in enumerate(scenario.edges):
        check_node(f"edges.{index}.source", edge.source)
        check_node(f"edges.{index}.target", edge.target)
        if edge.geometry and edge.source in nodes and edge.target in nodes:
            for end, node_id in ((edge.geometry[0], edge.source), (edge.geometry[-1], edge.target)):
                node = nodes[node_id]
                if _metres(end, (node.lat, node.lon)) > GEOMETRY_END_TOLERANCE_M:
                    errors.append({"field": f"edges.{index}.geometry",
                                   "message": f"Geometry must run from node '{edge.source}' to node '{edge.target}'"})
                    break
    for index, zone in enumerate(scenario.zones):
        check_node(f"zones.{index}.connectorNode", zone.connector_node)
    for index, shelter in enumerate(scenario.shelters):
        check_node(f"shelters.{index}.connectorNode", shelter.connector_node)

    return errors


def scenario_summary(scenario: ScenarioConfig) -> dict:
    return {
        "nodes": len(scenario.nodes),
        "edges": len(scenario.edges),
        "zones": len(scenario.zones),
        # Places available to the default plan; standby sites are listed separately.
        "shelters": sum(1 for s in scenario.shelters if s.available),
        "evacuees": sum(z.evacuee_count for z in scenario.zones),
        "shelterCapacity": sum(s.total_capacity for s in scenario.shelters if s.available),
        "standbyShelters": sum(1 for s in scenario.shelters if s.standby and not s.available),
        "standbyCapacity": sum(s.total_capacity for s in scenario.shelters if s.standby and not s.available),
    }
