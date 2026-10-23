from __future__ import annotations

import json
import time
from functools import lru_cache
from pathlib import Path

from app.ml.features import FEATURE_NAMES, scenario_features
from app.models.schemas import ScenarioConfig

# Written by scripts/train_surrogate.py. Plain JSON trees, not a pickle: no
# scikit-learn needed at runtime and nothing executable is loaded.
MODEL_PATH = Path(__file__).with_name("surrogate_model.json")


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


def predict_outcome(scenario: ScenarioConfig) -> dict:
    """Instant estimate of what running this scenario's baseline plan would
    give. An estimate only: the Scenario Lab's Run button gives the real
    numbers, and the response carries the model's measured test error."""
    model = load_model()
    if model is None:
        return {"available": False,
                "reason": "No trained model found. Run: python scripts/train_surrogate.py (in backend/)."}

    started = time.perf_counter()
    x = scenario_features(scenario)
    raw = {name: predict_target(target, x) for name, target in model["targets"].items()}
    params = scenario.default_params
    limit_minutes = params.max_ticks * params.tick_seconds / 60
    evacuees = int(x[FEATURE_NAMES.index("evacuees")])
    clearance = min(max(raw["clearanceMinutes"], 0.0), limit_minutes)

    return {
        "available": True,
        "clearanceMinutes": round(clearance, 1),
        "clearanceAtTimeLimit": clearance >= limit_minutes - 1,
        "unservedCount": min(evacuees, max(0, round(raw["unservedShare"] * evacuees))),
        "peakCongestion": round(max(raw["peakCongestion"], 0.0), 2),
        "evacuees": evacuees,
        "runtimeMs": round((time.perf_counter() - started) * 1000, 1),
        "model": model["card"],
    }
