# AEGIS — Member 6: QA, Metrics & Pitch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`.
> **Recommended tool:** Claude Code for the test suite; the pitch deck is a
> presentation artifact, built separately once the demo works.

**Goal:** The two derived fixture scenarios (B, C), the acceptance-test
suite that proves all three scenarios behave as the PRD claims they must
(§13.6, §20), the README/ASSUMPTIONS docs, and a rehearsed demo script
with a recorded fallback.

**Architecture:** Fixture scenarios are Scenario A with exactly one field
changed (master plan §4) — tests assert *only that one field differs*,
so a future edit to Scenario A doesn't silently desync B/C without a test
failing. Acceptance tests hit the real FastAPI app via `TestClient`
end-to-end (no mocking) because this workstream's entire purpose is
catching integration problems the other five plans' unit tests can't see.

**Tech Stack:** Python 3.11+, pytest, `fastapi.testclient.TestClient`.

**Spec:** `2026-10-23-aegis-master-plan.md` §4 (Scenario A fixture) in
this folder. PRD §11 (Data and Scenario Design), §13.6 (Definition of
Done), §16 (Demo and Pitch), §20 (Final Acceptance Checklist).

## Global Constraints

- Every acceptance test exercises the real API (`TestClient(app)`), not
  the individual service functions in isolation — those are covered by
  Members 1/2/5's own unit tests already.
- The demo script never depends on a feature that isn't actually merged
  and passing — if a P1 item (e.g. animated replay) isn't done by Hour 23,
  it's cut from the script, not faked.
