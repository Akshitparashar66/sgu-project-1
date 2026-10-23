from __future__ import annotations

from collections.abc import Sequence

from app.models.schemas import RoadStatus, ScenarioConfig


class InvalidOverrideError(ValueError):
    """An override names an edge or shelter the scenario doesn't have.
    Subclasses ValueError, so callers that only know "bad input" still
    catch it; the API layer catches it first to report a 400 with `field`."""

    def __init__(self, message: str, field: str):
        self.field = field
        super().__init__(message)


def apply_overrides(
    scenario: ScenarioConfig,
    closed_edge_ids: Sequence[str] = (),
    unavailable_shelter_ids: Sequence[str] = (),
) -> ScenarioConfig:
    """Return a copy of `scenario` with the given roads closed and shelters
    made unavailable — the what-if changes a planner makes in the Scenario
    Lab (PRD §5.2 Journey B). The input scenario is never mutated."""
    if not closed_edge_ids and not unavailable_shelter_ids:
        return scenario

    edge_ids = {e.id for e in scenario.edges}
    unknown_edges = sorted(set(closed_edge_ids) - edge_ids)
    if unknown_edges:
        raise InvalidOverrideError(f"Unknown edge id(s) in closedEdgeIds: {', '.join(unknown_edges)}",
                                   field="closedEdgeIds")

    shelter_ids = {s.id for s in scenario.shelters}
    unknown_shelters = sorted(set(unavailable_shelter_ids) - shelter_ids)
    if unknown_shelters:
        raise InvalidOverrideError(
            f"Unknown shelter id(s) in unavailableShelterIds: {', '.join(unknown_shelters)}",
            field="unavailableShelterIds",
        )

    overridden = scenario.model_copy(deep=True)
    closed = set(closed_edge_ids)
    for edge in overridden.edges:
        if edge.id in closed:
            edge.status = RoadStatus.CLOSED
    unavailable = set(unavailable_shelter_ids)
    for shelter in overridden.shelters:
        if shelter.id in unavailable:
            shelter.available = False
    return overridden
