from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _run(scenario_id: str) -> dict:
    response = client.post("/api/simulations/run", json={"scenarioId": scenario_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_scenario_a_normal_evacuates_everyone_capacity_allows():
    result = _run("scenario_a_normal")
    # 750 total evacuees (300 + 450), 750 total shelter capacity (250+300+200), all roads open.
    assert result["metrics"]["evacuatedCount"] + result["metrics"]["unservedCount"] == 750
    assert result["metrics"]["unservedCount"] == 0


def test_scenario_b_bridge_closure_produces_at_least_as_many_unserved_as_normal():
    normal = _run("scenario_a_normal")
    closed = _run("scenario_b_bridge_closure")
    assert closed["metrics"]["unservedCount"] >= normal["metrics"]["unservedCount"]

    s1_normal = next(s for s in normal["shelters"] if s["shelterId"] == "S1")
    s1_closed = next(s for s in closed["shelters"] if s["shelterId"] == "S1")
    assert s1_closed["finalOccupied"] <= s1_normal["finalOccupied"]


def test_scenario_c_shelter_shortage_rejects_agents_at_the_shrunk_shelter():
    result = _run("scenario_c_shelter_shortage")
    s1 = next(s for s in result["shelters"] if s["shelterId"] == "S1")
    assert s1["totalCapacity"] == 30
    assert s1["finalOccupied"] <= 30
    assert result["metrics"]["unservedCount"] > 0


def test_alternative_plan_is_never_worse_and_is_honest_when_no_improvement_exists():
    for scenario_id in ("scenario_a_normal", "scenario_b_bridge_closure", "scenario_c_shelter_shortage"):
        response = client.post("/api/optimization/plan", json={"scenarioId": scenario_id})
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body["feasible"], bool)
        if body["feasible"]:
            assert body["alternativeRun"]["metrics"]["unservedCount"] <= body["baselineRun"]["metrics"]["unservedCount"]
        else:
            assert body.get("reason")


def test_closed_road_never_appears_in_any_agents_route_in_scenario_b():
    result = _run("scenario_b_bridge_closure")
    for agent in result["agents"]:
        assert "E3" not in agent["routeEdgeIds"]


def test_shelter_occupied_never_exceeds_capacity_in_any_scenario():
    for scenario_id in ("scenario_a_normal", "scenario_b_bridge_closure", "scenario_c_shelter_shortage"):
        result = _run(scenario_id)
        for shelter in result["shelters"]:
            assert shelter["finalOccupied"] <= shelter["totalCapacity"]
