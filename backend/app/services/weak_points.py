from __future__ import annotations

from app.models.schemas import RoadStatus, ScenarioConfig, SimulationParams
from app.routing.assignment import assign_shelters_and_routes
from app.routing.graph import build_graph
from app.services.scenario_overrides import apply_overrides
from app.simulation.cohort import CohortMetrics, simulate_plans_fast


def _plans(scenario: ScenarioConfig, params: SimulationParams):
    return assign_shelters_and_routes(scenario, build_graph(scenario), params.random_seed)


def _run(scenario: ScenarioConfig, params: SimulationParams) -> CohortMetrics:
    return simulate_plans_fast(scenario, _plans(scenario, params), params)


def _minutes(m: CohortMetrics, params: SimulationParams) -> float:
    ticks = params.max_ticks if m.completion_tick is None else m.completion_tick
    return ticks * params.tick_seconds / 60


def weak_points(scenario: ScenarioConfig, params: SimulationParams) -> dict:
    """Single-failure (N-1) analysis: take away each open road and each
    available shelter in turn, re-plan the default way and re-simulate, and
    rank them by how much worse the evacuation gets. Exact simulation (the
    cohort engine), not an estimate: about 2 ms per failure. Only roads the
    default plan uses are tested: losing a road nobody walks on leaves every
    shortest route, and so the whole run, unchanged."""
    names = {n.id: n.label or n.id for n in scenario.nodes}
    plans = _plans(scenario, params)
    used = {e for p in plans for e in p.route_edge_ids}
    base = simulate_plans_fast(scenario, plans, params)
    items = []
    for edge in scenario.edges:
        if edge.status != RoadStatus.OPEN or edge.id not in used:
            continue
        m = _run(apply_overrides(scenario, closed_edge_ids=[edge.id]), params)
        items.append(("road", edge.id, f"{names[edge.source]} — {names[edge.target]}", m))
    for shelter in scenario.shelters:
        if not shelter.available:
            continue
        m = _run(apply_overrides(scenario, unavailable_shelter_ids=[shelter.id]), params)
        items.append(("shelter", shelter.id, shelter.name, m))

    ranked = sorted(
        ({"kind": kind, "id": item_id, "label": label,
          "unservedChange": m.unserved - base.unserved,
          "clearanceChangeMinutes": round(_minutes(m, params) - _minutes(base, params), 1),
          "hitTimeLimit": m.hit_tick_limit}
         for kind, item_id, label, m in items),
        key=lambda r: (-r["unservedChange"], -r["clearanceChangeMinutes"], r["id"]),
    )
    return {
        "baseline": {"unserved": base.unserved, "clearanceMinutes": _minutes(base, params), "hitTimeLimit": base.hit_tick_limit},
        "items": ranked,
    }
