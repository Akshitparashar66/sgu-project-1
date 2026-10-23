from __future__ import annotations

from app.models.schemas import ScenarioConfig


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

    for index, edge in enumerate(scenario.edges):
        check_node(f"edges.{index}.source", edge.source)
        check_node(f"edges.{index}.target", edge.target)
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
        "shelters": len(scenario.shelters),
        "evacuees": sum(z.evacuee_count for z in scenario.zones),
        "shelterCapacity": sum(s.total_capacity for s in scenario.shelters),
    }
