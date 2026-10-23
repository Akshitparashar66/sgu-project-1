"""Plain-language briefing of a simulation run, written by Gemini from the
run's own numbers. The model only rewrites facts it is given; every number
in its answer is checked against those facts, and a briefing with a number
that isn't backed by the run is discarded for the deterministic template."""
from __future__ import annotations

import json
import re
from collections import Counter

from pydantic import Field

from app.ai.llm import AIUnavailable, complete_text
from app.models.schemas import AgentStatus, CamelModel, RunResult, ScenarioConfig
from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.services.scenario_overrides import apply_overrides
from app.simulation.engine import RunRequest, run_simulation

TOP_ROADS = 3

SYSTEM_PROMPT = """You write short situation briefings for emergency-evacuation planners who use AEGIS, \
a planning prototype that simulates evacuations on synthetic data. You are given one simulation run \
(and sometimes a comparison with an alternative shelter-assignment plan) as JSON inside <run_results>.

Write a briefing of 100-170 words for a planner who has not looked at the dashboard:
- Lead with the outcome: how many evacuees reached a shelter, how many were left unserved, and how long it took.
- Then the main problem: the worst bottleneck road or the shelter shortfall, naming places as the JSON names them, with ids in parentheses, e.g. "North RNE School Camp (S1)".
- If an "alternative" block is present, say plainly whether the alternative plan helps, based on its "verdict", and what it costs.
- If "whatIf" lists closed roads or unavailable shelters, mention them as the conditions of this run.

Every number you write must appear in the JSON (rounding is fine). Do not calculate new numbers, estimate, \
or speculate beyond the data. This is a simulation on synthetic data: do not present it as live guidance and do \
not give instructions to the public. Plain text only: two or three short paragraphs, no headings, no lists, no markdown."""


class BriefingRequest(CamelModel):
    scenario_id: str
    random_seed: int | None = None
    closed_edge_ids: list[str] = Field(default_factory=list)
    unavailable_shelter_ids: list[str] = Field(default_factory=list)
    # True: brief the baseline-vs-alternative comparison from /optimization/plan.
    include_plan: bool = False


def _minutes(tick: int | None, tick_seconds: float) -> float | None:
    return None if tick is None else round(tick * tick_seconds / 60, 1)


def _run_facts(scenario: ScenarioConfig, run: RunResult) -> dict:
    labels = {n.id: n.label or n.id for n in scenario.nodes}
    edges = {e.id: e for e in scenario.edges}
    shelter_names = {s.id: s.name for s in scenario.shelters}
    routed = Counter(edge_id for agent in run.agents for edge_id in agent.route_edge_ids)
    # Why each unserved agent is unserved: never assigned a reachable place, turned away at a
    # full shelter (walked every road), or still walking when the run hit its time limit.
    no_place, turned_away, still_walking = Counter(), Counter(), Counter()
    for a in run.agents:
        if a.status != AgentStatus.UNSERVED:
            continue
        if not a.route_edge_ids:
            no_place[a.origin_zone] += 1
        elif len(a.edge_exit_ticks) < len(a.route_edge_ids):
            still_walking[a.origin_zone] += 1
        else:
            turned_away[a.origin_zone] += 1
    worst = sorted((c for c in run.congestion if c.peak_demand_to_capacity > 0),
                   key=lambda c: c.peak_demand_to_capacity, reverse=True)[:TOP_ROADS]
    m = run.metrics
    return {
        "evacuated": m.evacuated_count,
        "unserved": m.unserved_count,
        "completionMinutes": _minutes(m.completion_tick, scenario.default_params.tick_seconds),
        "hitTimeLimit": m.hit_tick_limit,
        "peakCongestionRatio": round(m.max_congestion_ratio, 2),
        "shelters": [
            {"id": s.shelter_id, "name": shelter_names.get(s.shelter_id, s.shelter_id), "capacity": s.total_capacity,
             "finalOccupied": s.final_occupied, "turnedAway": s.rejected_count}
            for s in run.shelters
        ],
        "busiestRoads": [
            {"id": c.edge_id,
             "between": f"{labels.get(edges[c.edge_id].source)} and {labels.get(edges[c.edge_id].target)}",
             "peakDemandToCapacity": round(c.peak_demand_to_capacity, 2),
             "evacueesRouted": routed[c.edge_id],
             "congestionDelayAgentHours": round(c.total_delay_s / 3600, 1)}
            for c in worst if c.edge_id in edges
        ],
        "unservedByZone": [
            {"zoneId": z.id, "name": z.name, "noShelterPlace": no_place[z.id],
             "turnedAwayAtFullShelter": turned_away[z.id], "stillWalkingAtTimeLimit": still_walking[z.id]}
            for z in scenario.zones if no_place[z.id] + turned_away[z.id] + still_walking[z.id]
        ],
    }


