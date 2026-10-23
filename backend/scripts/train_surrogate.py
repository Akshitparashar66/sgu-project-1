"""Train the instant-estimate model (the surrogate) behind POST /api/predict.

    cd backend
    pip install -r requirements-ml.txt
    python scripts/train_surrogate.py

1. Generates scenarios: Scenario Lab cases (each shipped scenario with
   random road closures and offline shelters) and perturbed variants (the
   same plus scaled populations, shelter capacities, road capacities,
   walking speed and mobility mix).
2. Labels each one by simulating its baseline plan with the cohort
   simulation, which returns exactly the engine's metrics.
3. Fits one gradient-boosted tree model per target, measures it on a
   held-out 20%, and writes the trees and the test results to
   app/ml/surrogate_model.json.

The model learns this simulator, not real evacuations: its error is
measured against the simulation and says nothing about real-world accuracy.
"""
from __future__ import annotations

import json
import random
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
import sklearn  # noqa: E402
from sklearn.ensemble import GradientBoostingRegressor  # noqa: E402

from app.ml.features import FEATURE_NAMES, scenario_features  # noqa: E402
from app.ml.surrogate import MODEL_PATH, predict_target  # noqa: E402
from app.models.schemas import RoadStatus, ScenarioConfig  # noqa: E402
from app.routing.assignment import assign_shelters_and_routes  # noqa: E402
from app.routing.graph import build_graph  # noqa: E402
from app.services.scenario_store import list_scenarios  # noqa: E402
from app.simulation.cohort import simulate_plans_fast  # noqa: E402

SAMPLES = 8000
LAB_SHARE = 0.5  # half the data looks exactly like Scenario Lab what-ifs
TEST_SHARE = 0.2
SEED = 2026
TREE_PARAMS = dict(n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.8, min_samples_leaf=5)


def lab_variant(base: ScenarioConfig, rng: random.Random) -> ScenarioConfig:
    s = base.model_copy(deep=True)
    for e in s.edges:
        if rng.random() < 0.15:
            e.status = RoadStatus.CLOSED
    for sh in s.shelters:
        if rng.random() < 0.12:
            sh.available = False
    s.default_params.random_seed = rng.randrange(10_000)
    return s


def perturbed_variant(base: ScenarioConfig, rng: random.Random) -> ScenarioConfig:
    s = lab_variant(base, rng)
    speed = rng.uniform(0.8, 1.2)
    for e in s.edges:
        e.base_travel_time_s /= speed
        e.capacity_per_tick = max(1, round(e.capacity_per_tick * rng.uniform(0.7, 1.3)))
    for z in s.zones:
        z.evacuee_count = round(z.evacuee_count * rng.uniform(0.6, 1.5))
        slow = rng.uniform(0.0, 0.5)
        z.movement_profile = {"standard": 1 - slow, "reduced_mobility": slow}
    for sh in s.shelters:
        sh.total_capacity = max(1, round(sh.total_capacity * rng.uniform(0.5, 1.3)))
    return s


def label(s: ScenarioConfig) -> list[float]:
    params = s.default_params
    m = simulate_plans_fast(s, assign_shelters_and_routes(s, build_graph(s), params.random_seed), params)
    ticks = params.max_ticks if m.completion_tick is None else m.completion_tick
    evacuees = sum(z.evacuee_count for z in s.zones)
    return [ticks * params.tick_seconds / 60, m.unserved / evacuees if evacuees else 0.0, m.max_congestion_ratio]


TARGETS = ["clearanceMinutes", "unservedShare", "peakCongestion"]


def export_tree(estimator) -> dict:
    t = estimator.tree_
    return {
        "left": t.children_left.tolist(), "right": t.children_right.tolist(),
        "feature": t.feature.tolist(), "threshold": [round(v, 6) for v in t.threshold.tolist()],
        "value": [round(v, 8) for v in t.value[:, 0, 0].tolist()],
    }


def main() -> None:
    rng = random.Random(SEED)
    bases = list_scenarios()
    started = time.perf_counter()
    rows, labels, kinds = [], [], []
    for i in range(SAMPLES):
        base = rng.choice(bases)
        lab = rng.random() < LAB_SHARE
        s = lab_variant(base, rng) if lab else perturbed_variant(base, rng)
        rows.append(scenario_features(s))
        labels.append(label(s))
        kinds.append("lab" if lab else "perturbed")
        if (i + 1) % 1000 == 0:
            print(f"  {i + 1}/{SAMPLES} scenarios simulated ({time.perf_counter() - started:.0f}s)")

    X, Y = np.array(rows), np.array(labels)
    order = np.random.default_rng(SEED).permutation(len(X))
    n_test = int(len(X) * TEST_SHARE)
    test, train = order[:n_test], order[n_test:]
    lab_test = np.array([i for i in test if kinds[i] == "lab"])

    targets, metrics = {}, {}
    for j, name in enumerate(TARGETS):
        model = GradientBoostingRegressor(random_state=SEED, **TREE_PARAMS).fit(X[train], Y[train, j])
        exported = {
            "init": float(model.init_.constant_[0][0]),
            "learningRate": TREE_PARAMS["learning_rate"],
            "trees": [export_tree(est[0]) for est in model.estimators_],
        }
        # The exported trees must reproduce scikit-learn's predictions exactly.
        sample = X[test[:50]]
        assert np.allclose([predict_target(exported, list(x)) for x in sample], model.predict(sample), atol=1e-4)
        targets[name] = exported

        def errors(idx):
            err = np.abs(model.predict(X[idx]) - Y[idx, j])
            scale = 1.0
            if name == "unservedShare":  # report in people, not shares
                scale = X[idx, FEATURE_NAMES.index("evacuees")]
                err = err * scale
            return err

        all_err, lab_err = errors(test), errors(lab_test)
        ss_res = float(np.sum((model.predict(X[test]) - Y[test, j]) ** 2))
        ss_tot = float(np.sum((Y[test, j] - Y[test, j].mean()) ** 2))
        metrics[name] = {
            "mae": round(float(all_err.mean()), 2),
            "p90AbsError": round(float(np.percentile(all_err, 90)), 2),
            "labMae": round(float(lab_err.mean()), 2),
            "labP90AbsError": round(float(np.percentile(lab_err, 90)), 2),
            "r2": round(1 - ss_res / ss_tot, 3) if ss_tot else None,
        }
        print(f"{name}: {metrics[name]}")

    card = {
        "method": "gradient-boosted decision trees",
        "trainedOn": "AEGIS simulation runs (synthetic scenarios), not real evacuations",
        "samples": len(train),
        "testSamples": len(test),
        "labTestSamples": len(lab_test),
        "trees": TREE_PARAMS["n_estimators"],
        "maxDepth": TREE_PARAMS["max_depth"],
        "trainedDate": date.today().isoformat(),
        "sklearnVersion": sklearn.__version__,
        "units": {"clearanceMinutes": "minutes", "unservedShare": "people", "peakCongestion": "ratio"},
        "testMetrics": metrics,
    }
    MODEL_PATH.write_text(json.dumps({"featureNames": FEATURE_NAMES, "targets": targets, "card": card},
                                     separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {MODEL_PATH} ({MODEL_PATH.stat().st_size / 1e6:.1f} MB) in {time.perf_counter() - started:.0f}s")


if __name__ == "__main__":
    main()
