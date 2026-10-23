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
- **Departure time:** every agent departs at tick 0. Combined with the per-tick congestion
  formula, agents who enter a road together travel together as a platoon — that is why the
  replay shows dense bands of evacuees and why peak congestion ratios are high (10–15×).
  Staggered, evacuation-order departure is a PRD §3.2 (P1) feature, not yet built; the
  findings recommend it wherever a bottleneck appears.
- **Shelter assignment:** greedy nearest-with-capacity for the baseline, "least-loaded among
  the k = 2 nearest" for the alternative plan. Neither is a globally optimal assignment (that
  would require solving a min-cost-flow problem exactly) — both are fast, explainable
  heuristics. Assignment already respects capacity, so the engine's at-the-door rejection is a
  safety net that rarely fires in the fixtures.
- **Alternative-plan verdict:** "feasible" means the alternative has no more unserved agents
  and is better on unserved count or peak congestion. Completion time is always reported
  alongside, and the comparison view lists every metric that got worse.
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

## AI helpers (optional)

- Google Gemini (`gemini-3.5-flash`, falling back to `gemini-3.6-flash` and `gemini-3.5-flash-lite`) is used for two things only: rewriting a finished
  run's results as a briefing, and translating a typed what-if question into road/shelter
  ids. It never computes a simulation number.
- Briefings are grounded: Gemini sees only a JSON summary of the run, and every number in its
  answer is checked against that summary (rounding allowed; counts up to 10 are always allowed
  because prose uses them, e.g. "two shelters"). Any unbacked number discards the whole
  briefing for the fixed-sentence summary, and the UI says which one you're reading.
- What-if parsing can only propose ids that exist in the scenario; unknown ids are dropped
  with a warning, and nothing is applied until the planner confirms.
- Without `GEMINI_API_KEY`, or when every model fails, times out or declines, both helpers fall back to
  deterministic offline behavior (template briefing, keyword matching of ids and shelter names).

## Performance

Measured on the development laptop (Python 3.13, median of repeated runs, end to end
through `run_simulation`):

| Run | Agents | Time |
|---|---|---|
| Scenario A | 1,500 | ~260 ms |
| Scenario B (longer, more congested) | 1,500 | ~330 ms |
| Scenario D (runs to the 2-hour limit) | 1,700 | ~330 ms |

The simulation runs synchronously per request (PRD §10.5); there is no streaming layer. The
loop is O(agents × ticks), so a materially larger city or population would need a revisit
(vectorized state, or a job queue with progress updates).

## Explicitly out of scope for this prototype (PRD §1.4)

Real-world emergency instructions, validated behavioral predictions, live
satellite/emergency feeds, building-interior modeling, and a trained ML model — none of
these exist here, by design. (The optional Gemini helpers above summarize and translate;
they don't model or predict anything.)