- README and ASSUMPTIONS must state the prototype/synthetic-data
  limitation explicitly (PRD Global Principle #8, §1.4 Non-Goals) —
  this is a checklist item, not a suggestion.

---

### Task 1: Scenario B and C fixtures

**Files:**
- Create: `data/scenarios/scenario_b_bridge_closure.json`
- Create: `data/scenarios/scenario_c_shelter_shortage.json`
- Test: `backend/tests/services/test_scenario_fixtures.py`

**Interfaces:**
- Consumes: `data/scenarios/scenario_a_normal.json` (master plan §4),
  `ScenarioConfig`, `RoadStatus` from `app.models.schemas`.
- Produces: the two JSON files — Member 6's own acceptance tests (Task 2)
  and Member 1/2's "sanity check" checklist items both load these by id.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/services/test_scenario_fixtures.py
from pathlib import Path

from app.models.schemas import RoadStatus, ScenarioConfig

SCENARIOS_DIR = Path(__file__).resolve().parents[3] / "data" / "scenarios"


def _load(scenario_id: str) -> ScenarioConfig:
    return ScenarioConfig.model_validate_json((SCENARIOS_DIR / f"{scenario_id}.json").read_text())


def test_scenario_a_is_fully_open_and_all_shelters_available():
    scenario = _load("scenario_a_normal")
    assert all(e.status == RoadStatus.OPEN for e in scenario.edges)
    assert all(s.available for s in scenario.shelters)


def test_scenario_b_closes_exactly_the_critical_bridge_and_nothing_else():
    scenario = _load("scenario_b_bridge_closure")
    closed_ids = [e.id for e in scenario.edges if e.status == RoadStatus.CLOSED]
    assert closed_ids == ["E3"]

    a_edges = {e.id: e.status for e in _load("scenario_a_normal").edges if e.id != "E3"}
    b_edges = {e.id: e.status for e in scenario.edges if e.id != "E3"}
    assert a_edges == b_edges


def test_scenario_c_shrinks_exactly_one_shelter_and_nothing_else():
    scenario = _load("scenario_c_shelter_shortage")
    s1 = next(s for s in scenario.shelters if s.id == "S1")
    assert s1.total_capacity == 30

    a_shelters = {s.id: s.total_capacity for s in _load("scenario_a_normal").shelters if s.id != "S1"}
    c_shelters = {s.id: s.total_capacity for s in scenario.shelters if s.id != "S1"}
    assert a_shelters == c_shelters

    a_edges = [e.status for e in _load("scenario_a_normal").edges]
    c_edges = [e.status for e in scenario.edges]
    assert a_edges == c_edges  # Scenario C changes ONLY shelter capacity, not roads
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/services/test_scenario_fixtures.py -v`
Expected: `FileNotFoundError` — the two JSON files don't exist yet

- [ ] **Step 3: Create the fixtures**

```json
// data/scenarios/scenario_b_bridge_closure.json
{
  "id": "scenario_b_bridge_closure",
  "name": "Critical Bridge Closure",
  "description": "Scenario A with the N3-N4 bridge (E3) closed — the only route from the hazard-adjacent junction to Shelter S1.",
  "synthetic": true,
  "nodes": [
    { "id": "N1", "lat": 16.700, "lon": 74.230, "label": "Zone A connector" },
    { "id": "N2", "lat": 16.705, "lon": 74.235, "label": "Central junction" },
    { "id": "N3", "lat": 16.710, "lon": 74.240, "label": "Hazard-adjacent junction" },
    { "id": "N4", "lat": 16.715, "lon": 74.245, "label": "Shelter S1 connector" },
    { "id": "N5", "lat": 16.702, "lon": 74.242, "label": "Shelter S3 connector" },
    { "id": "N6", "lat": 16.720, "lon": 74.250, "label": "Shelter S2 connector" }
  ],
  "edges": [
    { "id": "E1", "source": "N1", "target": "N2", "length_m": 900,  "capacity_per_tick": 40, "base_travel_time_s": 90,  "status": "open",   "hazard_risk": 0.0 },
    { "id": "E2", "source": "N2", "target": "N3", "length_m": 700,  "capacity_per_tick": 35, "base_travel_time_s": 70,  "status": "open",   "hazard_risk": 0.2 },
    { "id": "E3", "source": "N3", "target": "N4", "length_m": 500,  "capacity_per_tick": 20, "base_travel_time_s": 60,  "status": "closed", "hazard_risk": 0.1 },
    { "id": "E4", "source": "N2", "target": "N5", "length_m": 600,  "capacity_per_tick": 30, "base_travel_time_s": 65,  "status": "open",   "hazard_risk": 0.0 },
    { "id": "E5", "source": "N5", "target": "N6", "length_m": 1100, "capacity_per_tick": 25, "base_travel_time_s": 100, "status": "open",   "hazard_risk": 0.0 },
    { "id": "E6", "source": "N4", "target": "N6", "length_m": 800,  "capacity_per_tick": 20, "base_travel_time_s": 85,  "status": "open",   "hazard_risk": 0.0 },
    { "id": "E7", "source": "N1", "target": "N5", "length_m": 1000, "capacity_per_tick": 30, "base_travel_time_s": 95,  "status": "open",   "hazard_risk": 0.0 }
  ],
  "zones": [
    { "id": "Z1", "name": "Riverside Colony", "connector_node": "N1", "evacuee_count": 300, "movement_profile": { "standard": 0.8, "reduced_mobility": 0.2 } },
    { "id": "Z2", "name": "Market Ward",     "connector_node": "N2", "evacuee_count": 450, "movement_profile": { "standard": 0.85, "reduced_mobility": 0.15 } }
  ],
  "shelters": [
    { "id": "S1", "name": "Highland School", "connector_node": "N4", "total_capacity": 250, "occupied": 0, "available": true },
    { "id": "S2", "name": "Community Hall",  "connector_node": "N6", "total_capacity": 300, "occupied": 0, "available": true },
    { "id": "S3", "name": "Sports Complex",  "connector_node": "N5", "total_capacity": 200, "occupied": 0, "available": true }
  ],
  "hazards": [
    { "id": "H1", "polygon": [[16.708, 74.238], [16.712, 74.238], [16.712, 74.243], [16.708, 74.243]], "severity": 0.6, "start_tick": 0, "end_tick": null }
  ],
  "default_params": { "tick_seconds": 30, "max_ticks": 240, "random_seed": 42 }
}
```

```json
// data/scenarios/scenario_c_shelter_shortage.json
{
  "id": "scenario_c_shelter_shortage",
  "name": "Shelter Capacity Shortage",
  "description": "Scenario A with Shelter S1's capacity cut from 250 to 30 (e.g. a structural inspection failure) — roads are unaffected.",
  "synthetic": true,
  "nodes": [
    { "id": "N1", "lat": 16.700, "lon": 74.230, "label": "Zone A connector" },
    { "id": "N2", "lat": 16.705, "lon": 74.235, "label": "Central junction" },
    { "id": "N3", "lat": 16.710, "lon": 74.240, "label": "Hazard-adjacent junction" },
    { "id": "N4", "lat": 16.715, "lon": 74.245, "label": "Shelter S1 connector" },
    { "id": "N5", "lat": 16.702, "lon": 74.242, "label": "Shelter S3 connector" },
    { "id": "N6", "lat": 16.720, "lon": 74.250, "label": "Shelter S2 connector" }
  ],
  "edges": [
    { "id": "E1", "source": "N1", "target": "N2", "length_m": 900,  "capacity_per_tick": 40, "base_travel_time_s": 90,  "status": "open", "hazard_risk": 0.0 },
    { "id": "E2", "source": "N2", "target": "N3", "length_m": 700,  "capacity_per_tick": 35, "base_travel_time_s": 70,  "status": "open", "hazard_risk": 0.2 },
    { "id": "E3", "source": "N3", "target": "N4", "length_m": 500,  "capacity_per_tick": 20, "base_travel_time_s": 60,  "status": "open", "hazard_risk": 0.1 },
    { "id": "E4", "source": "N2", "target": "N5", "length_m": 600,  "capacity_per_tick": 30, "base_travel_time_s": 65,  "status": "open", "hazard_risk": 0.0 },
    { "id": "E5", "source": "N5", "target": "N6", "length_m": 1100, "capacity_per_tick": 25, "base_travel_time_s": 100, "status": "open", "hazard_risk": 0.0 },
    { "id": "E6", "source": "N4", "target": "N6", "length_m": 800,  "capacity_per_tick": 20, "base_travel_time_s": 85,  "status": "open", "hazard_risk": 0.0 },
    { "id": "E7", "source": "N1", "target": "N5", "length_m": 1000, "capacity_per_tick": 30, "base_travel_time_s": 95,  "status": "open", "hazard_risk": 0.0 }
  ],
  "zones": [
    { "id": "Z1", "name": "Riverside Colony", "connector_node": "N1", "evacuee_count": 300, "movement_profile": { "standard": 0.8, "reduced_mobility": 0.2 } },
    { "id": "Z2", "name": "Market Ward",     "connector_node": "N2", "evacuee_count": 450, "movement_profile": { "standard": 0.85, "reduced_mobility": 0.15 } }
  ],
  "shelters": [
    { "id": "S1", "name": "Highland School", "connector_node": "N4", "total_capacity": 30,  "occupied": 0, "available": true },
    { "id": "S2", "name": "Community Hall",  "connector_node": "N6", "total_capacity": 300, "occupied": 0, "available": true },
    { "id": "S3", "name": "Sports Complex",  "connector_node": "N5", "total_capacity": 200, "occupied": 0, "available": true }
  ],
  "hazards": [
    { "id": "H1", "polygon": [[16.708, 74.238], [16.712, 74.238], [16.712, 74.243], [16.708, 74.243]], "severity": 0.6, "start_tick": 0, "end_tick": null }
  ],
  "default_params": { "tick_seconds": 30, "max_ticks": 240, "random_seed": 42 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/services/test_scenario_fixtures.py -v`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add data/scenarios/scenario_b_bridge_closure.json data/scenarios/scenario_c_shelter_shortage.json backend/tests/services/test_scenario_fixtures.py
git commit -m "test(fixtures): Scenario B (bridge closure) and C (shelter shortage), each a single-field diff from A"
```

---

### Task 2: End-to-end acceptance tests (PRD §13.6, §20)

**Files:**
- Create: `backend/tests/acceptance/test_scenarios.py`

**Interfaces:**
- Consumes: `app` (FastAPI instance) from `app.main` — Member 5's Task 2.
  **This task cannot start until Member 5's Task 2 is merged.** If
  you're blocked, use the wait productively on Task 3 (README/
  ASSUMPTIONS) and Task 4 (demo script) below, which don't depend on the
  live app.

- [ ] **Step 1: Write the test (this IS the deliverable — these ARE the acceptance criteria, not a draft of them)**

```python
# backend/tests/acceptance/test_scenarios.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _run(scenario_id: str) -> dict:
    response = client.post("/api/simulations/run", json={"scenarioId": scenario_id})
    assert response.status_code == 200, response.text
    return response.json()


def test_scenario_a_normal_evacuates_everyone_capacity_allows():
    result = _run("scenario_a_normal")
    # 750 total evacuees (300 + 450), 750 total shelter capacity (250+300+200), all roads open.
    assert result["metrics"]["evacuatedCount"] + result["metrics"]["unservedCount"] == 750
    assert result["metrics"]["unservedCount"] == 0


def test_scenario_b_bridge_closure_produces_at_least_as_many_unserved_as_normal():
    normal = _run("scenario_a_normal")
    closed = _run("scenario_b_bridge_closure")
    assert closed["metrics"]["unservedCount"] >= normal["metrics"]["unservedCount"]

    s1_normal = next(s for s in normal["shelters"] if s["shelterId"] == "S1")
    s1_closed = next(s for s in closed["shelters"] if s["shelterId"] == "S1")
    assert s1_closed["finalOccupied"] <= s1_normal["finalOccupied"]


def test_scenario_c_shelter_shortage_rejects_agents_at_the_shrunk_shelter():
    result = _run("scenario_c_shelter_shortage")
    s1 = next(s for s in result["shelters"] if s["shelterId"] == "S1")
    assert s1["totalCapacity"] == 30
    assert s1["finalOccupied"] <= 30
    assert result["metrics"]["unservedCount"] > 0


def test_alternative_plan_is_never_worse_and_is_honest_when_no_improvement_exists():
    for scenario_id in ("scenario_a_normal", "scenario_b_bridge_closure", "scenario_c_shelter_shortage"):
        response = client.post("/api/optimization/plan", json={"scenarioId": scenario_id})
        assert response.status_code == 200, response.text
        body = response.json()
        assert isinstance(body["feasible"], bool)
        if body["feasible"]:
            assert body["alternativeRun"]["metrics"]["unservedCount"] <= body["baselineRun"]["metrics"]["unservedCount"]
        else:
            assert body.get("reason")


def test_closed_road_never_appears_in_any_agents_route_in_scenario_b():
    result = _run("scenario_b_bridge_closure")
    for agent in result["agents"]:
        assert "E3" not in agent["routeEdgeIds"]


def test_shelter_occupied_never_exceeds_capacity_in_any_scenario():
    for scenario_id in ("scenario_a_normal", "scenario_b_bridge_closure", "scenario_c_shelter_shortage"):
        result = _run(scenario_id)
        for shelter in result["shelters"]:
            assert shelter["finalOccupied"] <= shelter["totalCapacity"]
```

- [ ] **Step 2: Run and confirm every test passes against the real, merged system**

Run: `cd backend && python -m pytest tests/acceptance/ -v`
Expected: `6 passed`. If `test_scenario_c_shelter_shortage_rejects_agents_at_the_shrunk_shelter`
fails because `unservedCount == 0`, that means Member 2's assignment is
successfully re-routing all the Zone-adjacent demand to S2/S3 instead —
check whether that's actually correct given S2/S3's combined spare
capacity (500) comfortably covers the 220-person shortfall from S1's cut;
if so, fix the test's assumption, not the engine (PRD Global Principle #2:
never weaken a correctness check to make a number match an assumption —
but DO fix an assumption that turns out to be arithmetically wrong).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/acceptance/test_scenarios.py
git commit -m "test(acceptance): end-to-end proof of PRD §13.6 items 4-8 across all three scenarios"
```

---

### Task 3: README and ASSUMPTIONS

**Files:**
- Create: `README.md`
- Create: `docs/ASSUMPTIONS.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# AEGIS — Adaptive Emergency Guidance & Intelligence System

Simulate the risk. Engineer the escape.

AEGIS is a prototype evacuation-planning and simulation tool (PS 021).
It is **not** a real emergency-response system — see "What this is not"
below.

## Setup

**Backend** (Python 3.11+):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend** (Node 18+):
```bash
cd frontend
npm install
npm run dev  # http://localhost:3000
```

**Run the test suite:**
```bash
cd backend && python -m pytest
cd frontend && npx vitest run
```

## What this is

- A road-graph + agent-based evacuation simulator (Dijkstra routing,
  capacity-based congestion, shelter-capacity enforcement).
- A rule-based (not machine-learned) alternative-plan optimizer that
  load-balances shelter assignment and reports honestly when it can't
  improve on the baseline.
- Three synthetic demo scenarios: normal conditions, a closed critical
  bridge, and a shelter capacity shortage.

## What this is not

- **Not a live emergency-response system.** It does not issue real
  evacuation instructions and must never be used that way.
- **Not validated against real human behavior.** Movement speeds,
  congestion penalties and the optimizer's heuristic are documented,
  simplified models — see `docs/ASSUMPTIONS.md`.
- **Not backed by machine learning.** Routing is Dijkstra; the optimizer
  is a greedy load-balancing heuristic. Neither is "AI-predicted" in the
  trained-model sense, and we don't describe them that way.
- **Not connected to any live feed.** All scenario data is synthetic and
  loaded from `data/scenarios/*.json`.

## Project layout

See `docs/superpowers/plans/2026-10-23-aegis-master-plan.md` §9 (if kept
alongside this repo) for the full file structure and the shared
API/data contracts every module implements against.
```

- [ ] **Step 2: Write `docs/ASSUMPTIONS.md`**

```markdown
# AEGIS — Assumptions and Known Limitations

Written per PRD Global Principle #8 ("Clear uncertainty: synthetic data
and simplified movement rules must be disclosed").

## Simulation model

- **Movement profiles:** two speed multipliers only — `standard` (1.0x)
  and `reduced_mobility` (1.6x, i.e. 60% slower). Real mobility-impairment
  effects vary far more than a single multiplier captures.
- **Congestion formula:** `effective_time = base_time × factor`, where
  `factor = 1.0` at or under an edge's `capacity_per_tick`, and grows
  linearly above it (`1.0 + (ratio - 1.0) × 1.5`). This is a documented
  screening heuristic, not a calibrated traffic-flow model (no
  car-following dynamics, no intersection signal timing).
- **Departure time:** every agent departs at tick 0 in the MVP; staggered
  evacuation-order departure is a PRD §3.2 (P1) feature, not yet built.
- **Shelter assignment:** greedy nearest-with-capacity for the baseline,
  "least-loaded among k=2 nearest" for the alternative plan. Neither is a
  globally optimal assignment (that would require solving a
  transportation/min-cost-flow problem exactly) — both are fast,
  explainable heuristics appropriate for a same-day prototype.
- **Hazard zones** are decorative/advisory in the MVP engine (they render
  on the map and could inform route-weight penalties) but do not yet
  block or penalize routes directly — see Member 2's remaining-tasks
  checklist, PRD §7.2 objective #1.

## Data

- All three scenarios (`scenario_a_normal`, `scenario_b_bridge_closure`,
  `scenario_c_shelter_shortage`) are entirely synthetic: a hand-built
  6-node road network loosely modeled on a small city district, not a
  real place. Coordinates are illustrative.
- Population counts (300/450), shelter capacities (250/300/200) and road
  capacities are plausible round numbers chosen to produce visible,
  demonstrable failures (a shelter shortfall, a reroute) in a small
  graph — not derived from census or municipal data.

## Performance

- Benchmarked agent count: 750 (Scenario A), see the number Member 1
  recorded in their remaining-tasks checklist.
- The simulation runs synchronously per request (PRD §10.5) — there is no
  real-time streaming/WebSocket layer. For the demo's graph size and
  agent count this completes well under a second; this would need
  revisiting for a materially larger city or population.

## Explicitly out of scope for this prototype (PRD §1.4)

Real-world emergency instructions, validated behavioral predictions,
live satellite/emergency feeds, building-interior modeling, and a
trained ML model — none of these exist here, by design.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ASSUMPTIONS.md
git commit -m "docs: README setup instructions and disclosed modeling assumptions"
```

---

### Task 4: Demo script

**Files:**
- Create: `docs/DEMO_SCRIPT.md`

- [ ] **Step 1: Write the script**

```markdown
# AEGIS Demo Script (PRD §16.1)

Total time budget: ~4 minutes. Rehearse this exact sequence at least
twice before presenting, on the actual venue wifi/laptop.

1. **Open AEGIS, Scenario A loaded by default.** Point out: roads,
   population zones, 3 shelters, legend. Say: "This is a synthetic city —
   everything you see is fabricated for this demo, clearly labeled as
   such in the header."
2. **Press "Run Simulation."** Point at the results drawer as it
   populates: evacuated count, unserved count (should read 0), peak
   congestion. Say: "On an open road network with enough shelter
   capacity, everyone who should get out, does."
3. **Switch to Scenario B (critical bridge closure).** Click the E3
   bridge on the map if the inspector panel is wired; otherwise narrate:
   "This bridge is now closed." Press "Run Simulation" again.
4. **Point at the new unserved count and S1's reduced occupancy.** Say:
   "Watch what happens to the shelter this bridge was the only route to
   — fewer people get there, and the plan doesn't notice unless someone
   checks."
5. **Press "Generate Alternative Plan."** Point at the comparison view:
   baseline vs. alternative, the specific metric deltas, and the list of
   reassigned agents. Say: "The alternative plan is computed — not
   hardcoded — from this exact scenario's road graph and shelter
   capacities. If it can't do better, it says so instead of pretending."
6. **Close with Scenario C (shelter shortage)** only if time remains:
   same flow, different failure mode (capacity, not connectivity).
7. **Closing line (PRD §16.2):** "We don't wait for disasters to expose
   evacuation failures. We simulate them before lives are at risk."

## Fallback

Record a screen capture of this exact sequence succeeding, before the
event, and keep it on a USB stick and in the team's shared drive. If
venue wifi or a live dependency fails, play the recording and narrate
over it rather than attempting a live demo repair on stage.

## What NOT to say

- Never call the optimizer "AI-powered" or "machine-learned" — it's a
  documented heuristic. If a judge asks "is this a trained model?", the
  honest answer is "no — it's Dijkstra routing plus a greedy load-
  balancing heuristic, chosen because it's explainable and fast enough
  to run live in front of you."
- Never claim the scenario reflects a real location or real population
  data — say "synthetic" every time it comes up.
```

- [ ] **Step 2: Commit**

```bash
git add docs/DEMO_SCRIPT.md
git commit -m "docs: demo script and fallback plan"
```

---

### Remaining tasks (checklist)

- [ ] **Record the fallback video** once Tasks 1–2 and the frontend
  workstreams (Members 3/4) are merged and the Hour-23 sync checkpoint
  passes — follow the exact script from Task 4, Step 1.
- [ ] **PRD §20 Final Acceptance Checklist** — go through every box by
  hand in the last hour: this is literally your job title. Any box that
  can't be checked gets either fixed immediately (if small) or explicitly
  called out to the team as a known gap to narrate honestly during Q&A,
  never silently skipped.
- [ ] **Benchmark recording (PRD §12.1)** — confirm Member 1's recorded
  agent-count/runtime number made it into `docs/ASSUMPTIONS.md`'s
  Performance section; if not, add it.
- [ ] **Final full-team rehearsal** at Hour 28–30 (master plan §2): run
  the Task 4 script live, on the actual presentation laptop, on the
  actual venue network, at least twice.
