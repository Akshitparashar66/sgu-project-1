from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Annotated

from pydantic import Field

from app.models.schemas import CamelModel, RoadStatus, ScenarioConfig


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
    edge_capacity_factors: Mapping[str, float] | None = None,
) -> ScenarioConfig:
    """Return a copy of `scenario` with the given roads closed, shelters
    made unavailable and roads left with a share of their capacity — the
    what-if changes a planner makes in the Scenario Lab (PRD §5.2 Journey B),
    or applies from a live traffic alert. The input scenario is never mutated."""
    factors = edge_capacity_factors or {}
    if not closed_edge_ids and not unavailable_shelter_ids and not factors:
        return scenario

    edge_ids = {e.id for e in scenario.edges}
    unknown_edges = sorted(set(closed_edge_ids) - edge_ids)
    if unknown_edges:
        raise InvalidOverrideError(f"Unknown edge id(s) in closedEdgeIds: {', '.join(unknown_edges)}",
                                   field="closedEdgeIds")
    unknown_reduced = sorted(set(factors) - edge_ids)
    if unknown_reduced:
        raise InvalidOverrideError(f"Unknown edge id(s) in edgeCapacityFactors: {', '.join(unknown_reduced)}",
                                   field="edgeCapacityFactors")

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
        if edge.id in factors:
            # Same rounding as the robustness variations; a road is never left
            # with no capacity at all (closing it is the way to say that).
            edge.capacity_per_tick = max(1, round(edge.capacity_per_tick * factors[edge.id]))
    unavailable = set(unavailable_shelter_ids)
    for shelter in overridden.shelters:
        if shelter.id in unavailable:
            shelter.available = False
    return overridden


CapacityFactor = Annotated[float, Field(gt=0, le=1)]


class WhatIfOverrides(CamelModel):
    """The what-if fields every run, estimate, optimization and saved plan
    accepts, so they can't drift apart."""
    closed_edge_ids: list[str] = Field(default_factory=list)
    unavailable_shelter_ids: list[str] = Field(default_factory=list)
    # Share of a road's capacity left, e.g. {"E4": 0.5} when live traffic
    # shows the road at half its free-flow speed.
    edge_capacity_factors: dict[str, CapacityFactor] = Field(default_factory=dict)

    def apply_to(self, scenario: ScenarioConfig) -> ScenarioConfig:
        return apply_overrides(scenario, self.closed_edge_ids, self.unavailable_shelter_ids, self.edge_capacity_factors)
