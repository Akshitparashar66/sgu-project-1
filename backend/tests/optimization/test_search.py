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
    assert base["unservedCount"] == 118 and base["hitTickLimit"] is True
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
    # Compound failure without its standby hall: 1,500 evacuees, 1,450 places.
    # Coarse blocks must not turn away anyone a per-person plan could house.
    scenario = get_scenario("scenario_f_compound_failure").model_copy(deep=True)
    scenario.shelters = [s for s in scenario.shelters if not s.standby]
    result = optimize_plan(scenario, build_graph(scenario), scenario.default_params, 7)
    assert result.predicted.unserved == 50


def test_the_optimizer_opens_the_standby_hall_when_places_run_short():
    # Shelter shortage: 220 people have no place unless the standby hall is opened.
    plan = generate_alternative_plan(OptimizationRequest(scenario_id="scenario_c_shelter_shortage"))
    assert plan["baselineRun"]["metrics"]["unservedCount"] == 220
    assert plan["interventions"]["openedShelters"][0]["shelterId"] == "S4"
    assert plan["alternativeRun"]["metrics"]["unservedCount"] == 0
    assert any("opens standby shelter" in t for t in plan["tradeOffs"])


def test_marshals_raise_a_roads_intake_and_never_exceed_the_teams_available():
    from app.optimization.search import MARSHAL_CAPACITY_FACTOR, Levers, apply_levers

    scenario = get_scenario("scenario_a_normal")
    marshalled = apply_levers(scenario, Levers(marshals=frozenset({"E4"})))
    before = next(e for e in scenario.edges if e.id == "E4").capacity_per_tick
    assert next(e for e in marshalled.edges if e.id == "E4").capacity_per_tick == round(before * MARSHAL_CAPACITY_FACTOR)
    for scenario in (get_scenario("scenario_e_night_vulnerable"), get_scenario("scenario_b_bridge_closure")):
        result = optimize_plan(scenario, build_graph(scenario), scenario.default_params, 42)
        assert len(result.levers.marshals) <= scenario.marshal_teams


def test_blocks_split_each_group_into_near_equal_parts():
    blocks, size = make_blocks({("Z1", "standard"): 130, ("Z1", "reduced_mobility"): 9})
    assert size == 10
    assert sorted(b.count for b in blocks if b.movement_profile == "standard") == [10] * 13
    assert [b.count for b in blocks if b.movement_profile == "reduced_mobility"] == [9]


def test_robustness_reports_paired_ranges_for_both_plans(flood_plan):
    r = flood_plan["robustness"]
    assert r["variations"] == 40 and r["assumptions"]
    for plan in ("baseline", "optimized"):
        clearance = r[plan]["clearanceMinutes"]
        assert clearance["p10"] <= clearance["p50"] <= clearance["p90"]
    assert 0 <= r["optimizedBetter"] <= 40
    # The flood plan's advantage should survive realistic variation, not just the one nominal run.
    assert r["optimizedBetter"] >= 30


def test_no_plan_beats_the_clearance_lower_bound():
    from app.optimization.bounds import clearance_lower_bound
    from app.services.scenario_store import list_scenarios

    for scenario in list_scenarios():
        params = scenario.default_params
        bound = clearance_lower_bound(scenario, params)
        result = optimize_plan(scenario, build_graph(scenario), params, 42)
        assert bound is not None and result.predicted.completion_tick >= bound, scenario.id


def test_flood_plan_reports_the_lower_bound(flood_plan):
    assert flood_plan["search"]["clearanceLowerBoundMinutes"] == 33.5
