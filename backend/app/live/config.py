from __future__ import annotations

import json
import os
from pathlib import Path

_DEFAULT = Path(__file__).resolve().parents[3] / "data" / "live_sources.json"  # committed: what to watch


def load_config() -> dict:
    override = os.environ.get("AEGIS_LIVE_CONFIG")
    return json.loads(Path(override or _DEFAULT).read_text(encoding="utf-8"))


def live_enabled() -> bool:
    """Network sources (NDMA, TomTom, river feed polling) only run with
    AEGIS_LIVE=1, so tests and CI never touch the internet."""
    return os.environ.get("AEGIS_LIVE") == "1"
