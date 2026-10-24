from __future__ import annotations

import random
from dataclasses import replace

from app.models.schemas import AgentPlan, ScenarioConfig, SimulationParams
from app.optimization.search import mean_hazard_ticks, plan_score
from app.simulation.cohort import Cohort, CohortMetrics, cohorts_from_plans, simulate_cohorts

VARIATIONS = 40
# What varies between runs. Ranges are judgement calls, not measured
# distributions; they are shown to the user with the results.
WALKING_SPEED = (0.85, 1.15)  # x free walking speed
ROAD_CAPACITY = (0.8, 1.1)  # x people per tick a road lets in
REACTION_TICKS = (0, 4)  # each group starts 0-2 min after its planned time
EARLY_LEAVERS = 0.10  # share of a later wave that leaves at once anyway
ASSUMPTIONS = [
    "walking speed ±15%",
    "road capacity −20% to +10%",
    "each group reacts 0–2 min late",
    "10% of each later wave leaves at once instead of waiting",
]


def _vary_scenario(scenario: ScenarioConfig, speed: float, capacity: float) -> ScenarioConfig:
    varied = scenario.model_copy(deep=True)
    for e in varied.edges:
        e.base_travel_time_s /= speed
        e.capacity_per_tick = max(1, round(e.capacity_per_tick * capacity))
    return varied


def _vary_departures(cohorts: list[Cohort], rng: random.Random) -> list[Cohort]:
    out = []
    for c in cohorts:
        delay = rng.randint(*REACTION_TICKS)
        early = round(c.count * EARLY_LEAVERS) if c.departure_tick > 0 else 0
        if early:
            out.append(replace(c, departure_tick=rng.randint(*REACTION_TICKS), count=early))
        out.append(replace(c, departure_tick=c.departure_tick + delay, count=c.count - early))
    return out


def _percentiles(values: list[float]) -> dict[str, float]:
    ordered = sorted(values)

    def at(q: float) -> float:
        return round(ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))], 1)

    return {"p10": at(0.1), "p50": at(0.5), "p90": at(0.9)}


def plan_robustness(scenario: ScenarioConfig, baseline: list[AgentPlan], optimized: list[AgentPlan],
                    params: SimulationParams, random_seed: int, optimized_scenario: ScenarioConfig | None = None,
                    optimized_cost: float = 0.0) -> dict:
    """Re-run both plans under the same random variations (paired, so the
    comparison is fair) and report 10th-90th percentile ranges, and how
    often the optimized plan still beats the baseline. Uses the cohort
    simulation, which gives exactly the engine's numbers. The optimized plan
    runs on `optimized_scenario` (its opened shelters and marshals applied)
    and carries `optimized_cost` (those interventions' score cost)."""
    rng = random.Random(random_seed)
    tick_minutes = params.tick_seconds / 60
    worlds = {"baseline": scenario, "optimized": optimized_scenario or scenario}
    extra = {"baseline": 0.0, "optimized": optimized_cost}
    plans = {"baseline": cohorts_from_plans(baseline, scenario), "optimized": cohorts_from_plans(optimized, worlds["optimized"])}
    samples: dict[str, list[tuple[CohortMetrics, float]]] = {name: [] for name in plans}

    for _ in range(VARIATIONS):
        speed, capacity = rng.uniform(*WALKING_SPEED), rng.uniform(*ROAD_CAPACITY)
        state = rng.getstate()
        for name, (cohorts, unassigned) in plans.items():
            varied = _vary_scenario(worlds[name], speed, capacity)
            rng.setstate(state)  # both plans draw their reaction delays from the same random stream
            groups = _vary_departures(cohorts, rng)
            m = simulate_cohorts(varied, groups, params, unassigned)
            hazard = mean_hazard_ticks(varied, [(c.route_edge_ids, c.count) for c in groups], params.tick_seconds)
            score = plan_score(m.unserved, m.completion_tick, m.mean_arrival_tick, m.max_congestion_ratio,
                               params.max_ticks, hazard) + extra[name]
            samples[name].append((m, score))

    def summary(runs: list[tuple[CohortMetrics, float]]) -> dict:
        metrics = [m for m, _ in runs]
        return {
            "clearanceMinutes": _percentiles([(m.completion_tick if m.completion_tick is not None else params.max_ticks)
                                              * tick_minutes for m in metrics]),
            "unserved": _percentiles([m.unserved for m in metrics]),
            "averageMinutes": _percentiles([m.mean_arrival_tick * tick_minutes for m in metrics]),
            "hitTimeLimit": sum(m.hit_tick_limit for m in metrics),
        }

    better = sum(o[1] < b[1] for b, o in zip(samples["baseline"], samples["optimized"]))
    return {
        "variations": VARIATIONS,
        "assumptions": ASSUMPTIONS,
        "baseline": summary(samples["baseline"]),
        "optimized": summary(samples["optimized"]),
        "optimizedBetter": better,
    }
