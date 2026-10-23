from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_check_returns_ok_and_a_version():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_cors_allows_the_nextjs_dev_origin():
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_back_to_back_runs_do_not_share_state():
    # PRD §12.2: duplicate runs must not corrupt each other. Every request
    # re-loads the scenario and copies shelters before admitting anyone.
    first = client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal"}).json()
    second = client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal"}).json()

    for key in ("evacuatedCount", "unservedCount", "completionTick", "maxCongestionRatio"):
        assert first["metrics"][key] == second["metrics"][key]
    assert first["shelters"] == second["shelters"]
    assert first["runId"] != second["runId"]
