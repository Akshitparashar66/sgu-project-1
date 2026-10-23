from app.models.schemas import (
    AgentPlan, AgentStatus, RoadEdge, RoadNode, RoadStatus, ScenarioConfig,
    Shelter, SimulationParams,
)
from app.simulation.engine import simulate
from app.simulation.protocols import CongestionModelProtocol


class FakeCongestionModel(CongestionModelProtocol):
    """No congestion at all — effective time == base time. Stands in for
    Member 2's real CongestionModel until it exists."""

    def __init__(self, edges_by_id: dict[str, RoadEdge]):
        self._edges = edges_by_id
        self.registered: list[tuple[str, int, int]] = []

    def effective_travel_time_s(self, edge_id, tick, agents_entering):
        return self._edges[edge_id].base_travel_time_s

    def register_tick(self, edge_id, tick, agents_entering):
        self.registered.append((edge_id, tick, agents_entering))

    def peak_congestion(self):
        return {}


def _tiny_scenario() -> ScenarioConfig:
    return ScenarioConfig(
        id="test_scenario", name="Test", description="", synthetic=True,
        nodes=[RoadNode(id="N1", lat=0, lon=0), RoadNode(id="N2", lat=0, lon=0)],
        edges=[
            RoadEdge(
                id="E1", source="N1", target="N2", length_m=100,
                capacity_per_tick=10, base_travel_time_s=90, status=RoadStatus.OPEN,
            ),
        ],
        zones=[],
        shelters=[Shelter(id="S1", name="Shelter 1", connector_node="N2", total_capacity=1, occupied=0)],
        hazards=[],
        default_params=SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42),
    )


def test_single_agent_arrives_after_expected_ticks():
    scenario = _tiny_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter="S1",
                        route_edge_ids=["E1"], movement_profile="standard", distance_m=100)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.metrics.evacuated_count == 1
    assert result.metrics.unserved_count == 0
    assert result.metrics.hit_tick_limit is False
    # 90s travel / 30s per tick = 3 ticks -> zero-indexed arrival tick 2
    assert result.agents[0].arrival_tick == 2
    assert result.agents[0].status == AgentStatus.ARRIVED
    assert result.shelters[0].final_occupied == 1


def test_agent_with_no_route_is_unserved_immediately():
    scenario = _tiny_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter=None,
                        route_edge_ids=[], movement_profile="standard", distance_m=0)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.metrics.unserved_count == 1
    assert result.agents[0].status == AgentStatus.UNSERVED
    assert result.agents[0].arrival_tick is None


def test_unassigned_agents_get_a_traceable_warning_per_origin_zone():
    # "Agents never disappear": an agent the planner could not place must
    # still have a reason on record — it is not a shelter rejection, so
    # rejected_count can't carry it; the warnings list must.
    scenario = _tiny_scenario()
    plans = [
        AgentPlan(agent_id=f"A{i}", origin_zone="Z1", assigned_shelter=None,
                  route_edge_ids=[], movement_profile="standard", distance_m=0)
        for i in range(3)
    ]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.shelters[0].rejected_count == 0
    assert len(result.warnings) == 1
    assert "3 agents from zone Z1" in result.warnings[0]


def test_shelter_capacity_is_never_exceeded():
    scenario = _tiny_scenario()  # S1 total_capacity=1
    plans = [
        AgentPlan(agent_id=f"A{i}", origin_zone="Z1", assigned_shelter="S1",
                  route_edge_ids=["E1"], movement_profile="standard", distance_m=100)
        for i in range(3)
    ]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=10, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.shelters[0].final_occupied == 1
    assert result.metrics.evacuated_count == 1
    assert result.metrics.unserved_count == 2
    assert result.shelters[0].rejected_count == 2


def test_max_ticks_limit_marks_remaining_agents_unserved_with_warning():
    scenario = _tiny_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter="S1",
                        route_edge_ids=["E1"], movement_profile="standard", distance_m=100)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    # 1 tick is not enough to cross a 90s / 30s-per-tick = 3-tick edge.
    params = SimulationParams(tick_seconds=30, max_ticks=1, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    assert result.metrics.hit_tick_limit is True
    assert result.metrics.unserved_count == 1
    assert result.metrics.completion_tick is None
    assert len(result.warnings) == 1
