# AEGIS — Assumptions and Known Limitations

Written per PRD Global Principle #8 ("Clear uncertainty: synthetic data and simplified
movement rules must be disclosed").

## Simulation model

- **Time:** discrete ticks of 30 s, capped at 240 ticks (2 hours) per scenario. Agents
  still travelling at the cap are counted **unserved**, each with a warning — a run that
  "hit the time limit" is never reported as complete. A shelter's "turned away" count includes only people
  who reached its door and found it full, never people still walking at the limit.
- **Movement profiles:** two speed multipliers only — `standard` (1.0×) and
  `reduced_mobility` (1.6×, i.e. 60% slower). Real mobility-impairment effects vary far more
  than a single multiplier captures. Zone populations are split across profiles with a
  largest-remainder rule so the agent count always equals the zone's `evacuee_count`.
- **Congestion formula:** `effective_time = base_time × factor`, where `factor = 1.0` at or
  under an edge's `capacity_per_tick`, and grows linearly above it
  (`1.0 + (ratio − 1.0) × 1.5`), with `ratio = agents entering this tick ÷ capacity_per_tick`.
  This is a documented screening heuristic, not a calibrated traffic-flow model (no
  car-following dynamics, no intersection signal timing).
- **Departure time:** in the baseline every agent departs at tick 0. Combined with the
  per-tick congestion formula, agents who enter a road together travel together as a
  platoon, which is why the replay shows dense bands and peak ratios reach 2–4×. The
  optimized plan staggers departures in 5-minute waves (up to +30 min); waiting agents stay
  at their zone and enter their first road at their wave's tick.
- **Why staging helps so much here:** the congestion factor is fixed when a group enters a
  road and there is no queue, so splitting a crowd into waves below a road's capacity removes
  most of its delay. That is the real logic of phased evacuation, but this model rewards it
  generously. Real-world gains from staging would likely be smaller, and announcing and
  enforcing waves has its own cost, which the model ignores.
- **Shelter assignment:** the baseline is greedy nearest-with-capacity, in a seeded random
  order. The optimized plan comes from the search described under "Plan optimizer" below.
  Neither is a proven optimum. Assignment respects capacity, so the engine's at-the-door
  rejection is a safety net that rarely fires in the fixtures.
- **Optimized-plan verdict:** "feasible" means the optimized plan has no more unserved agents
  and a better score (fewer unserved, then earlier clearance, then shorter average time to
  shelter, with hazard exposure charged like walking time), as measured by re-running it on
  the engine. Every trade-off is listed, including more people on hazard-risk roads.
- **Hazards:** each road's `hazard_risk` adds up to `HAZARD_PENALTY_SECONDS = 120` to its
  routing cost (scaled by risk) — a tie-breaker that steers routes off hazardous roads when
  travel times are close, not a closure. Hazard *polygons* are drawn on the map but do not
  change the simulation; simulated travel time is never inflated by hazard.
- **Closed vs restricted roads:** both are excluded from routing.

## Replay

- The replay is reconstructed from each agent's recorded edge entry/exit ticks; positions are
  interpolated linearly along each road. Agents are spread up to ~55 m *across* the road so
  a crowd is visible — never *along* it, which would misstate timing.
- Agents cut off by the time limit are shown stranded on their road; their remaining travel
  time is unknown, so they are never drawn reaching a shelter.

## Data

- All six scenarios are synthetic people on a real street layout: a 6-junction, 7-road
  network in Raj Nagar Extension, Ghaziabad (`data/network/raj_nagar_extension.json`). Each
  junction is a real intersection and each road is the shortest real street path between its
  two junctions in OpenStreetMap (© OpenStreetMap contributors, ODbL), stored as the road's
  `geometry` and drawn and animated along it. `length_m` is that path's real length.
- The scenario files are generated, not hand-edited: `python data/build_scenarios.py` builds
  all six from the shared network, so they differ only in their documented what-if.
- Road E7 (Sihani side → Anandibai Joshi Rd) is the shortest real route that shares no street
  with E1/E4, which is why it is a 2.85 km detour: on the ground there is no short second
  road between those junctions.
- **Everyone evacuates on foot.** Free walking speed is 1.3 m/s (~4.7 km/h), so
  `base_travel_time_s = length_m / 1.3`; `reduced_mobility` walkers take 1.6× as long
  (~0.8 m/s). Scenario E (night) uses 1.1 m/s for everyone.
- **Road capacity is pedestrian flow:** `capacity_per_tick = usable width × 1.3 people/m/s ×
  30 s` (1.3 people per metre per second is the peak flow in crowd-flow literature). Usable
  widths (3.5 m for the Sihani lanes up to 7 m on the bypass) are estimates from the street
  type, not a survey.
- Populations (600 riverside + 900 central = 1,500) and shelter places (600 + 700 + 500 =
  1,800, i.e. 20% headroom) are plausible round numbers, not census or municipal data. The
  zone and shelter names describe invented sites, not real institutions.

