from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_every_open_road_and_available_shelter_is_ranked_worst_first():
    body = client.post("/api/analysis/weak-points", json={"scenarioId": "scenario_a_normal"}).json()

    assert body["baseline"]["unserved"] == 0
    ids = {(i["kind"], i["id"]) for i in body["items"]}
    # Every road someone walks on (nobody uses E6 or the long E7 detour) and every open shelter.
    assert ids == {("road", f"E{n}") for n in range(1, 6)} | {("shelter", s) for s in ("S1", "S2", "S3")}
    keys = [(-i["unservedChange"], -i["clearanceChangeMinutes"]) for i in body["items"]]
    assert keys == sorted(keys)
    # Losing the 600-place school camp leaves 1,200 places for 1,500 people.
    camp = next(i for i in body["items"] if i["id"] == "S1")
    assert camp["unservedChange"] == 300


def test_items_already_lost_are_not_tested_again():
    body = client.post("/api/analysis/weak-points",
                       json={"scenarioId": "scenario_a_normal", "closedEdgeIds": ["E3"]}).json()
    assert "E3" not in {i["id"] for i in body["items"]}
