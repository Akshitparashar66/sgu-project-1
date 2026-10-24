from __future__ import annotations

import csv
import io
import math
import re

from pydantic import Field

from app.models.schemas import CamelModel, PopulationZone, ScenarioConfig, Shelter
from app.services.scenario_store import imported_dir
from app.services.scenario_validation import reference_errors, scenario_summary

MAX_ROWS = 500
MAX_EVACUEES = 10_000  # keeps a run to a few seconds
FAR_FROM_NETWORK_M = 1_000

ZONE_COLUMNS = {
    "name": ("name", "zone", "ward", "area"),
    "population": ("population", "evacuees", "people"),
    "lat": ("lat", "latitude"),
    "lon": ("lon", "lng", "longitude"),
    "slow": ("reduced_mobility_share", "reduced_mobility", "slow_share", "vulnerable_share"),
}
SHELTER_COLUMNS = {
    "name": ("name", "shelter"),
    "capacity": ("capacity", "places", "beds"),
    "lat": ("lat", "latitude"),
    "lon": ("lon", "lng", "longitude"),
}


class ImportRequest(CamelModel):
    """A planner's own zones and/or shelters (CSV text, e.g. from the DDMP),
    placed on an existing scenario's street network."""
    base_scenario_id: str
    name: str = Field(min_length=1, max_length=80)
    zones_csv: str | None = None  # None keeps the base scenario's zones
    shelters_csv: str | None = None  # None keeps the base scenario's shelters


class ScenarioImportError(ValueError):
    def __init__(self, errors: list[dict]):
        self.errors = errors
        super().__init__(f"{len(errors)} problem(s) in the uploaded data; first: {errors[0]['field']} — {errors[0]['message']}")


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat = math.radians((a[0] + b[0]) / 2)
    return math.hypot(math.radians(b[0] - a[0]), math.radians(b[1] - a[1]) * math.cos(lat)) * 6_371_000


def _rows(text: str, columns: dict[str, tuple[str, ...]], source: str, required: set[str], errors: list[dict]) -> list[dict]:
    # Excel saves CSV with a byte-order mark.
    reader = csv.DictReader(io.StringIO(text.lstrip(chr(0xFEFF))))
    # "Reduced mobility share", "reduced-mobility-share" and "reduced_mobility_share" all match.
    headers = {re.sub(r"[\s\-]+", "_", h.strip().lower()): h for h in (reader.fieldnames or [])}
    found = {key: next((headers[a] for a in aliases if a in headers), None) for key, aliases in columns.items()}
    missing = [columns[k][0] for k in required if found[k] is None]
    if missing:
        errors.append({"field": source, "message": f"missing column(s): {', '.join(missing)}"})
        return []
    rows = []
    for n, raw in enumerate(reader, start=2):  # row 1 is the header
        if n - 1 > MAX_ROWS:
            errors.append({"field": source, "message": f"more than {MAX_ROWS} rows"})
            break
        if not any((v or "").strip() for v in raw.values()):
            continue
        rows.append({"_row": n, **{k: (raw.get(col) or "").strip() if col else "" for k, col in found.items()}})
    if not rows:
        errors.append({"field": source, "message": "no data rows"})
    return rows


def _number(row: dict, key: str, source: str, errors: list[dict], *, low: float, high: float, integer=False):
    value = row[key]
    try:
        number = int(value) if integer else float(value)
    except ValueError:
        errors.append({"field": f"{source} row {row['_row']} {key}", "message": f"'{value}' is not a {'whole ' if integer else ''}number"})
        return None
    if not low <= number <= high:
        errors.append({"field": f"{source} row {row['_row']} {key}", "message": f"{number} is outside {low}–{high}"})
        return None
    return number


def import_scenario(request: ImportRequest, base: ScenarioConfig) -> dict:
    nodes = [(n.id, (n.lat, n.lon), n.label or n.id) for n in base.nodes]
    errors: list[dict] = []
    warnings: list[str] = []

    def snap(row: dict, source: str, what: str) -> str | None:
        lat = _number(row, "lat", source, errors, low=-90, high=90)
        lon = _number(row, "lon", source, errors, low=-180, high=180)
        if lat is None or lon is None:
            return None
        node_id, distance, label = min(((nid, _metres((lat, lon), pos), lbl) for nid, pos, lbl in nodes), key=lambda t: t[1])
        if distance > FAR_FROM_NETWORK_M:
            warnings.append(f"{what} is {distance / 1000:.1f} km from the nearest road junction ({label}); "
                            f"it is connected there, but that walk isn't simulated.")
        return node_id

    zones = base.zones
    if request.zones_csv is not None:
        zones = []
        for i, row in enumerate(_rows(request.zones_csv, ZONE_COLUMNS, "zonesCsv", {"name", "population", "lat", "lon"}, errors), 1):
            name = row["name"] or f"Zone {i}"
            node = snap(row, "zonesCsv", f"Zone '{name}'")
            people = _number(row, "population", "zonesCsv", errors, low=0, high=MAX_EVACUEES, integer=True)
            slow = 0.15
            if row["slow"]:
                slow = _number(row, "slow", "zonesCsv", errors, low=0, high=100) or 0.0
                slow = slow / 100 if slow > 1 else slow
            if node and people is not None:
                zones.append(PopulationZone(id=f"Z{i}", name=name, connector_node=node, evacuee_count=people,
                                            movement_profile={"standard": round(1 - slow, 4), "reduced_mobility": round(slow, 4)}))

    shelters = base.shelters
    if request.shelters_csv is not None:
        shelters = []
        for i, row in enumerate(_rows(request.shelters_csv, SHELTER_COLUMNS, "sheltersCsv", {"name", "capacity", "lat", "lon"}, errors), 1):
            name = row["name"] or f"Shelter {i}"
            node = snap(row, "sheltersCsv", f"Shelter '{name}'")
            capacity = _number(row, "capacity", "sheltersCsv", errors, low=1, high=100_000, integer=True)
            if node and capacity is not None:
                shelters.append(Shelter(id=f"S{i}", name=name, connector_node=node, total_capacity=capacity))

    if not errors and sum(z.evacuee_count for z in zones) > MAX_EVACUEES:
        errors.append({"field": "zonesCsv", "message": f"more than {MAX_EVACUEES:,} evacuees in total"})
    if errors:
        raise ScenarioImportError(errors)

    slug = re.sub(r"[^a-z0-9]+", "_", request.name.lower()).strip("_")[:40] or "data"
    scenario = base.model_copy(deep=True, update={
        "id": f"imported_{slug}",
        "name": request.name,
        "description": f"Imported data on the {base.name} street network: "
                       f"{'uploaded' if request.zones_csv is not None else 'original'} zones, "
                       f"{'uploaded' if request.shelters_csv is not None else 'original'} shelters. "
                       "Each place is connected to its nearest road junction.",
        "synthetic": False,
        "zones": zones,
        "shelters": shelters,
    })
    scenario = ScenarioConfig.model_validate(scenario.model_dump())
    problems = reference_errors(scenario)
    if problems:
        raise ScenarioImportError(problems)

    directory = imported_dir()
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{scenario.id}.json").write_text(scenario.model_dump_json(by_alias=True, indent=2), encoding="utf-8")
    return {"scenarioId": scenario.id, "summary": scenario_summary(scenario), "warnings": warnings}