def _difference(baseline: float | None, alternative: float | None) -> dict | None:
    if baseline is None or alternative is None:
        return None
    change = round(alternative - baseline, 2)
    percent = round(change / baseline * 100) if baseline else None
    return {"change": change, "percentChange": percent}


def briefing_facts(scenario: ScenarioConfig, baseline: RunResult, alternative: RunResult | None = None,
                   plan: dict | None = None) -> dict:
    """`scenario` is the effective scenario (what-if overrides already applied)."""
    labels = {n.id: n.label or n.id for n in scenario.nodes}
    facts: dict = {
        "scenario": {
            "name": scenario.name,
            "description": scenario.description,
            "totalEvacuees": sum(z.evacuee_count for z in scenario.zones),
            "totalShelterCapacity": sum(s.total_capacity for s in scenario.shelters if s.available),
            "syntheticData": scenario.synthetic,
        },
        "whatIf": {
            "closedRoads": [{"id": e.id, "between": f"{labels.get(e.source)} and {labels.get(e.target)}"}
                            for e in scenario.edges if e.status == "closed"],
            "unavailableShelters": [{"id": s.id, "name": s.name} for s in scenario.shelters if not s.available],
        },
        "baseline": _run_facts(scenario, baseline),
    }
    if alternative is not None and plan is not None:
        alt = _run_facts(scenario, alternative)
        base = facts["baseline"]
        facts["alternative"] = {
            "verdict": "improves on the baseline" if plan.get("feasible") else "does not improve on the baseline",
            "reason": plan.get("reason"),
            "agentsReassigned": len(plan.get("changes", [])),
            **alt,
            "differencesFromBaseline": {
                key: _difference(base[key], alt[key])
                for key in ("evacuated", "unserved", "completionMinutes", "peakCongestionRatio")
            },
        }
    return facts


def template_briefing(facts: dict) -> str:
    """The offline briefing: the same facts, in fixed sentences."""
    s, base = facts["scenario"], facts["baseline"]
    paragraphs = []

    conditions = [f"road {r['id']} between {r['between']} closed" for r in facts["whatIf"]["closedRoads"]]
    conditions += [f"{sh['name']} ({sh['id']}) unavailable" for sh in facts["whatIf"]["unavailableShelters"]]
    opening = f"{s['name']}" + (f", with {', '.join(conditions)}" if conditions else "") + ": "
    opening += f"{base['evacuated']} of {s['totalEvacuees']} evacuees reached a shelter and {base['unserved']} were left unserved."
    if base["hitTimeLimit"]:
        opening += " The run hit its time limit before every evacuee was resolved."
    elif base["completionMinutes"] is not None:
        opening += f" The evacuation finished in {base['completionMinutes']} minutes."
    paragraphs.append(opening)

    problems = []
    if base["busiestRoads"]:
        road = base["busiestRoads"][0]
        problems.append(
            f"The worst bottleneck was road {road['id']}, between {road['between']}, which peaked at "
            f"{road['peakDemandToCapacity']}× its capacity with {road['evacueesRouted']} evacuees routed over it."
        )
    for shelter in base["shelters"]:
        if shelter["turnedAway"]:
            problems.append(f"{shelter['name']} ({shelter['id']}) filled up and turned {shelter['turnedAway']} people away.")
    for zone in base["unservedByZone"]:
        where = f"{zone['name']} ({zone['zoneId']})"
        if zone["noShelterPlace"]:
            problems.append(f"{zone['noShelterPlace']} evacuees from {where} had no reachable shelter place.")
        if zone["stillWalkingAtTimeLimit"]:
            problems.append(f"{zone['stillWalkingAtTimeLimit']} evacuees from {where} were still walking when time ran out.")
    if problems:
        paragraphs.append(" ".join(problems))

    alt = facts.get("alternative")
    if alt:
        line = f"The load-balanced alternative plan {alt['verdict']}: unserved {base['unserved']} → {alt['unserved']}, " \
               f"peak congestion {base['peakCongestionRatio']}× → {alt['peakCongestionRatio']}×"
        if base["completionMinutes"] is not None and alt["completionMinutes"] is not None:
            line += f", completion {base['completionMinutes']} → {alt['completionMinutes']} minutes"
        line += f", with {alt['agentsReassigned']} evacuees reassigned."
        paragraphs.append(line)

    return "\n\n".join(paragraphs)


