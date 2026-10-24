# AEGIS — Assumptions and Known Limitations

Written per PRD Global Principle #8 ("Clear uncertainty: synthetic data and simplified
movement rules must be disclosed").

## Simulation model

- **Time:** discrete ticks of 30 s, capped at 240 ticks (2 hours) per scenario, or the
  scenario's own warning time (Scenario D: 50 minutes before the flood arrives). Agents
  still travelling at the cap are counted **unserved**, each with a warning — a run that
  "hit the time limit" is never reported as complete. A shelter's "turned away" count includes only people
  who reached its door and found it full, never people still walking at the limit.
- **Movement profiles:** two speed multipliers only — `standard` (1.0×) and
  `reduced_mobility` (1.6×, i.e. 60% slower). Real mobility-impairment effects vary far more
  than a single multiplier captures. Zone populations are split across profiles with a
  largest-remainder rule so the agent count always equals the zone's `evacuee_count`.
- **Congestion is queueing (a bottleneck, or point-queue, model):** each road lets at most
  `capacity_per_tick` people start along it per tick; everyone else waits in line at the
  junction, longest-waiting first. Once on a road people walk at their normal speed. Ties
  between people who joined the line in the same tick follow a fixed group order (route,
  profile, departure, shelter), which is as fair as any other order and lets the fast group
  simulation match the engine exactly. Not modelled: slower walking in dense crowds,
  spill-back when a line fills the road behind it, and crowd-crush risk.
- **Congestion ratio** is demand over capacity: people wanting to start along a road in a
  tick (including those already in line) divided by how many it lets in. "Congestion delay"
  is time spent in line.
- **Departure time:** in the baseline every agent departs at tick 0. The optimized plan may
  stagger departures in 5-minute waves (up to +30 min); waiting agents stay at their zone.
  Under queueing, waiting at home costs about as much as waiting in line, so staging is used
  only where it helps, for example to keep a road clear for slower walkers.
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
- **Roads that flood mid-run:** a road can carry `closes_at_tick`. From that tick nobody can
  start along it; people already on it finish crossing (the water is assumed to rise behind
  them). Anyone in line for it re-routes from the junction they're at to their shelter over
  the roads still open, at the same hazard-weighted cost as planning, or is counted as **cut
  off** if every way is flooded. The default plan doesn't know a flood is coming; the
  optimizer, which simulates every plan, does.
- **Shelter doors:** a shelter can open late (`opens_at_tick`: staff, keys, a cleared building)
  and register a limited number of people per tick (`intake_per_tick`). Arrivals wait outside,
  longest-waiting first. Once a shelter is full, the people still waiting are turned away.
- **Standby shelters and marshals:** a scenario can list standby shelters (not in the default
  plan) and a number of marshal teams. Only the plan optimizer uses them; see below.

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
| A Normal Conditions | — | all 1,500 sheltered in 59 min; peak 2.3× on E4 |
| B Critical Road Closure | E3 closed | all sheltered, but 72.5 min (+13.5) and peak 3.85× — a **time** failure |
| C Shelter Capacity Shortage | S1 cut to 80 places | 220 unserved — a **capacity** failure (59 min) |
| D Hindon River Flood | E7 flooded, E1 hazardous, 800 riverside, 50-min warning, Gaur Cascades Rd (E2) floods at 15 min, school camp opens at 10 min | 118 still walking when the water arrives — a **time-limit** failure |
| E Night, Vulnerable Population | 1.1 m/s, 40% slower walkers | all sheltered, but 69.5 min (+10.5) |
| F Compound Failure | E3 closed + S2 halved | 50 unserved **and** 72.5 min |
| G Detailed Street Network | A on all 841 roads (669 junctions); each zone starts from 3 junctions | all sheltered in 62 min |

Every scenario also has a standby site, the Sports Ground Indoor Hall (300 places, 10
minutes to open), and two marshal teams. The default plan uses neither.

- **The detailed network (G)** is built by `data/build_detailed_network.py` from every public
  street in OpenStreetMap within the study area, joined junction to junction. Usable widths
  come from the street type (4 m for a residential lane up to 7 m for the bypass), not a
  survey. Footpaths missing from OpenStreetMap are missing here too.

## Plan optimizer

