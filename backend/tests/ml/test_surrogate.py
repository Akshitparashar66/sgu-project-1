import pytest
from fastapi.testclient import TestClient

import app.ml.surrogate as surrogate
from app.main import app
from app.ml.features import scenario_features
from app.ml.surrogate import predict_target
from app.services.scenario_store import get_scenario, list_scenarios
from app.simulation.engine import RunRequest, run_simulation

client = TestClient(app)


def predict(scenario_id: str, **overrides) -> dict:
    return client.post("/api/predict", json={"scenarioId": scenario_id, **overrides}).json()


@pytest.mark.parametrize("scenario", list_scenarios(), ids=lambda s: s.id)
def test_estimate_lands_within_its_stated_error_of_the_real_run(scenario):
    estimate = predict(scenario.id)
    run = run_simulation(RunRequest(scenario_id=scenario.id)).metrics
    errors = estimate["model"]["testMetrics"]
    params = scenario.default_params
    clearance = (params.max_ticks if run.completion_tick is None else run.completion_tick) * params.tick_seconds / 60

    # The stated range covers 90% of test cases; allow twice that so one
    # unlucky scenario doesn't make the suite flaky, which still catches a
    # broken model or a feature/model mismatch.
    assert abs(estimate["clearanceMinutes"] - clearance) <= 2 * errors["clearanceMinutes"]["labP90AbsError"]
    assert abs(estimate["unservedCount"] - run.unserved_count) <= 2 * errors["unservedShare"]["labP90AbsError"]
    assert abs(estimate["peakCongestion"] - run.max_congestion_ratio) <= 2 * errors["peakCongestion"]["labP90AbsError"]


def test_estimate_follows_what_if_changes():
    open_roads = predict("scenario_a_normal")
    # Losing the school camp leaves 1,200 places for 1,500 people: the
    # simulation turns 300 away (and the rest clear sooner, at 83 min).
    lost_camp = predict("scenario_a_normal", closedEdgeIds=["E3"], unavailableShelterIds=["S1"])
    assert open_roads["unservedCount"] < 20
    assert abs(lost_camp["unservedCount"] - 300) <= 2 * lost_camp["model"]["testMetrics"]["unservedShare"]["labP90AbsError"]
    assert lost_camp["clearanceMinutes"] < open_roads["clearanceMinutes"]


def test_features_do_not_depend_on_road_or_shelter_ids():
    scenario = get_scenario("scenario_b_bridge_closure")
    renamed = scenario.model_copy(deep=True)
    for e in renamed.edges:
        e.id = f"road-{e.id}"
    for s in renamed.shelters:
        s.id = f"shelter-{s.id}"
    assert scenario_features(renamed) == scenario_features(scenario)


def test_tree_evaluation_matches_gradient_boosting():
    stump = {"left": [1, -1, -1], "right": [2, -1, -1], "feature": [0, -2, -2],
             "threshold": [5.0, -2.0, -2.0], "value": [0.0, -1.0, 3.0]}
    target = {"init": 10.0, "learningRate": 0.5, "trees": [stump, stump]}
    assert predict_target(target, [4.0]) == 10.0 + 0.5 * (-1.0 - 1.0)
    assert predict_target(target, [6.0]) == 10.0 + 0.5 * (3.0 + 3.0)


def test_missing_model_is_reported_not_guessed(monkeypatch, tmp_path):
    monkeypatch.setattr(surrogate, "MODEL_PATH", tmp_path / "absent.json")
    surrogate.load_model.cache_clear()
    try:
        body = predict("scenario_a_normal")
    finally:
        surrogate.load_model.cache_clear()
    assert body["available"] is False and "train_surrogate" in body["reason"]


def test_bad_requests_are_rejected():
    assert client.post("/api/predict", json={"scenarioId": "nope"}).json()["errorCode"] == "SCENARIO_NOT_FOUND"
    response = client.post("/api/predict", json={"scenarioId": "scenario_a_normal", "closedEdgeIds": ["E99"]})
    assert response.status_code == 400 and response.json()["errorCode"] == "INVALID_OVERRIDE"
