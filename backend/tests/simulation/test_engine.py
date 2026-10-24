from app.models.schemas import (
    AgentPlan, AgentStatus, RoadEdge, RoadNode, RoadStatus, ScenarioConfig,
    Shelter, SimulationParams,
)
from app.simulation.engine import simulate
from app.simulation.protocols import CongestionModelProtocol


class FakeCongestionModel(CongestionModelProtocol):
    """Unlimited road capacity, base travel times: isolates the engine's
    movement and shelter rules from congestion."""

    def __init__(self, edges_by_id: dict[str, RoadEdge]):
        self._edges = edges_by_id
        self.registered: list[tuple[str, int, int]] = []

    def entry_capacity(self, edge_id):
        return 10**9

    def travel_time_s(self, edge_id):
        return self._edges[edge_id].base_travel_time_s

    def register_tick(self, edge_id, tick, demand):
        self.registered.append((edge_id, tick, demand))

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


def _two_edge_scenario() -> ScenarioConfig:
    scenario = _tiny_scenario()
    scenario.nodes.append(RoadNode(id="N3", lat=0, lon=0))
    scenario.edges.append(RoadEdge(id="E2", source="N2", target="N3", length_m=100,
                                   capacity_per_tick=10, base_travel_time_s=60))
    scenario.shelters[0].connector_node = "N3"
    return scenario


def test_agents_record_when_they_entered_and_left_each_edge():
    # Replay contract: edge i is occupied from edge_entry_ticks[i] through
    # edge_exit_ticks[i] inclusive; the next edge is entered on the tick after.
    scenario = _two_edge_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter="S1",
                        route_edge_ids=["E1", "E2"], movement_profile="standard", distance_m=200)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=20, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    agent = result.agents[0]
    # E1: 90s = 3 ticks (0,1,2). E2: 60s = 2 ticks (3,4). Arrives at tick 4.
    assert agent.edge_entry_ticks == [0, 3]
    assert agent.edge_exit_ticks == [2, 4]
    assert agent.arrival_tick == 4


def test_agent_cut_off_by_tick_limit_has_an_entry_without_an_exit():
    scenario = _two_edge_scenario()
    plans = [AgentPlan(agent_id="A1", origin_zone="Z1", assigned_shelter="S1",
                        route_edge_ids=["E1", "E2"], movement_profile="standard", distance_m=200)]
    congestion = FakeCongestionModel({e.id: e for e in scenario.edges})
    params = SimulationParams(tick_seconds=30, max_ticks=4, random_seed=42)

    result = simulate(scenario, plans, params, congestion, plan_label="baseline")

    agent = result.agents[0]
    assert agent.edge_entry_ticks == [0, 3]
    assert agent.edge_exit_ticks == [2]  # still on E2 when the clock stopped
    assert agent.status == AgentStatus.UNSERVED


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
    # Still walking at the limit is not the same as being turned away at the door.
    assert result.shelters[0].rejected_count == 0


def _crowd(n: int, route=("E1",)) -> list[AgentPlan]:
    return [AgentPlan(agent_id=f"A{i}", origin_zone="Z1", assigned_shelter="S1", route_edge_ids=list(route),
                      movement_profile="standard", distance_m=100) for i in range(n)]


def test_a_road_lets_in_at_most_its_capacity_per_tick_and_the_rest_wait_in_line():
    from app.routing.congestion import CongestionModel

    scenario = _tiny_scenario()  # E1: capacity 10 per tick, 90 s = 3 ticks
    scenario.shelters[0].total_capacity = 100
    params = SimulationParams(tick_seconds=30, max_ticks=20, random_seed=42)

    result = simulate(scenario, _crowd(25), params, CongestionModel(scenario, params), plan_label="baseline")

    entries = sorted(a.edge_entry_ticks[0] for a in result.agents)
    assert entries == [0] * 10 + [1] * 10 + [2] * 5
    # Once on the road everyone walks at normal speed: 3 ticks.
    assert all(a.arrival_tick == a.edge_entry_ticks[0] + 2 for a in result.agents)
    edge = result.congestion[0]
    assert (edge.peak_demand_to_capacity, edge.peak_tick) == (2.5, 0)
    # 15 waited one tick, 5 waited a second: 20 ticks x 30 s.
    assert edge.total_delay_s == 600.0


def test_people_already_in_line_go_before_newcomers():
    from app.routing.congestion import CongestionModel

    # 15 people leave at once for E1 (capacity 10); 10 more arrive at tick 1.
    scenario = _tiny_scenario()
    scenario.shelters[0].total_capacity = 100
    params = SimulationParams(tick_seconds=30, max_ticks=20, random_seed=42)
    late = [p.model_copy(update={"agent_id": f"L{i}", "departure_tick": 1}) for i, p in enumerate(_crowd(10))]

    result = simulate(scenario, _crowd(15) + late, params, CongestionModel(scenario, params), plan_label="baseline")

    entry = {a.id: a.edge_entry_ticks[0] for a in result.agents}
    assert sorted(entry[f"A{i}"] for i in range(15)) == [0] * 10 + [1] * 5
    assert sorted(entry[f"L{i}"] for i in range(10)) == [1] * 5 + [2] * 5
