from __future__ import annotations

import uuid

from app.models.schemas import AgentPlan, CamelModel, RunMetrics, ScenarioConfig
from app.routing.assignment import assign_shelters_and_routes, build_demand_units
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph, compute_shortest_route
from app.simulation.engine import simulate


class OptimizationRequest(CamelModel):
    # CamelModel so the frontend can POST {"scenarioId": "..."} directly.
    scenario_id: str
    random_seed: int = 42


def _k_nearest_balanced_assignment(
    scenario: ScenarioConfig, graph, random_seed: int, k: int = 2
) -> list[AgentPlan]:
    """Alternative heuristic (PRD §7.3 steps 5-6): instead of always
    picking the single nearest reachable shelter, each demand unit picks
    the LEAST-LOADED shelter (highest remaining-capacity ratio) among its
    k nearest reachable ones. Spreads load instead of piling everyone
    onto the closest shelter until it's full."""
    edges_by_id = {e.id: e for e in scenario.edges}
    remaining = {s.id: s.total_capacity - s.occupied for s in scenario.shelters}
    total = {s.id: s.total_capacity for s in scenario.shelters}
    route_cache: dict[tuple[str, str], list[str] | None] = {}

    def route(zone_node: str, shelter_node: str) -> list[str] | None:
        key = (zone_node, shelter_node)
        if key not in route_cache:
            route_cache[key] = compute_shortest_route(graph, edges_by_id, zone_node, shelter_node)
        return route_cache[key]

    # Same seeded demand order as the baseline assignment, so plan i here
    # and plan i there describe the same evacuee (generate_alternative_plan
    # zips the two lists to report reassignments).
    plans: list[AgentPlan] = []
    for i, (zone, profile) in enumerate(build_demand_units(scenario, random_seed)):
        candidates = []
        for shelter in scenario.shelters:
            if not shelter.available or remaining.get(shelter.id, 0) <= 0:
                continue
            r = route(zone.connector_node, shelter.connector_node)
            if r is not None:
                distance = sum(edges_by_id[e].length_m for e in r)
                candidates.append((distance, shelter.id, r))
        candidates.sort(key=lambda c: c[0])
        top_k = candidates[:k]
        if top_k:
            top_k.sort(key=lambda c: remaining[c[1]] / total[c[1]], reverse=True)
            distance, shelter_id, r = top_k[0]
            remaining[shelter_id] -= 1
            plans.append(AgentPlan(agent_id=f"{zone.id}-alt-{i}", origin_zone=zone.id,
                                     assigned_shelter=shelter_id, route_edge_ids=r,
                                     movement_profile=profile, distance_m=distance))
        else:
            plans.append(AgentPlan(agent_id=f"{zone.id}-alt-{i}", origin_zone=zone.id,
                                     assigned_shelter=None, route_edge_ids=[], movement_profile=profile,
                                     distance_m=0.0))
    return plans


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
                "changes": [], "tradeOffs": []}

    graph = build_graph(scenario)
    # Both runs use the requested seed, and RunResult.random_seed reports it
    # truthfully (the scenario default is only the fallback).
    params = scenario.default_params.model_copy(update={"random_seed": request.random_seed})

    baseline_plans = assign_shelters_and_routes(scenario, graph, request.random_seed)
    baseline_result = simulate(scenario, baseline_plans, params,
                                 CongestionModel(scenario, params), plan_label="baseline")

    alt_plans = _k_nearest_balanced_assignment(scenario, graph, request.random_seed)
    alt_result = simulate(scenario, alt_plans, params,
                            CongestionModel(scenario, params), plan_label="alternative")

    improved_unserved = alt_result.metrics.unserved_count < baseline_result.metrics.unserved_count
    improved_congestion = alt_result.metrics.max_congestion_ratio < baseline_result.metrics.max_congestion_ratio
    not_worse_unserved = alt_result.metrics.unserved_count <= baseline_result.metrics.unserved_count

    if not (not_worse_unserved and (improved_unserved or improved_congestion)):
        return {
            "feasible": False,
            "reason": (
                f"Load-balanced reassignment did not improve on the baseline: "
                f"unserved {alt_result.metrics.unserved_count} vs baseline "
                f"{baseline_result.metrics.unserved_count}, peak congestion "
                f"{alt_result.metrics.max_congestion_ratio:.2f} vs baseline "
                f"{baseline_result.metrics.max_congestion_ratio:.2f}."
            ),
            # Both runs are still returned so the UI can show the evidence
            # behind the verdict; the candidate is labeled, never promoted.
            "baselineRun": baseline_result.model_dump(by_alias=True),
            "alternativeRun": alt_result.model_dump(by_alias=True),
            "changes": [], "tradeOffs": [],
        }

    changes = []
    for alt_plan, base_plan in zip(alt_plans, baseline_plans):
        if alt_plan.assigned_shelter != base_plan.assigned_shelter:
            changes.append({
                "agentId": alt_plan.agent_id,
                "originZone": alt_plan.origin_zone,
                "oldShelter": base_plan.assigned_shelter,
                "newShelter": alt_plan.assigned_shelter,
                "reason": "reassigned to balance shelter load",
            })

    return {
        "feasible": True,
        "runId": str(uuid.uuid4()),
        "planLabel": "alternative",
        "baselineRun": baseline_result.model_dump(by_alias=True),
        "alternativeRun": alt_result.model_dump(by_alias=True),
        "changes": changes,
        "tradeOffs": [
            f"{len(changes)} of {len(alt_plans)} agents reassigned to a different shelter",
            f"unserved: {baseline_result.metrics.unserved_count} -> {alt_result.metrics.unserved_count}",
            f"peak congestion ratio: {baseline_result.metrics.max_congestion_ratio:.2f} -> "
            f"{alt_result.metrics.max_congestion_ratio:.2f}",
            _completion_trade_off(baseline_result.metrics, alt_result.metrics),
        ],
    }


def _completion_trade_off(baseline: RunMetrics, alternative: RunMetrics) -> str:
    """The feasibility verdict only weighs unserved count and peak
    congestion, so always spell out what happened to completion time —
    a congestion win that costs time must be visible, not implied away."""
    if baseline.completion_tick is None or alternative.completion_tick is None:
        return "completion time: not comparable (a run hit its tick limit)"
    return f"completion tick: {baseline.completion_tick} -> {alternative.completion_tick}"
