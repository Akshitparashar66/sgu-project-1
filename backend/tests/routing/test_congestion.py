from app.models.schemas import RoadEdge, RoadStatus, ScenarioConfig, RoadNode, Shelter, SimulationParams
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


def test_at_or_under_capacity_has_no_penalty():
    model = CongestionModel(_scenario(), SimulationParams())
    assert model.effective_travel_time_s("E1", tick=0, agents_entering=10) == 100.0


def test_over_capacity_increases_travel_time():
    model = CongestionModel(_scenario(), SimulationParams())
    effective = model.effective_travel_time_s("E1", tick=0, agents_entering=20)  # ratio = 2.0
    assert effective > 100.0


def test_over_capacity_penalty_follows_the_documented_formula():
    # ratio 2.0 -> factor 1 + (2.0 - 1.0) * 1.5 = 2.5 -> 250s
    model = CongestionModel(_scenario(), SimulationParams())
    assert model.effective_travel_time_s("E1", tick=0, agents_entering=20) == 250.0


def test_peak_congestion_tracks_highest_ratio_and_its_tick():
    model = CongestionModel(_scenario(), SimulationParams())
    model.register_tick("E1", tick=0, agents_entering=5)   # ratio 0.5
    model.register_tick("E1", tick=1, agents_entering=25)  # ratio 2.5 <- peak
    model.register_tick("E1", tick=2, agents_entering=10)  # ratio 1.0

    peak = model.peak_congestion()

    assert peak["E1"] == (2.5, 1)