- **Decisions:** evacuees are split into blocks of about 60 per zone and movement profile
  (~25 blocks). Each block gets a shelter, one of up to three shortest open routes to it
  (no more than 1.5× the shortest route's length), and a departure wave. The plan also
  decides which standby shelters to open and where to post its marshal teams (each team lets
  25% more people per tick onto its road).
- **Costs, so interventions only appear when they pay:** opening a standby shelter costs the
  equivalent of 1.5 min of clearance in the score, a marshal team 30 s, and each separate
  order 3 s, which keeps plans to about 7–14 orders.
- **Search:** 2,400 steps of simulated annealing from a nearest-shelter start. Then a finishing
  pass adds any unused intervention that improves the plan, drops any that doesn't pay, and
  moves each block to an earlier wave or a shorter route whenever that's no worse. Fixed step
  count, seeded: the same request always gives the same plan.
- **Scoring:** each candidate is simulated with `app/simulation/cohort.py`, which applies the
  engine's tick rules to groups instead of individuals. Tests check it returns exactly the
  engine's metrics on every scenario and on random plans with random routes, shelters,
  departures, flooding roads and slow shelter doors. It also skips ahead through ticks where
  nothing can change.
- **Capacity repair:** blocks are coarse, so the part of a block that won't fit its shelter
  is sent (same wave) to the nearest shelter with room. The optimizer never leaves more
  people unserved than shelter capacity forces.
- **Lower bound:** no plan can clear sooner than the slowest group's shortest walk, or than
  the people to be sheltered divided by the network's maximum flow per tick (computed as if
  every standby shelter were open and every road marshalled). The comparison page shows it,
  so a plan's distance from the best possible is visible.
- **The reported plan** is re-run on the real engine, with its interventions applied. Only
  that run's numbers are shown.

| Scenario (seed 42) | Baseline | Optimized plan | Interventions | Lower bound | Better in |
|---|---|---|---|---|---|
| A Normal | 0 unserved, clears in 59 min | 0, 36.5 min | none | 33.5 min | 40 of 40 variations |
| B Road closure | 0, 72.5 min | 0, 37 min | opens the standby hall | 33.5 min | 40 of 40 |
| C Shelter shortage | 220, 59 min | **0**, 36.5 min | opens the standby hall | 33.5 min | 40 of 40 |
| D Hindon flood | 118 still walking at the 50-min warning | **0**, 37 min | opens the standby hall | 33.5 min | 40 of 40 |
| E Night | 0, 69.5 min | 0, 43.5 min | marshals on E3 | 39.5 min | 40 of 40 |
| F Compound failure | 50, 72.5 min | **0**, 41.5 min | opens the standby hall | 33.5 min | 40 of 40 |
| G Detailed network | 0, 62 min | 0, 36 min (= the bound) | opens the standby hall | 36 min | 40 of 40 |

In G the optimized plan reaches the lower bound, so no plan can clear faster. Where the
standby hall is opened, it is what houses C's 220 and F's 50; on its own, routing could not.
Each optimization takes about 5 s (14 s on the detailed network).

## Robustness ranges

- After optimizing, both plans are re-run under 40 random variations: walking speed ±15%,
  road capacity −20% to +10%, each group reacting 0–2 minutes late, and 10% of each later
  wave leaving at once instead of waiting. Both plans face the same variations, so the
  comparison is paired.
- The comparison page shows the 10th–90th percentile range of clearance time, unserved and
  average time to shelter for both plans, and in how many variations the optimized plan
  scored better.
- The variation ranges are judgement calls, not measured distributions. They show whether a
  plan's advantage is fragile, not the true real-world spread.

## Using your own data

- In the Scenario Lab, zones (name, population, lat, lon, optional reduced-mobility share)
  and/or shelters (name, capacity, lat, lon) can be uploaded as CSV, for example from the
  district disaster management plan. Header names are matched loosely (Latitude, Ward,
  Population and so on), and shares can be given as 0.25 or 25.
- Each place is connected to the nearest junction of the current scenario's street network.
  The walk from the place to that junction is not simulated, and a warning is shown when it is
  over 1 km. The street network itself can't be uploaded yet.
- Limits: 500 rows per file and 10,000 evacuees in total, to keep runs to a few seconds.
- Imported scenarios are saved to `data/imported/`, which git ignores because it may hold
  real data. Shipped scenarios are never changed.

## Instant estimate model

- **What it predicts:** for a scenario plus Scenario Lab changes, the baseline plan's
  clearance time, unserved count and peak congestion, before it is run.
- **Model:** gradient-boosted decision trees (scikit-learn, 300 trees of depth 4 per target),
  exported as plain JSON trees and evaluated in pure Python, so the API needs no ML library
  and loads no pickle.
