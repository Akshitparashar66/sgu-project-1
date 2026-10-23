# AEGIS Demo Script (PRD §16.1)

Total time budget: ~4 minutes. Rehearse this exact sequence at least twice before
presenting, on the actual venue wifi/laptop. Every number below is what the build actually
produces with the default seed (42) — if a number on screen differs, trust the screen and
find out why before going on stage.

**Before you start:** backend running (`uvicorn app.main:app --port 8000`), frontend running
(`npm run dev`), browser at `http://localhost:3000`, window ≥ 1280 px wide. Press **Reset**.

1. **Open AEGIS — Scenario A ("Normal Conditions") loads by default.** Point out: roads,
   the two population zones (violet rings, 750 people), three shelters (750 places), the
   hazard area, the legend. Say: "This is a synthetic city — everything you see is fabricated
   for this demo, and the header says so."
2. **Press "Run simulation."** The results drawer fills: **750 evacuated, 0 unserved,
   30m 30s, peak congestion 10.13×**. Roads turn red where demand exceeds capacity. Point at
   the first finding: "Road E4 peaks at 10.1× capacity — 304 evacuees routed over it." Say:
   "Everyone gets out — but one road is carrying ten times what it can."
3. **Close the bridge.** Click road **E3** (between the hazard area and Highland School) →
   inspector → **Close road** → **Run simulation**. Now: **still 0 unserved, but completion
   61m 30s — double — and peak congestion 15×.** Say: "The plan didn't fail on paper — every
   shelter is still reachable. It failed in time: closing one bridge doubles the evacuation,
   because everyone now funnels through the same two roads." (Same result as picking
   Scenario B from the list.)
4. **Open Live Simulation and press play** (4 ticks/s). Point at the amber platoons crawling
   around the long way via E5 and E6, the shelter meters filling, and the arrivals curve.
   Say: "This is the bottleneck you'd otherwise discover during the real emergency."
5. **Press "Generate alternative plan."** The comparison says **"No feasible improvement
   found"** — load-balancing can't beat a road-capacity problem — and shows why, metric by
   metric. Say: "The alternative plan is computed — not hardcoded — from this exact road
   graph. When it can't do better, it says so instead of pretending."
6. **Scenario C (shelter shortage)** if time remains: pick it, **Run simulation** →
   **530 evacuated, 220 unserved**, and the top finding: "Shelter capacity shortfall: 220
   evacuees have no place — no routing change can fix this." Same tool, different failure
   mode: capacity, not connectivity.
7. **Closing line (PRD §16.2):** "We don't wait for disasters to expose evacuation
   failures. We simulate them before lives are at risk."

## Fallback

Record a screen capture of this exact sequence succeeding, before the event, and keep it on
a USB stick and in the team's shared drive. If venue wifi or a live dependency fails, play
the recording and narrate over it rather than attempting a live demo repair on stage. (The
map tiles need internet; the simulation itself does not — with no wifi the network still
draws on a dark background.)

## What NOT to say

- Never call the optimizer "AI-powered" or "machine-learned" — it's a documented heuristic.
  If a judge asks "is this a trained model?", the honest answer is "no — it's Dijkstra
  routing plus a greedy load-balancing heuristic, chosen because it's explainable and fast
  enough to run live in front of you."
- Never claim the scenario reflects a real location or real population data — say
  "synthetic" every time it comes up. The basemap is for orientation only.
- Don't say Scenario B "leaves people stranded" — it doesn't; it doubles the evacuation
  time. Scenario C is the one with unserved evacuees.