_NUMBER = re.compile(r"(?<![A-Za-z\d.])\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> list[str]:
    return [token.replace(",", "") for token in _NUMBER.findall(text)]


def unsupported_numbers(text: str, facts: dict) -> list[str]:
    """Numbers in `text` that no fact backs, allowing rounding (a fact of
    1.83 backs "1.8" and "2"). Small counts (0-10) are always allowed: they
    are how prose says "two shelters" or "3 roads"."""
    allowed = [float(n) for n in _numbers(json.dumps(facts, ensure_ascii=False))]
    unsupported = []
    for token in _numbers(text):
        value = float(token)
        if value.is_integer() and 0 <= value <= 10:
            continue
        decimals = len(token.split(".")[1]) if "." in token else 0
        if not any(abs(round(a, decimals) - value) < 1e-9 or abs(abs(a) - value) < 1e-9 for a in allowed):
            unsupported.append(token)
    return unsupported


def build_briefing(request: BriefingRequest, scenario: ScenarioConfig) -> dict:
    effective = apply_overrides(scenario, request.closed_edge_ids, request.unavailable_shelter_ids)
    seed = request.random_seed if request.random_seed is not None else scenario.default_params.random_seed

    alternative = plan = None
    if request.include_plan:
        plan = generate_alternative_plan(OptimizationRequest(
            scenario_id=scenario.id, random_seed=seed,
            closed_edge_ids=request.closed_edge_ids, unavailable_shelter_ids=request.unavailable_shelter_ids,
        ))
        baseline = RunResult.model_validate(plan["baselineRun"])
        alternative = RunResult.model_validate(plan["alternativeRun"])
    else:
        baseline = run_simulation(RunRequest(
            scenario_id=scenario.id, params=scenario.default_params.model_copy(update={"random_seed": seed}),
            closed_edge_ids=request.closed_edge_ids, unavailable_shelter_ids=request.unavailable_shelter_ids,
        ))

    facts = briefing_facts(effective, baseline, alternative, plan)
    template = template_briefing(facts)
    warnings: list[str] = []
    try:
        text = complete_text(
            SYSTEM_PROMPT,
            f"<run_results>\n{json.dumps(facts, indent=2, ensure_ascii=False)}\n</run_results>\n\nWrite the briefing.",
        )
    except AIUnavailable as exc:
        return {"source": "template", "text": template, "facts": facts, "warnings": [f"{exc} Showing the standard summary."]}

    bad = unsupported_numbers(text, facts)
    if bad:
        warnings.append(
            f"Gemini's briefing contained numbers not found in the run ({', '.join(bad[:5])}), "
            "so it was discarded for the standard summary."
        )
        return {"source": "template", "text": template, "facts": facts, "warnings": warnings}
    return {"source": "gemini", "text": text, "facts": facts, "warnings": warnings}
