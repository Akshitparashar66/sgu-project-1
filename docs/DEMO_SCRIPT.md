# AEGIS Demo Script (PRD §16.1)

Total time budget: ~4 minutes (~6 with the live-alerts step). Rehearse this exact sequence at least twice before
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
   59m 0s, peak congestion 2.32×**. Point at the first finding: "Road E4 peaks at 2.3×
   capacity — 900 evacuees routed over it." Say: "Everyone gets out on foot in just under an
   hour, but the bypass stretch by the sports ground has more than twice the people it can
   take, so they queue."
3. **Close the Gaur Cascades Rd link, in the Scenario Lab.** Click **Close** on road **E3**
   (between the hazard area and North RNE School Camp). Before you run anything, the
   **Instant estimate** card updates: **~72.4 min clearance (72.1–72.5), ~3.84× peak**.
   Say: "That's a machine-learning model trained on 6,400 simulated what-ifs. It answers as
   you click, with its own range." Now **Run with these changes**: **0 unserved, 72m 30s,
   peak 3.85×**, and the card shows the simulation's numbers under the estimate. Say: "Every
   shelter is still reachable, but it failed on time: 13.5 minutes longer, with everyone
   funnelled down the bypass." (Same result as Scenario B.)
4. **Open Live Simulation and press play** (4 ticks/s). Point at the amber dots waiting in
   line at the bypass junctions, the crowds taking the long way round via E5 and E6, the
   shelter meters filling, and the arrivals curve. Say: "This is the bottleneck you'd
   otherwise discover during the real emergency."
5. **Plan Comparison → "Optimize plan"** (about 5 seconds). **"Improvement found":
   clearance 72.5 → 37 min, average walk 27.8 → 21.8 min, still 0 unserved.** Point at
   **What the plan changes on the ground**: it opens the standby **Sports Ground Indoor
   Hall**. Point at the line under it: **"No plan can clear in under 33.5 min"**. Say: "So
   we're within 4 minutes of the best possible." Then **How robust is it?**: across 40
   variations it clears in **33.5–43.5 min** against **64.5–81 min**, and wins **40 of 40**.
   Click **Print orders (English / हिन्दी)**, switch to **हिन्दी**: the same orders,
   wave by wave, with a signature line. Close it, then **Save this plan** with a name and
   yours. Under **Reports → Saved plans**, approve it, and open the **Audit trail**. Say:
   "Every save and approval is fingerprinted and logged."
6. **Scenario D (Hindon river flood)** if time remains: pick it, **Run simulation** →
   **118 unserved, time limit reached**: the warning gives 50 minutes, the Sihani lanes (E7)
   are under water, Gaur Cascades Rd (E2) floods 15 minutes in, and the school camp needs
   10 minutes to open. In **Live Simulation**, watch E2 turn to "closed" at minute 15 and
   the people in line re-route. Optimize: **everyone is sheltered in 37 min**. Then
   **Scenario C**: **220 unserved**. Optimize: **0**, by opening the standby hall. Say:
   "No route or timing could house those 220. The plan says the answer is another
   building, and which one."
7. **Weak points and the river.** Scenario Lab → **Find weak points**: losing the Community
   Centre (S2) leaves **400** without a place, and losing the riverside bypass (E1) adds
   **24.5 min**. Click **Try it** on one. On **Overview**, the **Hindon river level** card:
   enter the district's warning and danger levels, record a reading above the warning level,
   and it offers to **Open** the flood scenario. Say: "We don't guess flood levels: the
   district sets them."
   **If asked "how good is the estimate?":** "90% of its test estimates for changes like
   these were within 1.2 minutes of the simulation, and each shows its own range. It learns
   our simulator, not real evacuations; the Run button always gives the real numbers."
   **If asked "can it use our data?":** Scenario Lab → **Use your own data** (ward and
   shelter CSVs), and Scenario G shows the same area on all 841 streets.
8. **Live alerts (about 2 minutes; start it on the Alerts page before step 7 so it has
   unfolded).** **Alerts → Start flood-day demo.** Point at the sources strip: NDMA
   "connected", TomTom with the real speeds on NH-9 Bypass and Gaur Cascades Rd right now, and
   "No data for E5, E6, E7", and the **Hindon flow forecast**: today's flow and the week's
   likely peak against the river's own 2-, 5- and 20-year flood flows. Say: "These are live:
   the official national alert feed, real traffic, and the Copernicus flood model's forecast
   for the Hindon." If asked how good the forecast is: "It sees big river floods days ahead,
   but it missed July 2023's local flooding, so the district's gauge stays the trigger." The demo then plays a scripted flood day, every alert marked **DEMO**: an IMD
   heavy-rain warning, the Hindon past warning then danger level, and at about 90 s a jam on
   NH-9 Bypass (8 km/h against 38). The red banner shows it on every page and the map outlines
   E1 and E4. Click **Apply: Set E1, E4 to 25% capacity**: the Scenario Lab says "Live
   conditions applied from demo alert …" and the instant estimate updates. With Scenario D
   loaded (apply the river alert first), **Optimize**: everyone is still sheltered, in
   **38.5 min** instead of 37. Say: "Live data never changes a plan by itself: an officer
   applies it, the simulation tests it, and the saved plan records which alert it came from."
   If a phone has joined the Twilio WhatsApp sandbox, **Send to phones** on an alert shows
   the preview and sends it, in English and Hindi. **Stop the demo** afterwards.
9. **Closing line (PRD §16.2):** "We don't wait for disasters to expose evacuation
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
- Never call the optimized plan "optimal" unless it meets the lower bound (as in G). Say
  "within N minutes of the best possible", using the bound on screen.
- If a judge asks how congestion works: each road lets in only as many people per minute as
  its width carries, and the rest queue at the junction (a standard bottleneck model). It
  doesn't model crowd crush or people slowing down in dense crowds.
- The location is real (Raj Nagar Extension), the data is not: never claim real population,
  shelter or road-capacity figures — say "synthetic" every time it comes up.
- Don't say Scenario B "leaves people stranded" — it doesn't; it makes the evacuation
  13.5 minutes longer. Scenario D is the one where people are still walking at the limit,
  and C is the one with no shelter place. Scenario C is the one with unserved evacuees.
- Live alerts: never say the jam, river levels or IMD warning in the demo are real; they are
  marked DEMO. What is real is the sources strip: the NDMA feed and TomTom speeds. Don't
  claim TomTom counts people: it measures vehicles, and AEGIS turns its speed into a share
  of road capacity as a stated assumption.
