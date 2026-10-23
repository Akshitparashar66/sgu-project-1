from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_unknown_scenario_returns_a_structured_404_error():
    response = client.get("/api/scenarios/does-not-exist")
    assert response.status_code == 404
    body = response.json()
    assert body["errorCode"] == "SCENARIO_NOT_FOUND"
    assert "does-not-exist" in body["message"]


def test_run_simulation_with_unknown_scenario_returns_a_structured_error():
    response = client.post("/api/simulations/run", json={"scenarioId": "does-not-exist"})
    assert response.status_code == 404
    body = response.json()
    assert body["errorCode"] == "SCENARIO_NOT_FOUND"


def test_optimization_with_unknown_scenario_returns_a_structured_404():
    response = client.post("/api/optimization/plan", json={"scenarioId": "does-not-exist"})
    assert response.status_code == 404
    assert response.json()["errorCode"] == "SCENARIO_NOT_FOUND"


def test_malformed_request_body_returns_a_structured_validation_error():
    response = client.post("/api/simulations/run", json={"planLabel": "baseline"})  # no scenarioId
    assert response.status_code == 422
    body = response.json()
    assert body["errorCode"] == "VALIDATION_ERROR"
    assert body["field"] == "scenarioId"
    assert body["errors"][0]["field"] == "scenarioId"


def test_unexpected_failure_returns_a_structured_500_without_a_stack_trace(monkeypatch):
    import app.api.routes as routes

    def boom(request):
        raise RuntimeError("internal detail that must not leak")

    monkeypatch.setattr(routes, "run_simulation", boom)
    unsafe_client = TestClient(app, raise_server_exceptions=False)

    response = unsafe_client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal"})

    assert response.status_code == 500
    body = response.json()
    assert body["errorCode"] == "INTERNAL_ERROR"
    assert "internal detail" not in response.text
    assert "Traceback" not in response.text


def test_unknown_override_id_returns_a_structured_400():
    response = client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal", "closedEdgeIds": ["E99"]})
    assert response.status_code == 400
    body = response.json()
    assert body["errorCode"] == "INVALID_OVERRIDE"
    assert body["field"] == "closedEdgeIds"
    assert "E99" in body["message"]

    response = client.post("/api/optimization/plan", json={"scenarioId": "scenario_a_normal", "unavailableShelterIds": ["S9"]})
    assert response.status_code == 400
    assert response.json()["errorCode"] == "INVALID_OVERRIDE"
