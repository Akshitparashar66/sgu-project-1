import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
PLAN = {"name": "Monsoon plan", "preparedBy": "A. Planner", "note": "draft for DDMA", "scenarioId": "scenario_d_hindon_flood"}


def test_a_saved_plan_is_versioned_approved_and_audited():
    first = client.post("/api/plans", json=PLAN).json()
    second = client.post("/api/plans", json=PLAN).json()

    assert (first["version"], second["version"]) == (1, 2)
    assert first["summary"]["optimized"]["unserved"] == 0 and first["orders"]

    approved = client.post(f"/api/plans/{first['id']}/approve", json={"approvedBy": "ADM (F/R)", "note": "ok"}).json()
    assert approved["approvals"][0]["by"] == "ADM (F/R)"
    assert approved["contentHash"] == first["contentHash"]  # approving doesn't change what was planned

    listed = {p["id"]: p for p in client.get("/api/plans").json()}
    assert listed[first["id"]]["intact"] and len(listed[first["id"]]["approvals"]) == 1
    events = [(e["event"], e["planId"]) for e in client.get("/api/plans/audit").json()]
    assert events[:3] == [("approved", first["id"]), ("saved", second["id"]), ("saved", first["id"])]


def test_a_plan_edited_after_saving_cannot_be_approved():
    plan = client.post("/api/plans", json=PLAN).json()
    path = Path(os.environ["AEGIS_PLANS_DIR"]) / f"{plan['id']}.json"
    record = json.loads(path.read_text(encoding="utf-8"))
    record["orders"][0]["people"] += 100  # someone edits the file by hand
    path.write_text(json.dumps(record), encoding="utf-8")

    assert client.get(f"/api/plans/{plan['id']}").json()["intact"] is False
    response = client.post(f"/api/plans/{plan['id']}/approve", json={"approvedBy": "ADM"})
    assert response.status_code == 409 and response.json()["errorCode"] == "PLAN_MODIFIED"


def test_unknown_plans_and_bad_ids_are_rejected():
    assert client.get("/api/plans/no-such-plan").json()["errorCode"] == "PLAN_NOT_FOUND"
    assert client.get("/api/plans/..%2Fsecrets").status_code == 404
    assert client.post("/api/plans", json={**PLAN, "name": ""}).status_code == 422


def test_a_plan_records_live_conditions_and_older_plans_stay_intact():
    from app.services.plan_store import content_hash

    plan = client.post("/api/plans", json={**PLAN, "scenarioId": "scenario_a_normal",
                                           "edgeCapacityFactors": {"E4": 0.5}, "alertIds": ["traffic:nh9"]}).json()
    assert plan["edgeCapacityFactors"] == {"E4": 0.5} and plan["alertIds"] == ["traffic:nh9"]
    assert client.get(f"/api/plans/{plan['id']}").json()["intact"]

    # A plan saved before live conditions existed has neither key; its fingerprint must not change.
    older = client.post("/api/plans", json=PLAN).json()
    assert "edgeCapacityFactors" not in older and "alertIds" not in older
    path = Path(os.environ["AEGIS_PLANS_DIR"]) / f"{older['id']}.json"
    assert content_hash(json.loads(path.read_text(encoding="utf-8"))) == older["contentHash"]