| Scenario | What-if | Outcome (seed 42) |
|---|---|---|
| A Normal Conditions | — | all 1,500 sheltered in 98 min; peak 2.3× on E4 |
| B Critical Road Closure | E3 closed | all sheltered, but 111.5 min — a **time** failure |
| C Shelter Capacity Shortage | S1 cut to 80 places | 220 unserved — a **capacity** failure |
| D Hindon River Flood | E7 flooded, E1 hazardous, 800 riverside | 50 still walking at the 2-hour limit — a **time-limit** failure |
| E Night, Vulnerable Population | 1.1 m/s, 40% slower walkers | all sheltered with 4.5 min to spare (115.5 min) |
| F Compound Failure | E3 closed + S2 halved | 50 unserved **and** 108.5 min |

## Plan optimizer

- **Decisions:** evacuees are split into blocks of about 60 per zone and movement profile
  (~25 blocks). Each block gets a shelter, one of up to three shortest open routes to it
  (no more than 1.5× the shortest route's length), and a departure wave.
- **Search:** 1,200 steps of simulated annealing from a nearest-shelter start, then a tidy
  pass that moves each block to an earlier wave or a shorter route whenever that's no worse,
  so no delay or detour is left in the plan unless it pays for itself. Fixed step count,
  seeded: the same request always gives the same plan.
- **Scoring:** each candidate is simulated with `app/simulation/cohort.py`, which applies the
  engine's tick rules to groups instead of individuals. Tests check it returns exactly the
  engine's metrics on the baseline plan of every scenario and on random plans with random
  routes, shelters and departures. It takes ~2.5 ms per run instead of ~260 ms.
- **Capacity repair:** blocks are coarse, so the part of a block that won't fit its shelter
  is sent (same wave) to the nearest shelter with room. The optimizer never leaves more
  people unserved than shelter capacity forces.
- **The reported plan** is re-run on the real engine. Only that run's numbers are shown.

| Scenario (seed 42) | Baseline | Optimized plan |
|---|---|---|
| A Normal | 0 unserved, clears in 98 min | 0 unserved, 38 min |
| B Road closure | 0, 111.5 min | 0, 44.5 min |
| C Shelter shortage | 220, 87.5 min | 220 (capacity limit), 36 min |
| D Hindon flood | 50 still walking at the 2-hour limit | 0, 46 min |
| E Night | 0, 115.5 min | 0, 48.5 min |
| F Compound failure | 50, 108.5 min | 50 (capacity limit), 49.5 min |

Each optimization takes 1.5–2.5 s and evaluates about 1,000 candidate plans.

## Instant estimate model

- **What it predicts:** for a scenario plus Scenario Lab changes, the baseline plan's
  clearance time, unserved count and peak congestion, before it is run.
- **Model:** gradient-boosted decision trees (scikit-learn, 300 trees of depth 4 per target),
  exported as plain JSON trees and evaluated in pure Python, so the API needs no ML library
  and loads no pickle.
- **Inputs:** 17 features that don't depend on road or shelter ids (tested), so the model also
  works on new scenario files. They include evacuee count, reachable shelter places,
  free-flow walking time to the nearest shelter, the network's maximum throughput, and how
  heavily the baseline assignment loads each road. The assignment is computed before any
  simulation, and takes a few milliseconds.
- **Training data:** 8,000 scenarios generated from the six shipped ones. Half are Scenario
  Lab-style (random road closures and offline shelters). Half are also perturbed
  (populations ×0.6–1.5, shelter capacities ×0.5–1.3, road capacities ×0.7–1.3, walking speed
  ×0.8–1.2, 0–50% slow walkers). Each is labeled by simulating it. 20% is held out for testing.
- **Measured error on the held-out set:**

  | Target | All test cases: mean error / 90% within | Scenario Lab-style cases: mean / 90% within | R² |
  |---|---|---|---|
  | Clearance time | 3.3 min / ±10 min | 1.1 min / ±2.7 min | 0.95 |
  | Unserved | 48 people / ±136 | 15 people / ±34 | 0.96 |
  | Peak congestion | 0.07 / ±0.15 | 0.03 / ±0.06 | 0.98 |

  The Scenario Lab shows the "90% within" range from the Scenario Lab-style column next to
  each estimate.
- **What it is not:** it learns this simulator, not real evacuations, so its error is
  measured against the simulation only. It estimates the baseline plan, not the optimized
  one. Estimates never feed into reports or comparisons; the Run button gives the real
  numbers. Retrain with `python scripts/train_surrogate.py` after changing the engine.

## Performance

Measured on the development laptop (Python 3.13, median of repeated runs, end to end
through `run_simulation`):

| Run | Agents | Time |
|---|---|---|
| Scenario A | 1,500 | ~260 ms |
| Scenario B (longer, more congested) | 1,500 | ~330 ms |
| Scenario D (runs to the 2-hour limit) | 1,700 | ~330 ms |
| Same run, group-level copy (`cohort.py`) | 1,500–1,700 | ~2.5 ms |
| Plan optimization (search + engine re-run) | 1,500–1,700 | 1.5–2.5 s |
| Instant estimate (features + model) | 1,500–1,700 | ~20 ms |

The simulation runs synchronously per request (PRD §10.5); there is no streaming layer. The
loop is O(agents × ticks), so a materially larger city or population would need a revisit
(vectorized state, or a job queue with progress updates).

## Explicitly out of scope for this prototype (PRD §1.4)

Real-world emergency instructions, validated behavioral predictions, live
satellite/emergency feeds and building-interior modeling: none of these exist here, by
design. The one trained model estimates this simulator's output; it predicts nothing about
real people.
