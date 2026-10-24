from __future__ import annotations

import time
import uuid

from pydantic import Field

from app.models.schemas import CamelModel, RunMetrics, RunResult, ScenarioConfig, SimulationParams
from app.optimization.bounds import clearance_lower_bound
from app.optimization.search import ITERATIONS, mean_hazard_ticks, optimize_plan, plan_score, with_every_lever
from app.routing.assignment import assign_shelters_and_routes
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph
from app.services.robustness import plan_robustness
from app.services.scenario_overrides import apply_overrides
from app.simulation.engine import simulate


class OptimizationRequest(CamelModel):
    # CamelModel so the frontend can POST {"scenarioId": "..."} directly.
    scenario_id: str
    random_seed: int = 42
    # Same what-if overrides as RunRequest, so the alternative plan is
    # computed for the scenario the planner is actually looking at.
    closed_edge_ids: list[str] = Field(default_factory=list)
    unavailable_shelter_ids: list[str] = Field(default_factory=list)


def generate_alternative_plan(request: OptimizationRequest) -> dict:
    """Returns a plain dict (routes.py's `optimize` endpoint has no
    response_model — see master plan §3.3), so CamelModel's alias
    generation does NOT apply automatically here the way it does for
    every Pydantic response elsewhere in the API. Every key below is
    therefore written camelCase by hand, and nested RunResults are
    dumped with `by_alias=True`, to match frontend/lib/api/client.ts's
    `AlternativePlanResponse` interface exactly — do not add a
    snake_case key here, it will silently fail to deserialize on the
    frontend."""
    from app.services.scenario_store import get_scenario

    scenario = get_scenario(request.scenario_id)
    if scenario is None:
        return {"feasible": False, "reason": f"Unknown scenario_id '{request.scenario_id}'",
                "changes": [], "tradeOffs": [], "orders": []}
    scenario = apply_overrides(scenario, request.closed_edge_ids, request.unavailable_shelter_ids)

    graph = build_graph(scenario)
    # Both runs use the requested seed, and RunResult.random_seed reports it
    # truthfully (the scenario default is only the fallback).
    params = scenario.default_params.model_copy(update={"random_seed": request.random_seed})

    baseline_plans = assign_shelters_and_routes(scenario, graph, request.random_seed)
    baseline_result = simulate(scenario, baseline_plans, params,
                                 CongestionModel(scenario, params), plan_label="baseline")

    started = time.perf_counter()
    search = optimize_plan(scenario, graph, params, request.random_seed)
    search_ms = (time.perf_counter() - started) * 1000
    # The search scores candidates with the cohort simulation; the plan it
    # returns is re-run on the real engine, and only that run is reported.
    # Run on the scenario as the plan changes it (standby shelters opened, marshals posted).
    alt_result = simulate(search.scenario, search.plans, params,
                            CongestionModel(search.scenario, params), plan_label="alternative")

    base, alt = baseline_result.metrics, alt_result.metrics
    search_info = {
        "method": "simulated annealing",
        "iterations": ITERATIONS,
        "plansEvaluated": search.evaluations,
        "blockSize": search.block_size,
        "runtimeMs": round(search_ms),
        # No plan can clear sooner than this (walking time and road capacity limits).
        # Computed as if every standby shelter were opened and every road marshalled, so it holds for any plan.
        "clearanceLowerBoundMinutes": _bound_minutes(clearance_lower_bound(with_every_lever(scenario), params), params),
    }
    orders = [
        {"zoneId": o.zone_id, "movementProfile": o.movement_profile, "people": o.people,
         "shelterId": o.shelter_id, "routeEdgeIds": list(o.route_edge_ids),
         "departureMinute": o.departure_tick * params.tick_seconds / 60}
        for o in search.orders
    ]
    robustness = plan_robustness(scenario, baseline_plans, search.plans, params, request.random_seed,
                                 search.scenario, search.levers.cost)
    names = {s.id: s.name for s in scenario.shelters}
    interventions = {
        "openedShelters": [{"shelterId": s, "name": names[s]} for s in sorted(search.levers.opened)],
        "marshalledRoads": sorted(search.levers.marshals),
    }
    improved = (alt.unserved_count <= base.unserved_count
                and _run_score(search.scenario, alt_result, params) + search.levers.cost
                < _run_score(scenario, baseline_result, params))

    if not improved:
        return {
            "feasible": False,
            "reason": (
                f"The optimizer did not improve on the baseline after evaluating {search.evaluations} plans: "
                f"unserved {alt.unserved_count} vs baseline {base.unserved_count}, "
                f"{_completion_trade_off(base, alt, params)}."
            ),
            # Both runs are still returned so the UI can show the evidence
            # behind the verdict; the candidate is labeled, never promoted.
            "baselineRun": baseline_result.model_dump(by_alias=True),
            "alternativeRun": alt_result.model_dump(by_alias=True),
            "changes": [], "tradeOffs": [], "orders": orders, "search": search_info, "robustness": robustness,
            "interventions": interventions,
        }

    changes = []
    for alt_plan, base_plan in zip(search.plans, baseline_plans):
        if alt_plan.assigned_shelter != base_plan.assigned_shelter:
            changes.append({
                "agentId": alt_plan.agent_id,
                "originZone": alt_plan.origin_zone,
                "oldShelter": base_plan.assigned_shelter,
                "newShelter": alt_plan.assigned_shelter,
                "reason": "reassigned by the plan optimizer",
            })

    staged = [p.departure_tick for p in search.plans if p.departure_tick > 0]
    return {
        "feasible": True,
        "runId": str(uuid.uuid4()),
        "planLabel": "alternative",
        "baselineRun": baseline_result.model_dump(by_alias=True),
        "alternativeRun": alt_result.model_dump(by_alias=True),
        "changes": changes,
        "orders": orders,
        "search": search_info,
        "robustness": robustness,
        "interventions": interventions,
        "tradeOffs": [
            *[f"opens standby shelter {s['name']} ({s['shelterId']})" for s in interventions["openedShelters"]],
            *([f"marshal teams on road(s) {', '.join(interventions['marshalledRoads'])}"]
              if interventions["marshalledRoads"] else []),
            f"{len(changes)} of {len(search.plans)} evacuees go to a different shelter",
            (f"{len(staged)} evacuees leave in later waves (up to +{_minutes(max(staged), params)} min)"
             if staged else "everyone leaves at once, as in the baseline"),
            f"unserved: {base.unserved_count} -> {alt.unserved_count}",
            _completion_trade_off(base, alt, params),
            f"average time to shelter: {_minutes(_mean_arrival(baseline_result), params)} -> "
            f"{_minutes(_mean_arrival(alt_result), params)} min",
            f"peak congestion ratio: {base.max_congestion_ratio:.2f} -> {alt.max_congestion_ratio:.2f}",
            f"evacuees routed over hazard-risk roads: {_on_hazard_roads(scenario, baseline_result)} -> "
            f"{_on_hazard_roads(scenario, alt_result)}",
        ],
    }


