import pytest

from app.optimization.planner import OptimizationRequest, generate_alternative_plan
from app.optimization.search import make_blocks, optimize_plan
from app.routing.congestion import CongestionModel
from app.routing.graph import build_graph
from app.services.scenario_store import get_scenario
from app.simulation.engine import simulate


@pytest.fixture(scope="module")
def flood_plan():
    return generate_alternative_plan(OptimizationRequest(scenario_id="scenario_d_hindon_flood"))


def test_optimizer_houses_the_flood_evacuees_the_baseline_runs_out_of_time_for(flood_plan):
    base, alt = flood_plan["baselineRun"]["metrics"], flood_plan["alternativeRun"]["metrics"]
    assert flood_plan["feasible"] is True
    assert base["unservedCount"] == 50 and base["hitTickLimit"] is True
    assert alt["unservedCount"] == 0 and alt["completionTick"] is not None


def test_orders_account_for_every_evacuee_and_match_the_run(flood_plan):
    agents = flood_plan["alternativeRun"]["agents"]
    assert sum(o["people"] for o in flood_plan["orders"]) == len(agents) == 1700
    by_order = {}
    for a in agents:
        key = (a["originZone"], a["movementProfile"], a["assignedShelter"], tuple(a["routeEdgeIds"]),
               a["departureTick"] * 30 / 60)
        by_order[key] = by_order.get(key, 0) + 1
    assert by_order == {(o["zoneId"], o["movementProfile"], o["shelterId"], tuple(o["routeEdgeIds"]),
                         o["departureMinute"]): o["people"] for o in flood_plan["orders"]}


def test_the_engine_confirms_the_search_prediction_exactly():
    scenario = get_scenario("scenario_b_bridge_closure")
    params = scenario.default_params
    result = optimize_plan(scenario, build_graph(scenario), params, 42)
    run = simulate(scenario, result.plans, params, CongestionModel(scenario, params), plan_label="alternative")
    assert run.metrics.unserved_count == result.predicted.unserved
    assert run.metrics.completion_tick == result.predicted.completion_tick
    assert run.metrics.max_congestion_ratio == result.predicted.max_congestion_ratio


def test_same_seed_gives_the_same_plan():
    scenario = get_scenario("scenario_a_normal")
    graph, params = build_graph(scenario), scenario.default_params
    assert optimize_plan(scenario, graph, params, 7).orders == optimize_plan(scenario, graph, params, 7).orders


def test_staged_departures_respect_the_wave_schedule():
    plan = generate_alternative_plan(OptimizationRequest(scenario_id="scenario_a_normal"))
    minutes = {o["departureMinute"] for o in plan["orders"]}
    assert minutes <= {0, 5, 10, 15, 20, 25, 30}
    assert any("clearance time" in t for t in plan["tradeOffs"])


def test_capacity_repair_keeps_unserved_at_the_shelter_capacity_limit():
    # Compound failure: 1,500 evacuees, 1,450 shelter places. Coarse blocks
    # must not turn away anyone a per-person plan could house.
    plan = generate_alternative_plan(OptimizationRequest(scenario_id="scenario_f_compound_failure", random_seed=7))
    assert plan["alternativeRun"]["metrics"]["unservedCount"] == 50


def test_blocks_split_each_group_into_near_equal_parts():
    blocks, size = make_blocks({("Z1", "standard"): 130, ("Z1", "reduced_mobility"): 9})
    assert size == 10
    assert sorted(b.count for b in blocks if b.movement_profile == "standard") == [10] * 13
    assert [b.count for b in blocks if b.movement_profile == "reduced_mobility"] == [9]
