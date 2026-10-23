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
3. **Close the Gaur Cascades Rd link.** Click road **E3** (between the hazard area and North
   RNE School Camp) → inspector → **Close road** → **Run simulation**. Now: **still 0
   unserved, but 111m 30s — 13.5 minutes longer, with 8.5 minutes left before the 2-hour
   limit — and peak congestion 3.85×.** Say: "Every shelter is still reachable. It failed in
   time: everyone now funnels down the bypass and round by Anandibai Joshi Road." (Same
   result as picking Scenario B from the list.)
4. **Open Live Simulation and press play** (4 ticks/s). Point at the amber crowds walking
   the long way round via E5 and E6, the shelter meters filling, and the arrivals curve.
   Say: "This is the bottleneck you'd otherwise discover during the real emergency."
5. **Press "Generate alternative plan."** The comparison says **"No feasible improvement
   found"** — load-balancing can't beat a road-capacity problem — and shows why, metric by
   metric. Say: "The alternative plan is computed — not hardcoded — from this exact road
   graph. When it can't do better, it says so instead of pretending."
6. **Scenario D (Hindon river flood)** if time remains: pick it, **Run simulation** →
   **50 unserved, time limit reached**. The Sihani lanes (E7) are flooded, so all 800
   riverside residents walk the one bypass stretch (E1). Say: "Nobody was turned away —
   these 50 people were still walking when the two hours ran out." Then **Scenario C** for
   contrast: **1,280 evacuated, 220 unserved** — "220 people have no shelter place; no
   routing change can fix that." Same tool, three different failure modes: time, time
   limit, capacity. (E — night, slower walkers — finishes with 4.5 minutes to spare; F —
   road closed and a shelter halved — loses 50 people *and* 10.5 minutes.)
7. **Optional AI moment** (needs `GEMINI_API_KEY` in `backend/.env.local` and wifi; each AI call takes ~15–25 s, so start it before you talk): in the Scenario Lab, type
   *"What if the Gaur Cascades link floods?"* → **Interpret** → it proposes closing E3 →
   **Apply these changes** → run. Then open **Reports → Write briefing**. Say: "Gemini only
   translates the question and writes up the results — every number comes from the
   simulation, and the backend checks each one." Without a key both still work offline (the
   UI labels them "matched by keyword" / "standard summary"), so rehearse whichever you'll have.
8. **Closing line (PRD §16.2):** "We don't wait for disasters to expose evacuation
   failures. We simulate them before lives are at risk."

## Fallback

Record a screen capture of this exact sequence succeeding, before the event, and keep it on
a USB stick and in the team's shared drive. If venue wifi or a live dependency fails, play
the recording and narrate over it rather than attempting a live demo repair on stage. (The
map tiles need internet; the simulation itself does not — with no wifi the network still
draws on a dark background.)

## What NOT to say

- Never call the optimizer or the simulation "AI-powered" or "machine-learned" — they're a
  documented heuristic and a rule-based engine. Gemini only writes briefings and parses
  typed questions.
  If a judge asks "is this a trained model?", the honest answer is "no — it's Dijkstra
  routing plus a greedy load-balancing heuristic, chosen because it's explainable and fast
  enough to run live in front of you."
- The location is real (Raj Nagar Extension), the data is not: never claim real population,
  shelter or road-capacity figures — say "synthetic" every time it comes up.
- Don't say Scenario B "leaves people stranded" — it doesn't; it makes the evacuation
  13.5 minutes longer. Scenario D is the one where people are still walking at the limit,
  and C is the one with no shelter place. Scenario C is the one with unserved evacuees.
