from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from pydantic import Field

from app.models.schemas import CamelModel

_DEFAULT_PLANS_DIR = Path(__file__).resolve().parents[3] / "data" / "plans"  # git-ignored


def plans_dir() -> Path:
    override = os.environ.get("AEGIS_PLANS_DIR")
    return Path(override) if override else _DEFAULT_PLANS_DIR


class SavePlanRequest(CamelModel):
    name: str = Field(min_length=1, max_length=80)
    prepared_by: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=500)
    scenario_id: str
    random_seed: int = 42
    closed_edge_ids: list[str] = Field(default_factory=list)
    unavailable_shelter_ids: list[str] = Field(default_factory=list)


class ApproveRequest(CamelModel):
    approved_by: str = Field(min_length=1, max_length=80)
    note: str = Field(default="", max_length=500)


class PlanNotFound(LookupError):
    pass


class PlanTampered(ValueError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Everything that defines what was planned. Approvals are appended later and
# deliberately left out, so approving never changes the fingerprint.
_CONTENT_KEYS = ("name", "version", "savedAt", "preparedBy", "note", "scenarioId", "scenarioName", "randomSeed",
                 "closedEdgeIds", "unavailableShelterIds", "feasible", "summary", "orders", "interventions", "tradeOffs")


def content_hash(record: dict) -> str:
    content = {k: record.get(k) for k in _CONTENT_KEYS}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _audit(event: dict) -> None:
    with (plans_dir() / "audit.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps({"at": _now(), **event}, ensure_ascii=False) + "\n")


def _path(plan_id: str) -> Path:
    if not all(c.isalnum() or c == "-" for c in plan_id):
        raise PlanNotFound(plan_id)
    return plans_dir() / f"{plan_id}.json"


def _load(plan_id: str) -> dict:
    path = _path(plan_id)
    if not path.exists():
        raise PlanNotFound(plan_id)
    return json.loads(path.read_text(encoding="utf-8"))


def _minutes(run: dict | None, tick_seconds: float) -> float | None:
    if not run or run["metrics"]["completionTick"] is None:
        return None
    return run["metrics"]["completionTick"] * tick_seconds / 60


def save_plan(request: SavePlanRequest, scenario) -> dict:
    """Recompute the optimized plan from its inputs (the search is
    deterministic, so it is the plan the planner saw) and store it as a new
    version, with a fingerprint that approval later checks."""
    from app.optimization.planner import OptimizationRequest, generate_alternative_plan

    plan = generate_alternative_plan(OptimizationRequest(
        scenario_id=request.scenario_id, random_seed=request.random_seed,
        closed_edge_ids=request.closed_edge_ids, unavailable_shelter_ids=request.unavailable_shelter_ids))
    tick_seconds = scenario.default_params.tick_seconds
    directory = plans_dir()
    directory.mkdir(parents=True, exist_ok=True)
    version = 1 + sum(1 for p in list_plans() if p["name"] == request.name)
    record = {
        "id": str(uuid.uuid4()), "name": request.name, "version": version, "savedAt": _now(),
        "preparedBy": request.prepared_by, "note": request.note,
        "scenarioId": request.scenario_id, "scenarioName": scenario.name, "randomSeed": request.random_seed,
        "closedEdgeIds": sorted(request.closed_edge_ids), "unavailableShelterIds": sorted(request.unavailable_shelter_ids),
        "feasible": plan["feasible"],
        "summary": {
            name: {"unserved": run["metrics"]["unservedCount"], "clearanceMinutes": _minutes(run, tick_seconds)}
            for name, run in (("baseline", plan.get("baselineRun")), ("optimized", plan.get("alternativeRun"))) if run
        },
        "orders": plan.get("orders", []), "interventions": plan.get("interventions"), "tradeOffs": plan.get("tradeOffs", []),
        "approvals": [],
    }
    record["contentHash"] = content_hash(record)
    _path(record["id"]).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    _audit({"event": "saved", "planId": record["id"], "name": record["name"], "version": version,
            "by": request.prepared_by, "note": request.note, "contentHash": record["contentHash"]})
    return record


def _summary(record: dict) -> dict:
    keys = ("id", "name", "version", "savedAt", "preparedBy", "note", "scenarioId", "scenarioName", "feasible",
            "summary", "approvals", "contentHash")
    return {**{k: record[k] for k in keys}, "intact": content_hash(record) == record["contentHash"]}


def list_plans() -> list[dict]:
    directory = plans_dir()
    if not directory.exists():
        return []
    records = [json.loads(p.read_text(encoding="utf-8")) for p in directory.glob("*.json")]
    return sorted((_summary(r) for r in records), key=lambda r: r["savedAt"], reverse=True)


def get_plan(plan_id: str) -> dict:
    record = _load(plan_id)
    return {**record, "intact": content_hash(record) == record["contentHash"]}


def approve_plan(plan_id: str, request: ApproveRequest) -> dict:
    record = _load(plan_id)
    if content_hash(record) != record["contentHash"]:
        raise PlanTampered("This plan's file was changed after it was saved, so it can't be approved. Save it again.")
    record["approvals"].append({"by": request.approved_by, "at": _now(), "note": request.note})
    _path(plan_id).write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    _audit({"event": "approved", "planId": plan_id, "name": record["name"], "version": record["version"],
            "by": request.approved_by, "note": request.note, "contentHash": record["contentHash"]})
    return {**record, "intact": True}


def audit_log() -> list[dict]:
    path = plans_dir() / "audit.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()][::-1]
