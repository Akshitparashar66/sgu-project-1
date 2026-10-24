from app.models.schemas import RoadEdge, RoadNode, RoadStatus, ScenarioConfig, Shelter, SimulationParams
from app.routing.congestion import CongestionModel


def _scenario() -> ScenarioConfig:
    return ScenarioConfig(
        id="t", name="t", description="", synthetic=True,
        nodes=[RoadNode(id="N1", lat=0, lon=0), RoadNode(id="N2", lat=0, lon=0)],
        edges=[RoadEdge(id="E1", source="N1", target="N2", length_m=100, capacity_per_tick=10,
                          base_travel_time_s=100, status=RoadStatus.OPEN)],
        zones=[], shelters=[Shelter(id="S1", name="S1", connector_node="N2", total_capacity=10)],
        hazards=[], default_params=SimulationParams(),
    )


def test_a_road_admits_its_capacity_per_tick_at_normal_walking_time():
    model = CongestionModel(_scenario(), SimulationParams())
    assert model.entry_capacity("E1") == 10
    assert model.travel_time_s("E1") == 100.0


def test_peak_congestion_is_demand_over_capacity_at_its_worst_tick():
    model = CongestionModel(_scenario(), SimulationParams())
    model.register_tick("E1", tick=0, demand=5)   # ratio 0.5
    model.register_tick("E1", tick=1, demand=25)  # ratio 2.5 <- peak
    model.register_tick("E1", tick=2, demand=10)  # ratio 1.0

    assert model.peak_congestion()["E1"] == (2.5, 1)
