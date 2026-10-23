from __future__ import annotations

import os
from pathlib import Path

from app.models.schemas import ScenarioConfig

_DEFAULT_SCENARIOS_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"


def _scenarios_dir() -> Path:
    override = os.environ.get("AEGIS_SCENARIOS_DIR")
    return Path(override) if override else _DEFAULT_SCENARIOS_DIR


def list_scenarios() -> list[ScenarioConfig]:
    """Re-reads the directory every call — no cross-request caching, so a
    fixture edited on disk mid-demo is picked up immediately."""
    directory = _scenarios_dir()
    if not directory.exists():
        return []
    return [
        ScenarioConfig.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted(directory.glob("*.json"))
    ]


def get_scenario(scenario_id: str) -> ScenarioConfig | None:
    for scenario in list_scenarios():
        if scenario.id == scenario_id:
            return scenario
    return None