def _bound_minutes(ticks: int | None, params: SimulationParams) -> float | None:
    return None if ticks is None else ticks * params.tick_seconds / 60


def _mean_arrival(run: RunResult) -> float:
    ticks = [a.arrival_tick for a in run.agents if a.arrival_tick is not None]
    return sum(ticks) / len(ticks) if ticks else 0.0


def _run_score(scenario: ScenarioConfig, run: RunResult, params: SimulationParams) -> float:
    """The optimizer's objective, computed from a real engine run."""
    routed = [a for a in run.agents if a.route_edge_ids]
    routes = [(tuple(a.route_edge_ids), 1) for a in routed]
    orders = len({(tuple(a.route_edge_ids), a.movement_profile, a.departure_tick, a.assigned_shelter) for a in routed})
    m = run.metrics
    return plan_score(m.unserved_count, m.completion_tick, _mean_arrival(run), m.max_congestion_ratio,
                      params.max_ticks, mean_hazard_ticks(scenario, routes, params.tick_seconds), orders)


def _on_hazard_roads(scenario: ScenarioConfig, run: RunResult) -> int:
    risky = {e.id for e in scenario.edges if e.hazard_risk > 0}
    return sum(1 for a in run.agents if risky.intersection(a.route_edge_ids))


def _minutes(ticks: float, params: SimulationParams) -> str:
    return f"{ticks * params.tick_seconds / 60:.1f}".removesuffix(".0")


def _completion_trade_off(baseline: RunMetrics, alternative: RunMetrics, params: SimulationParams) -> str:
    """Always spell out what happened to clearance time, including when a
    run hit its tick limit and the two can't be compared."""
    def clearance(m: RunMetrics) -> str:
        if m.completion_tick is None:
            return f"not finished within the {_minutes(params.max_ticks, params)} min limit"
        return f"{_minutes(m.completion_tick, params)} min"

    return f"clearance time: {clearance(baseline)} -> {clearance(alternative)}"