- **Inputs:** 22 features that don't depend on road or shelter ids (tested), so the model also
  works on new scenario files. They include evacuee count, reachable shelter places,
  free-flow walking time to the nearest shelter, the network's maximum throughput, and how
  heavily the baseline assignment loads each road, plus the scenario's time limit, how many
  people's routes cross a road that floods and how soon, and how late or slow the shelter
  doors are. The assignment is computed before any simulation, and takes a few milliseconds.
- **Training data:** 8,000 scenarios generated from the seven shipped ones. Half are Scenario
  Lab-style (random road closures and offline shelters). Half are also perturbed
  (populations ×0.6–1.5, shelter capacities ×0.5–1.3, road capacities ×0.7–1.3, walking speed
  ×0.8–1.2, 0–50% slow walkers; for 30% a time limit of 30–120 min, for 30% roads flooding
  mid-run, and for 20% of shelters a late opening or a slow door). Each is labeled by
  simulating it. 20% is held out for testing.
- **Ranges:** two smaller models estimate the 10th and 90th percentile of each output, so every
  estimate carries its own range. In testing the true value fell inside it 80–85% of the time.
  Unserved ranges can be wide (e.g. 0–200 when the estimate is 0), because unserved counts jump
  when a shelter fills.
- **Measured error on the held-out set:**

  | Target | All test cases: mean error / 90% within | Scenario Lab-style cases: mean / 90% within | R² | Inside own range |
  |---|---|---|---|---|
  | Clearance time | 1.9 min / ±3.6 min | 0.5 min / ±1.2 min | 0.94 | 85% |
  | Unserved | 25 people / ±68 | 5 people / ±12 | 0.98 | 83% |
  | Peak congestion | 0.06 / ±0.14 | 0.03 / ±0.08 | 0.98 | 80% |

  Errors are larger than the previous model's because the cases are harder: flooding roads,
  slow doors and the 841-road network.
- **What it is not:** it learns this simulator, not real evacuations, so its error is
  measured against the simulation only. It estimates the baseline plan, not the optimized
  one. Estimates never feed into reports or comparisons; the Run button gives the real
  numbers.
- **Kept in step with the engine:** the model stores a fingerprint of the simulation code it
  learned. If that code changes, the Scenario Lab warns that estimates may be off, and a test
  fails until the model is retrained (`python scripts/train_surrogate.py`).

## Performance

Measured on the development laptop (Python 3.13, median of repeated runs, end to end
through `run_simulation`):

| Run | Agents | Time |
|---|---|---|
| Scenario A | 1,500 | ~210 ms |
| Scenario D (floods, late shelter, 50-min limit) | 1,700 | ~225 ms |
| Scenario G (841 roads) | 1,500 | ~310 ms |
| Same run, group-level copy (`cohort.py`) | 1,500–1,700 | a few ms |
| Plan optimization (search, engine re-run, 2 × 40 variations) | 1,500–1,700 | ~5 s (G: ~14 s) |
| Weak points (each road in use and each shelter) | 1,500–1,700 | ~0.3 s (G: ~3.4 s) |
| Instant estimate (features + model) | 1,500–1,700 | ~20 ms (G: ~140 ms) |

The simulation runs synchronously per request (PRD §10.5); there is no streaming layer. The
loop is O(agents × ticks), so a materially larger city or population would need a revisit
(vectorized state, or a job queue with progress updates).

## Saved plans and approvals

- Saving re-computes the optimized plan from its inputs on the server (the search is
  deterministic) and stores it in `data/plans/` (git-ignored) as a new version, with a SHA-256
  fingerprint of everything that defines it. Approval checks the fingerprint first, so a plan
  file edited after saving can't be approved. Every save and approval is appended to
  `data/plans/audit.jsonl`.
- There are no logins: "prepared by" and "approved by" are names as typed. A real deployment
  would need authentication and access control before this trail meant anything legally.

## River level

- `data/river_gauges.json` lists the Hindon gauge with **empty** warning and danger levels:
  they must come from the district or the Central Water Commission, and AEGIS never guesses
  them. Until they're set, readings are recorded but not classified.
- Readings are typed in, or read from `AEGIS_RIVER_FEED_URL` (any JSON feed of
  `{gaugeId, levelM, observedAt}`). No public CWC API is assumed. At warning level or above the
  app suggests opening the flood scenario; it never changes a plan by itself.

## Printed orders

- The printable sheet translates its own wording into Hindi; zone, shelter and street names
  stay as they are in the data. The translations were written for this prototype and should
  be checked by the district before any use.

## Explicitly out of scope for this prototype (PRD §1.4)

Real-world emergency instructions, validated behavioral predictions, live
satellite/emergency feeds and building-interior modeling: none of these exist here, by
design. The one trained model estimates this simulator's output; it predicts nothing about
real people.
