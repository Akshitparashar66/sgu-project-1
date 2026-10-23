from app.models.schemas import RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.routing.graph import build_graph, compute_shortest_route


def _scenario_with_closed_shortcut() -> ScenarioConfig:
    # N1--E1(closed, 1 hop)-->N2
    # N1--E2-->N3--E3-->N2  (open, 2 hops, the only usable path)
    return ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=30, status=RoadStatus.CLOSED),
            RoadEdge(id="E2", source="N1", target="N3", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=30, status=RoadStatus.OPEN),
            RoadEdge(id="E3", source="N3", target="N2", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=30, status=RoadStatus.OPEN),
        ],
        zones=[], shelters=[Shelter(id="S1", name="S1", connector_node="N2", total_capacity=10)],
        hazards=[], default_params=SimulationParams(),
    )


def test_closed_edge_is_excluded_from_route():
    scenario = _scenario_with_closed_shortcut()
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    route = compute_shortest_route(graph, edges_by_id, "N1", "N2")

    assert route == ["E2", "E3"]  # NOT ["E1"] — that edge is closed


def test_unreachable_target_returns_none():
    scenario = _scenario_with_closed_shortcut()
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    # Close every path by also closing E2.
    scenario.edges[1].status = RoadStatus.CLOSED
    graph = build_graph(scenario)

    route = compute_shortest_route(graph, edges_by_id, "N1", "N2")

    assert route is None


def test_dijkstra_picks_the_cheapest_route_not_the_fewest_hops():
    # PRD §13.1: route cost is calculated correctly for a known small graph.
    # Three parallel ways from N1 to N2:
    #   E1 direct          — 1 hop,  300s
    #   E2 + E3 via N3     — 2 hops, 100s + 100s = 200s
    #   E4 + E5 + E6 via N4, N5 — 3 hops, 50s x 3 = 150s  <- cheapest
    scenario = ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3", "N4", "N5")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=100, capacity_per_tick=10, base_travel_time_s=300),
            RoadEdge(id="E2", source="N1", target="N3", length_m=100, capacity_per_tick=10, base_travel_time_s=100),
            RoadEdge(id="E3", source="N3", target="N2", length_m=100, capacity_per_tick=10, base_travel_time_s=100),
            RoadEdge(id="E4", source="N1", target="N4", length_m=100, capacity_per_tick=10, base_travel_time_s=50),
            RoadEdge(id="E5", source="N4", target="N5", length_m=100, capacity_per_tick=10, base_travel_time_s=50),
            RoadEdge(id="E6", source="N5", target="N2", length_m=100, capacity_per_tick=10, base_travel_time_s=50),
        ],
        zones=[], shelters=[], hazards=[], default_params=SimulationParams(),
    )
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    assert compute_shortest_route(graph, edges_by_id, "N1", "N2") == ["E4", "E5", "E6"]


def test_restricted_edge_is_also_excluded():
    scenario = _scenario_with_closed_shortcut()
    scenario.edges[0].status = RoadStatus.RESTRICTED
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    assert compute_shortest_route(graph, edges_by_id, "N1", "N2") == ["E2", "E3"]


def test_hazard_risk_steers_routes_away_from_unsafe_edges_when_times_are_close():
    # PRD §7.2 objective #1 (avoid unsafe routes): two 2-hop routes N1->N2
    # with identical travel time; the one through hazardous E1 loses.
    scenario = ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3", "N4")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N3", length_m=100, capacity_per_tick=10,
                      base_travel_time_s=60, hazard_risk=0.8),
            RoadEdge(id="E2", source="N3", target="N2", length_m=100, capacity_per_tick=10, base_travel_time_s=60),
            RoadEdge(id="E3", source="N1", target="N4", length_m=100, capacity_per_tick=10, base_travel_time_s=60),
            RoadEdge(id="E4", source="N4", target="N2", length_m=100, capacity_per_tick=10, base_travel_time_s=61),
        ],
        zones=[], shelters=[], hazards=[], default_params=SimulationParams(),
    )
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    assert compute_shortest_route(graph, edges_by_id, "N1", "N2") == ["E3", "E4"]


def test_hazard_penalty_does_not_override_a_much_faster_route():
    # A hazardous edge that saves far more time than its penalty still wins:
    # the penalty is a tie-breaker, not a closure.
    from app.routing.graph import HAZARD_PENALTY_SECONDS

    scenario = ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=100, capacity_per_tick=10,
                      base_travel_time_s=60, hazard_risk=1.0),
            RoadEdge(id="E2", source="N1", target="N3", length_m=100, capacity_per_tick=10,
                      base_travel_time_s=60 + HAZARD_PENALTY_SECONDS),
            RoadEdge(id="E3", source="N3", target="N2", length_m=100, capacity_per_tick=10, base_travel_time_s=60),
        ],
        zones=[], shelters=[], hazards=[], default_params=SimulationParams(),
    )
    graph = build_graph(scenario)
    edges_by_id = {e.id: e for e in scenario.edges}

    assert compute_shortest_route(graph, edges_by_id, "N1", "N2") == ["E1"]
