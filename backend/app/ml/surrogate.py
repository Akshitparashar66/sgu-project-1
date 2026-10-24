from __future__ import annotations

import hashlib
import json
import time
from functools import lru_cache
from pathlib import Path

from app.ml.features import FEATURE_NAMES, scenario_features
from app.models.schemas import ScenarioConfig

# Written by scripts/train_surrogate.py. Plain JSON trees, not a pickle: no
# scikit-learn needed at runtime and nothing executable is loaded.
MODEL_PATH = Path(__file__).with_name("surrogate_model.json")

# The code whose behaviour the model learned. If any of it changes, the
# model may be describing a simulator that no longer exists.
_APP = Path(__file__).resolve().parents[1]
LEARNED_CODE = [
    _APP / "simulation" / "engine.py", _APP / "simulation" / "cohort.py", _APP / "routing" / "congestion.py",
    _APP / "routing" / "assignment.py", _APP / "routing" / "graph.py", _APP / "ml" / "features.py",
]


def engine_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in LEARNED_CODE:
        # Same fingerprint whether git checked the files out with CRLF or LF.
        digest.update(path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()[:16]


@lru_cache(maxsize=1)
def load_model() -> dict | None:
    if not MODEL_PATH.exists():
        return None
    model = json.loads(MODEL_PATH.read_text(encoding="utf-8"))
    # A model trained on a different feature list would silently read the wrong inputs.
    return model if model.get("featureNames") == FEATURE_NAMES else None


def _tree_value(tree: dict, x: list[float]) -> float:
    node = 0
    left, right, feature, threshold = tree["left"], tree["right"], tree["feature"], tree["threshold"]
    while left[node] != -1:
        node = left[node] if x[feature[node]] <= threshold[node] else right[node]
    return tree["value"][node]


def predict_target(target: dict, x: list[float]) -> float:
    """Gradient boosting: the initial constant plus every tree's shrunken vote."""
    return target["init"] + target["learningRate"] * sum(_tree_value(t, x) for t in target["trees"])


def predict_outcome(scenario: ScenarioConfig, random_seed: int | None = None) -> dict:
    """Instant estimate of what running this scenario's baseline plan would
    give. An estimate only: the Scenario Lab's Run button gives the real
    numbers, and the response carries the model's measured test error."""
    model = load_model()
    if model is None:
        return {"available": False,
                "reason": "No trained model found. Run: python scripts/train_surrogate.py (in backend/)."}

    started = time.perf_counter()
    x = scenario_features(scenario, random_seed)
    raw = {name: predict_target(target, x) for name, target in model["targets"].items()}
    # Each estimate's own 10th-90th percentile range, from the low and high models.
    bands = {name: sorted((predict_target(b["low"], x), predict_target(b["high"], x)))
             for name, b in model.get("ranges", {}).items()}
    params = scenario.default_params
    limit_minutes = params.max_ticks * params.tick_seconds / 60
    evacuees = int(x[FEATURE_NAMES.index("evacuees")])
    clearance = min(max(raw["clearanceMinutes"], 0.0), limit_minutes)

    def band(name: str, value: float, scale: float = 1.0, digits: int = 1) -> list[float] | None:
        if name not in bands:
            return None
        low, high = (max(0.0, v * scale) for v in bands[name])
        return [round(min(low, value), digits), round(max(high, value), digits)]

    unserved = min(evacuees, max(0, round(raw["unservedShare"] * evacuees)))
    peak = round(max(raw["peakCongestion"], 0.0), 2)
    return {
        "available": True,
        # 10th-90th percentile range for this estimate (None for a model trained without ranges).
        "ranges": {
            "clearanceMinutes": (r := band("clearanceMinutes", clearance)) and [r[0], min(r[1], limit_minutes)],
            "unservedCount": (u := band("unservedShare", unserved, evacuees, 0)) and [int(u[0]), min(evacuees, int(u[1]))],
            "peakCongestion": band("peakCongestion", peak, digits=2),
        },
        "clearanceMinutes": round(clearance, 1),
        "clearanceAtTimeLimit": clearance >= limit_minutes - 1,
        "unservedCount": unserved,
        "peakCongestion": peak,
        "evacuees": evacuees,
        "runtimeMs": round((time.perf_counter() - started) * 1000, 1),
        # Trained on a different version of the simulation code: retrain before trusting it.
        "outOfDate": model["card"].get("engineFingerprint") != engine_fingerprint(),
        "model": model["card"],
    }
