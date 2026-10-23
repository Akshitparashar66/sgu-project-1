# AEGIS Demo Script (PRD §16.1)

Total time budget: ~4 minutes. Rehearse this exact sequence at least twice before
presenting, on the actual venue wifi/laptop. Every number below is what the build actually
produces with the default seed (42) — if a number on screen differs, trust the screen and
find out why before going on stage.

**Before you start:** backend running (`uvicorn app.main:app --port 8000`), frontend running
(`npm run dev`), browser at `http://localhost:3000`, window ≥ 1280 px wide. Press **Reset**.

1. **Open AEGIS — Scenario A ("Normal Conditions") loads by default.** Point out: roads
   following the real streets, the two population zones (violet rings, 1,500 people), three
   shelters (1,800 places), the hazard area, the legend. Say: "This is Raj Nagar Extension in
   Ghaziabad, evacuating on foot — the streets are real, the people, shelters and capacities
   are synthetic, and the header says so."
2. **Press "Run simulation."** The results drawer fills: **1,500 evacuated, 0 unserved,
   98m 0s, peak congestion 2.32×**. Point at the first finding: "Road E4 peaks at 2.3×
   capacity — 900 evacuees routed over it." Say: "Everyone gets out on foot in just over an
   hour and a half — and the bypass stretch by the sports ground carries more than twice
   what it can."
3. **Close the Gaur Cascades Rd link, in the Scenario Lab.** Click **Close** on road **E3**
   (between the hazard area and North RNE School Camp). Before you run anything, the
   **Instant estimate** card updates: **~111 min clearance (±3), ~0 unserved, ~3.85× peak**.
   Say: "That's a machine-learning model trained on 6,400 simulated what-ifs. It answers as
   you click, and it shows how far off it usually is." Now **Run with these changes**:
   **0 unserved, 111m 30s, peak 3.85×**, and the card shows the simulation's numbers under
   the estimate. Say: "Every shelter is still reachable, but it failed on time: 13.5 minutes
   longer, with everyone funnelled down the bypass." (Same result as Scenario B.)
4. **Open Live Simulation and press play** (4 ticks/s). Point at the amber crowds walking
   the long way round via E5 and E6, the shelter meters filling, and the arrivals curve.
   Say: "This is the bottleneck you'd otherwise discover during the real emergency."
5. **Plan Comparison → "Generate alternative plan"** (about 2 seconds). **"Improvement
   found": clearance 111.5 → 44.5 min, average time to shelter 73 → 34 min, peak congestion
   3.85 → 1.33×, still 0 unserved.** Scroll to **Evacuation orders**: most slow walkers and part of
   each zone leave **now**; the rest go in waves at **+5, +10 and +15 min**, spread over all
   three shelters. Say: "The optimizer tried about a thousand plans: which shelter, which
   road, and when each group leaves, scoring every one by simulating it. Then it re-ran the
   winner on the same engine. Holding some people back for 5 to 15 minutes gets everyone in
   over an hour sooner." Then **Live Simulation → Optimized plan** and press play: grey dots
   wait at their zone until their wave, and the crowds never jam.
6. **Scenario D (Hindon river flood)** if time remains: pick it, **Run simulation** →
   **50 unserved, time limit reached**: the Sihani lanes (E7) are flooded, so all 800
   riverside residents walk the one bypass stretch (E1). Generate a plan: **everyone is
   sheltered in 46 min.** Then **Scenario C** for contrast: **220 unserved** both before and
   after optimizing. Say: "220 people have no shelter place; no routing or timing fixes
   that. The tool tells you when the answer is more shelters, not a better plan."
7. **If asked "how good is the estimate?":** point at the ± on each estimate
   card and say: "90% of the model's test cases were within that range of the real
   simulation. It learns our simulator, not real evacuations, and the Run button always
   gives the real numbers."
8. **Closing line (PRD §16.2):** "We don't wait for disasters to expose evacuation
   failures. We simulate them before lives are at risk."

## Fallback

Record a screen capture of this exact sequence succeeding, before the event, and keep it on
a USB stick and in the team's shared drive. If venue wifi or a live dependency fails, play
the recording and narrate over it rather than attempting a live demo repair on stage. (The
map tiles need internet; the simulation itself does not — with no wifi the network still
draws on a dark background.)

## What NOT to say

- Be exact about what is AI: the **instant estimate** is a trained machine-learning model
  (gradient-boosted trees) that learned *this simulator*; it predicts nothing about real
  people. The **optimizer** is a search (simulated annealing) scored by the simulation, not
  machine learning; call it "a search-based optimizer". The **simulation** is rule-based.
- Never call the optimized plan "optimal". It's the best of the ~1,000 plans the search
  tried, and it's re-checked on the engine.
- If a judge asks why staged waves help so much: the model has no queues, so a crowd kept
  below a road's capacity flows freely. That's the real logic of phased evacuation, but the
  real-world gain would be smaller (see `docs/ASSUMPTIONS.md`).
- The location is real (Raj Nagar Extension), the data is not: never claim real population,
  shelter or road-capacity figures — say "synthetic" every time it comes up.
- Don't say Scenario B "leaves people stranded" — it doesn't; it makes the evacuation
  13.5 minutes longer. Scenario D is the one where people are still walking at the limit,
  and C is the one with no shelter place. Scenario C is the one with unserved evacuees.
