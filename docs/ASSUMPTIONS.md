# AEGIS — Assumptions and Known Limitations

Written per PRD Global Principle #8 ("Clear uncertainty: synthetic data and simplified
movement rules must be disclosed").

## Simulation model

- **Time:** discrete ticks of 30 s, capped at 240 ticks (2 hours) per scenario. Agents
  still travelling at the cap are counted **unserved**, each with a warning — a run that
  "hit the time limit" is never reported as complete.
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

- All three scenarios (`scenario_a_normal`, `scenario_b_bridge_closure`,
  `scenario_c_shelter_shortage`) are entirely synthetic: a hand-built 6-node road network.
  Coordinates are illustrative; the basemap under it is for orientation only and the
  network does not follow its streets.
- Population counts (300 / 450), shelter capacities (250 / 300 / 200) and road capacities are
  plausible round numbers chosen to produce visible, demonstrable failures in a small graph —
  not derived from census or municipal data.
- Scenario B closes E3. Shelter S1 stays reachable the long way round (via E6), so B shows a
  **time** failure (evacuation takes twice as long, 30.5 → 61.5 min) rather than an unserved
  one. Scenario C cuts S1 to 30 places, a **capacity** failure: 220 evacuees cannot be
  sheltered whatever the routing.

## Performance

Measured on the development laptop (Python 3.13, median of repeated runs, end to end
through `run_simulation`):

| Run | Agents | Time |
|---|---|---|
| Scenario A | 750 | ~43 ms |
| Scenario B (longer, more congested) | 750 | ~74 ms |
| Scenario A scaled 10× (people, shelter and road capacity) | 7,500 | ~416 ms |

The simulation runs synchronously per request (PRD §10.5); there is no streaming layer. The
loop is O(agents × ticks), so a materially larger city or population would need a revisit
(vectorized state, or a job queue with progress updates).

## Explicitly out of scope for this prototype (PRD §1.4)

Real-world emergency instructions, validated behavioral predictions, live
satellite/emergency feeds, building-interior modeling, and a trained ML model — none of
these exist here, by design.
