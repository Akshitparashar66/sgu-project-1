from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _run(scenario_id: str) -> dict:
    response = client.post("/api/simulations/run", json={"scenarioId": scenario_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_scenario_a_normal_evacuates_everyone_capacity_allows():
    result = _run("scenario_a_normal")
    # 1,500 evacuees (600 + 900), 1,800 shelter places (600+700+500), all roads open.
    assert result["metrics"]["evacuatedCount"] + result["metrics"]["unservedCount"] == 1500
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
    assert s1["totalCapacity"] == 80
    assert s1["finalOccupied"] <= 80
    assert result["metrics"]["unservedCount"] > 0


def test_scenario_b_costs_time_not_people():
    normal, closed = _run("scenario_a_normal"), _run("scenario_b_bridge_closure")
    assert closed["metrics"]["unservedCount"] == 0
    assert closed["metrics"]["completionTick"] > normal["metrics"]["completionTick"]


def test_scenario_d_flood_strands_walkers_at_the_time_limit():
    result = _run("scenario_d_hindon_flood")
    assert result["metrics"]["hitTickLimit"] is True
    assert result["metrics"]["unservedCount"] > 0
    assert any("max_ticks" in w for w in result["warnings"])  # still walking, not turned away
    assert all("E7" not in a["routeEdgeIds"] for a in result["agents"])


def test_scenario_e_night_is_slower_than_normal_but_still_finishes():
    normal, night = _run("scenario_a_normal"), _run("scenario_e_night_vulnerable")
    assert night["metrics"]["unservedCount"] == 0 and night["metrics"]["hitTickLimit"] is False
    assert night["metrics"]["completionTick"] > normal["metrics"]["completionTick"]


def test_scenario_f_compound_failure_loses_people_and_time():
    normal, compound = _run("scenario_a_normal"), _run("scenario_f_compound_failure")
    assert compound["metrics"]["unservedCount"] > 0
    assert compound["metrics"]["completionTick"] > normal["metrics"]["completionTick"]


ALL_SCENARIOS = ("scenario_a_normal", "scenario_b_bridge_closure", "scenario_c_shelter_shortage",
                 "scenario_d_hindon_flood", "scenario_e_night_vulnerable", "scenario_f_compound_failure")


def test_alternative_plan_is_never_worse_and_is_honest_when_no_improvement_exists():
    for scenario_id in ALL_SCENARIOS:
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
    for scenario_id in ALL_SCENARIOS:
        result = _run(scenario_id)
        for shelter in result["shelters"]:
            assert shelter["finalOccupied"] <= shelter["totalCapacity"]
