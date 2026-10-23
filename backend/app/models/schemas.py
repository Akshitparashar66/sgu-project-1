"""Shared Pydantic contracts for AEGIS. Mirrors frontend/lib/schemas/types.ts.
Keep the two files in sync by hand — any shape change here must be reflected
there in the same commit."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for every model below. Python/JSON-in stays snake_case
    (`total_capacity`), but JSON-out is camelCase (`totalCapacity`) to
    match frontend/lib/schemas/types.ts exactly — FastAPI's response
    serialization uses aliases by default, and `populate_by_name=True`
    means incoming request bodies can use either spelling. This is why
    the TypeScript interfaces below are camelCase while the Python
    classes are snake_case: same contract, each language's convention."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class RoadStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    RESTRICTED = "restricted"


class AgentStatus(str, Enum):
    WAITING = "waiting"
    MOVING = "moving"
    DELAYED = "delayed"
    ARRIVED = "arrived"
    UNSERVED = "unserved"


class RoadNode(CamelModel):
    id: str
    lat: float
    lon: float
    label: Optional[str] = None


class RoadEdge(CamelModel):
    id: str
    source: str  # RoadNode.id
    target: str  # RoadNode.id
    length_m: float = Field(gt=0)
    capacity_per_tick: int = Field(gt=0)
    base_travel_time_s: float = Field(gt=0)
    status: RoadStatus = RoadStatus.OPEN
    hazard_risk: float = Field(default=0.0, ge=0.0, le=1.0)
    # The street path this road follows, [(lat, lon), ...] from source to
    # target. Drawing only: the simulation uses length_m and travel times.
    # None => drawn as a straight line between the two nodes.
    geometry: Optional[list[tuple[float, float]]] = Field(default=None, min_length=2)


class PopulationZone(CamelModel):
    id: str
    name: str
    connector_node: str  # RoadNode.id
    evacuee_count: int = Field(ge=0)
    # e.g. {"standard": 0.7, "reduced_mobility": 0.3} — must sum to ~1.0
    movement_profile: dict[str, float] = Field(default_factory=lambda: {"standard": 1.0})


class Shelter(CamelModel):
    id: str
    name: str
    connector_node: str
    total_capacity: int = Field(gt=0)
    occupied: int = Field(default=0, ge=0)
    available: bool = True

    @field_validator("occupied")
    @classmethod
    def occupied_within_capacity(cls, v: int, info) -> int:
        total = info.data.get("total_capacity")
        if total is not None and v > total:
            raise ValueError(
                f"occupied ({v}) cannot exceed total_capacity ({total})"
            )
        return v


class HazardZone(CamelModel):
    id: str
    polygon: list[tuple[float, float]]  # [(lat, lon), ...], closed ring
    severity: float = Field(ge=0.0, le=1.0)
    start_tick: int = 0
    end_tick: Optional[int] = None


class SimulationParams(CamelModel):
    tick_seconds: float = Field(default=30.0, gt=0)
    max_ticks: int = Field(default=240, gt=0)
    random_seed: int = 42


class ScenarioConfig(CamelModel):
    id: str
    name: str
    description: str
    synthetic: bool = True
    nodes: list[RoadNode]
    edges: list[RoadEdge]
    zones: list[PopulationZone]
    shelters: list[Shelter]
    hazards: list[HazardZone] = Field(default_factory=list)
    default_params: SimulationParams


class AgentPlan(CamelModel):
    """Output of Member 2's assignment step; input to Member 1's simulation
    loop. One instance per individual evacuee (not per zone) — a zone with
    450 evacuees becomes 450 AgentPlan rows, split across movement_profile
    keys roughly in proportion to the zone's movement_profile dict."""
    agent_id: str
    origin_zone: str  # PopulationZone.id
    assigned_shelter: Optional[str] = None  # None => no feasible shelter found
    route_edge_ids: list[str] = Field(default_factory=list)  # [] if assigned_shelter is None
    movement_profile: str = "standard"  # key into the zone's movement_profile dict
    distance_m: float = 0.0  # sum of route_edge_ids' length_m, for reference/debugging


class AgentResult(CamelModel):
    id: str
    origin_zone: str
    assigned_shelter: Optional[str] = None
    route_edge_ids: list[str] = Field(default_factory=list)
    status: AgentStatus
    arrival_tick: Optional[int] = None
    movement_profile: str = "standard"
    # Replay timing, aligned with route_edge_ids (added post-Hour-1 for the
    # P1 animated replay; defaulted, so older payloads still validate). Edge
    # i is occupied from edge_entry_ticks[i] through edge_exit_ticks[i]
    # inclusive. An entry without a matching exit = still on that edge when
    # the run hit max_ticks.
    edge_entry_ticks: list[int] = Field(default_factory=list)
    edge_exit_ticks: list[int] = Field(default_factory=list)


class EdgeCongestionResult(CamelModel):
    edge_id: str
    peak_demand_to_capacity: float
    peak_tick: int
    total_delay_s: float


class ShelterResult(CamelModel):
    shelter_id: str
    total_capacity: int
    final_occupied: int
    rejected_count: int


class RunMetrics(CamelModel):
    evacuated_count: int
    unserved_count: int
    completion_tick: Optional[int]  # None => hit max_ticks before everyone resolved
    hit_tick_limit: bool
    max_congestion_ratio: float
    runtime_ms: float


class RunResult(CamelModel):
    run_id: str
    scenario_id: str
    plan_label: str  # "baseline" | "alternative"
    random_seed: int
    metrics: RunMetrics
    agents: list[AgentResult]
    shelters: list[ShelterResult]
    congestion: list[EdgeCongestionResult]
    warnings: list[str] = Field(default_factory=list)


class MetricComparison(CamelModel):
    metric_name: str
    baseline_value: float
    alternative_value: float
    absolute_diff: float
    percent_diff: Optional[float]  # None when baseline_value == 0
    improved: Optional[bool]  # None when not meaningfully comparable


class ComparisonResult(CamelModel):
    baseline_run_id: str
    alternative_run_id: str
    metrics: list[MetricComparison]
    warnings: list[str] = Field(default_factory=list)
