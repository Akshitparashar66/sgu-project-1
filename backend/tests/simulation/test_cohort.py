import random
from itertools import islice

import networkx as nx
import pytest

from app.models.schemas import AgentPlan
from app.routing.assignment import assign_shelters_and_routes, build_demand_units
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph
from app.services.scenario_store import list_scenarios
from app.simulation.cohort import simulate_plans_fast
from app.simulation.engine import simulate

SCENARIOS = list_scenarios()


def _engine_metrics(scenario, plans):
    params = scenario.default_params
    run = simulate(scenario, plans, params, CongestionModel(scenario, params), plan_label="t")
    m = run.metrics
    arrived = [a.arrival_tick for a in run.agents if a.arrival_tick is not None]
    return {
        "evacuated": m.evacuated_count, "unserved": m.unserved_count, "completion_tick": m.completion_tick,
        "hit_tick_limit": m.hit_tick_limit, "max_congestion_ratio": m.max_congestion_ratio,
        "rejected": sum(s.rejected_count for s in run.shelters),
        "mean_arrival_tick": sum(arrived) / len(arrived) if arrived else 0.0,
    }


def _fast_metrics(scenario, plans):
    m = simulate_plans_fast(scenario, plans, scenario.default_params)
    return {
        "evacuated": m.evacuated, "unserved": m.unserved, "completion_tick": m.completion_tick,
        "hit_tick_limit": m.hit_tick_limit, "max_congestion_ratio": m.max_congestion_ratio,
        "rejected": m.rejected, "mean_arrival_tick": m.mean_arrival_tick,
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
