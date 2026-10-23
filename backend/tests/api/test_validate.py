import copy
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

SCENARIO_A = json.loads(
    (Path(__file__).resolve().parents[3] / "data" / "scenarios" / "scenario_a_normal.json").read_text(encoding="utf-8")
)


def _scenario(**changes) -> dict:
    body = copy.deepcopy(SCENARIO_A)
    body.update(changes)
    return body


def test_valid_scenario_is_accepted_with_a_summary():
    response = client.post("/api/scenarios/validate", json=SCENARIO_A)

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["scenarioId"] == "scenario_a_normal"
    assert body["summary"] == {"nodes": 6, "edges": 7, "zones": 2, "shelters": 3, "evacuees": 1500, "shelterCapacity": 1800}


def test_shape_errors_come_back_as_actionable_field_messages():
    body = copy.deepcopy(SCENARIO_A)
    body["shelters"][0]["occupied"] = 999  # exceeds total_capacity 250

    response = client.post("/api/scenarios/validate", json=body)

    assert response.status_code == 422
    error = response.json()
    assert error["errorCode"] == "VALIDATION_ERROR"
    assert any(e["field"] == "shelters.0.occupied" and "cannot exceed" in e["message"] for e in error["errors"])


def test_dangling_references_are_reported_per_field():
    body = copy.deepcopy(SCENARIO_A)
    body["edges"][0]["target"] = "N99"
    body["shelters"][1]["connector_node"] = "N42"

    response = client.post("/api/scenarios/validate", json=body)

    assert response.status_code == 422
    fields = {e["field"]: e["message"] for e in response.json()["errors"]}
    assert "N99" in fields["edges.0.target"]
    assert "N42" in fields["shelters.1.connectorNode"]


def test_duplicate_ids_are_reported():
    body = copy.deepcopy(SCENARIO_A)
    body["edges"][1]["id"] = "E1"

    response = client.post("/api/scenarios/validate", json=body)

    assert response.status_code == 422
    assert any(e["field"] == "edges.1.id" and "Duplicate" in e["message"] for e in response.json()["errors"])


def test_road_geometry_must_run_between_its_two_nodes():
    scenario = _scenario()
    edge = scenario["edges"][0]
    nodes = {n["id"]: n for n in scenario["nodes"]}
    start, end = nodes[edge["source"]], nodes[edge["target"]]
    edge["geometry"] = [[start["lat"], start["lon"]], [end["lat"], end["lon"]]]
    assert client.post("/api/scenarios/validate", json=scenario).status_code == 200

    edge["geometry"] = [[start["lat"], start["lon"]], [end["lat"] + 0.01, end["lon"]]]  # ~1.1 km off
    response = client.post("/api/scenarios/validate", json=scenario)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "edges.0.geometry"
