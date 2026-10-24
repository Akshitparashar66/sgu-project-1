import random
from itertools import islice

import networkx as nx
import pytest

from app.models.schemas import AgentPlan
from app.routing.assignment import assign_shelters_and_routes, build_demand_units
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph
from app.services.scenario_overrides import apply_overrides
from app.services.scenario_store import list_scenarios
from app.simulation.cohort import simulate_plans_fast
from app.simulation.engine import simulate

SCENARIOS = list_scenarios()


def _with_floods_and_slow_doors(scenario, rng: random.Random):
    """Some roads flood mid-run and some shelters open late or admit slowly."""
    s = scenario.model_copy(deep=True)
    for e in s.edges:
        if rng.random() < 0.3:
            e.closes_at_tick = rng.randrange(0, 60)
    for sh in s.shelters:
        if rng.random() < 0.5:
            sh.opens_at_tick = rng.randrange(0, 40)
        if rng.random() < 0.5:
            sh.intake_per_tick = rng.randrange(5, 120)
    return s


def _engine_metrics(scenario, plans):
    params = scenario.default_params
    run = simulate(scenario, plans, params, CongestionModel(scenario, params), plan_label="t")
    m = run.metrics
    arrived = [a.arrival_tick for a in run.agents if a.arrival_tick is not None]
    return {
        "evacuated": m.evacuated_count, "unserved": m.unserved_count, "completion_tick": m.completion_tick,
        "hit_tick_limit": m.hit_tick_limit, "max_congestion_ratio": m.max_congestion_ratio,
        "rejected": sum(s.rejected_count for s in run.shelters),
        "cut_off": sum(1 for w in run.warnings if "cut off" in w) and sum(
            int(w.split()[0]) for w in run.warnings if "cut off" in w),
        "mean_arrival_tick": sum(arrived) / len(arrived) if arrived else 0.0,
    }


def _fast_metrics(scenario, plans):
    m = simulate_plans_fast(scenario, plans, scenario.default_params)
    return {
        "evacuated": m.evacuated, "unserved": m.unserved, "completion_tick": m.completion_tick,
        "hit_tick_limit": m.hit_tick_limit, "max_congestion_ratio": m.max_congestion_ratio,
        "rejected": m.rejected, "mean_arrival_tick": m.mean_arrival_tick, "cut_off": m.cut_off,
    }


def _random_plans(scenario, rng: random.Random) -> list[AgentPlan]:
    """Any shelter (even an overfilled one), any of the 3 shortest open
    routes, random departure: harsher than any real plan."""
    graph = build_graph(scenario)
    edge_at = lambda u, v: graph[u][v]["edge_id"]  # noqa: E731
    options = {}
    for zone in scenario.zones:
        for shelter in scenario.shelters:
            try:
                paths = list(islice(nx.shortest_simple_paths(graph, zone.connector_node, shelter.connector_node, weight="weight"), 3))
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                paths = []
            options[zone.id, shelter.id] = [[edge_at(u, v) for u, v in zip(p, p[1:])] for p in paths]

    plans = []
    for i, (zone, profile) in enumerate(build_demand_units(scenario, rng.randrange(1000))):
        shelter = rng.choice(scenario.shelters)
        routes = options[zone.id, shelter.id]
        route = rng.choice(routes) if routes and rng.random() > 0.02 else []
        plans.append(AgentPlan(agent_id=f"a{i}", origin_zone=zone.id, assigned_shelter=shelter.id if route else None,
                               route_edge_ids=route, movement_profile=profile,
                               departure_tick=rng.choice([0, 0, 3, 10, 25])))
    return plans


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.id)
def test_cohort_simulation_matches_the_engine_on_the_baseline_plan(scenario):
    plans = assign_shelters_and_routes(scenario, build_graph(scenario), scenario.default_params.random_seed)
    assert _fast_metrics(scenario, plans) == _engine_metrics(scenario, plans)


@pytest.mark.parametrize("seed", range(6))
def test_cohort_simulation_matches_the_engine_on_random_plans(seed):
    rng = random.Random(seed)
    scenario = SCENARIOS[seed % len(SCENARIOS)]
    plans = _random_plans(scenario, rng)
    assert _fast_metrics(scenario, plans) == _engine_metrics(scenario, plans)


def test_staged_departure_waits_at_the_zone_until_its_tick():
    scenario = SCENARIOS[0]
    plans = assign_shelters_and_routes(scenario, build_graph(scenario), 42)[:5]
    late = [p.model_copy(update={"departure_tick": 12}) for p in plans]
    params = scenario.default_params
    run = simulate(scenario, late, params, CongestionModel(scenario, params), plan_label="t")
    assert all(a.edge_entry_ticks[0] == 12 and a.departure_tick == 12 for a in run.agents)


@pytest.mark.parametrize("seed", range(8))
def test_cohort_simulation_matches_the_engine_with_flooding_roads_and_slow_shelter_doors(seed):
    rng = random.Random(100 + seed)
    scenario = _with_floods_and_slow_doors(SCENARIOS[seed % len(SCENARIOS)], rng)
    plans = _random_plans(scenario, rng)
    assert _fast_metrics(scenario, plans) == _engine_metrics(scenario, plans)


@pytest.mark.parametrize("seed", range(6))
def test_cohort_simulation_matches_the_engine_with_roads_at_reduced_capacity(seed):
    """Live traffic arrives as a capacity factor per road (the Scenario Lab what-if)."""
    rng = random.Random(200 + seed)
    base = SCENARIOS[seed % len(SCENARIOS)]
    factors = {e.id: rng.choice([0.25, 0.5, 0.75]) for e in base.edges if rng.random() < 0.4}
    scenario = apply_overrides(base, edge_capacity_factors=factors)
    plans = _random_plans(scenario, rng)
    assert _fast_metrics(scenario, plans) == _engine_metrics(scenario, plans)


def test_people_re_route_round_a_flooded_road_and_are_cut_off_when_there_is_none():
    scenario = get_scenario_copy("scenario_a_normal")
    for e in scenario.edges:
        if e.id == "E3":
            e.closes_at_tick = 0  # the Gaur Cascades link floods at once
    params = scenario.default_params
    plans = assign_shelters_and_routes(scenario, build_graph(scenario), 42)  # planned before the flood
    run = simulate(scenario, plans, params, CongestionModel(scenario, params), plan_label="t")
    assert not any("E3" in a.route_edge_ids for a in run.agents)
    assert run.metrics.unserved_count == 0

    for e in scenario.edges:
        e.closes_at_tick = 0  # every road floods: nobody can leave
    run = simulate(scenario, plans, params, CongestionModel(scenario, params), plan_label="t")
    assert run.metrics.evacuated_count == 0
    assert any("cut off" in w for w in run.warnings)


def test_a_shelter_that_opens_late_keeps_arrivals_waiting_at_the_door():
    scenario = get_scenario_copy("scenario_a_normal")
    for sh in scenario.shelters:
        sh.opens_at_tick = 150
        sh.intake_per_tick = 50
    params = scenario.default_params
    plans = assign_shelters_and_routes(scenario, build_graph(scenario), 42)
    run = simulate(scenario, plans, params, CongestionModel(scenario, params), plan_label="t")
    arrivals = sorted(a.arrival_tick for a in run.agents if a.arrival_tick is not None)
    assert arrivals[0] == 150
    # 3 shelters x 50 a tick: no tick admits more than 150.
    assert max(arrivals.count(t) for t in set(arrivals)) <= 150


def get_scenario_copy(scenario_id):
    from app.services.scenario_store import get_scenario
    return get_scenario(scenario_id).model_copy(deep=True)
