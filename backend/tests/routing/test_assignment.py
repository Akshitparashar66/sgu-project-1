from app.models.schemas import PopulationZone, RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.routing.assignment import assign_shelters_and_routes, split_zone_population
from app.routing.graph import build_graph


def _scenario_two_shelters_one_full() -> ScenarioConfig:
    # One zone of 5 evacuees. Nearest shelter S1 only has room for 2;
    # the rest must spill over to the farther shelter S2 — never exceed
    # S1's capacity, never silently drop anyone.
    return ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id=n, lat=0, lon=0) for n in ("N1", "N2", "N3")],
        edges=[
            RoadEdge(id="E1", source="N1", target="N2", length_m=50, capacity_per_tick=10,
                      base_travel_time_s=10, status=RoadStatus.OPEN),
            RoadEdge(id="E2", source="N1", target="N3", length_m=500, capacity_per_tick=10,
                      base_travel_time_s=100, status=RoadStatus.OPEN),
        ],
        zones=[PopulationZone(id="Z1", name="Z1", connector_node="N1", evacuee_count=5,
                                movement_profile={"standard": 1.0})],
        shelters=[
            Shelter(id="S1", name="Near", connector_node="N2", total_capacity=2, occupied=0),
            Shelter(id="S2", name="Far", connector_node="N3", total_capacity=10, occupied=0),
        ],
        hazards=[], default_params=SimulationParams(),
    )


def test_assignment_never_exceeds_shelter_capacity_and_serves_everyone_reachable():
    scenario = _scenario_two_shelters_one_full()
    graph = build_graph(scenario)

    plans = assign_shelters_and_routes(scenario, graph, random_seed=42)

    assert len(plans) == 5
    assigned_to_s1 = [p for p in plans if p.assigned_shelter == "S1"]
    assigned_to_s2 = [p for p in plans if p.assigned_shelter == "S2"]
    assert len(assigned_to_s1) == 2  # never exceeds S1's total_capacity
    assert len(assigned_to_s2) == 3  # the overflow spills to S2
    assert all(p.assigned_shelter is not None for p in plans)  # both shelters reachable
    assert all(p.route_edge_ids for p in plans)


def test_unreachable_demand_is_planned_as_unassigned_not_dropped():
    scenario = _scenario_two_shelters_one_full()
    for edge in scenario.edges:
        edge.status = RoadStatus.CLOSED
    graph = build_graph(scenario)

    plans = assign_shelters_and_routes(scenario, graph, random_seed=42)

    assert len(plans) == 5
    assert all(p.assigned_shelter is None and p.route_edge_ids == [] for p in plans)


def test_split_zone_population_never_loses_or_invents_agents():
    # round() on each fraction independently would give 3 x round(3.33) = 9.
    zone = PopulationZone(id="Z", name="Z", connector_node="N1", evacuee_count=10,
                           movement_profile={"a": 1 / 3, "b": 1 / 3, "c": 1 / 3})

    split = split_zone_population(zone)

    assert sum(count for _, count in split) == 10
    assert sorted(count for _, count in split) == [3, 3, 4]
