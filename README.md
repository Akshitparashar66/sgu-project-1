# AEGIS — Adaptive Emergency Guidance & Intelligence System

Simulate the risk. Engineer the escape.

AEGIS is a prototype evacuation-planning and simulation tool (PS 021). Planners load a
scenario, simulate every evacuee moving through a road network to shelters, find the
congestion points and shelter shortfalls, try what-if changes (close a road, lose a
shelter) with an instant estimate of the result, and compare the baseline plan against an
optimized one.

It is **not** a real emergency-response system — see "What this is not" below.

## Setup

**Backend** (Python 3.11+):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend** (Node 22+):
```bash
cd frontend
npm install
npm run dev  # http://localhost:3000
```

**Or run everything with Docker** (e.g. on a district server):
```bash
docker compose up --build   # http://localhost:3000
```
Imported scenarios, saved plans, river readings and alerts live in Docker volumes. Set
`AEGIS_API_URL` if the browser reaches the API somewhere other than `localhost:8000`,
`AEGIS_CORS_ORIGINS` for other front-end addresses, and optionally `AEGIS_RIVER_FEED_URL`.

**Deploy: API on Render, frontend on Vercel.**
1. *Render:* New → Blueprint → this repository. `render.yaml` builds `backend/Dockerfile`
   (it listens on Render's `PORT`). Enter the keys it asks for; set `AEGIS_CORS_ORIGINS` to the
   Vercel address, and optionally `AEGIS_CORS_ORIGIN_REGEX` for preview links.
2. *Vercel:* New Project → this repository, **Root Directory `frontend`**, and the environment
   variable `NEXT_PUBLIC_API_BASE_URL` = the Render address (e.g. `https://aegis-api.onrender.com`).
   It is read at build time: redeploy after changing it.
3. On Render's free plan the service sleeps when idle (the first request then takes up to about
   a minute, and live checks pause), and its disk is reset on every deploy or restart: saved
   plans, imported scenarios, river readings, alerts and recipients do not persist. For anything
   real, use a paid instance with a persistent disk.

**Live data and alerts (optional).** Put the keys in `backend/.env.local`, which git and
Docker builds ignore; the backend reads it at startup and Docker Compose passes it in:
```bash
AEGIS_LIVE=1                          # check NDMA alerts and TomTom traffic in the background
TOMTOM_API_KEY=...                    # developer.tomtom.com, "Traffic API" product only
TWILIO_ACCOUNT_SID=...                # for sending alerts by WhatsApp / SMS
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=+1...            # your WhatsApp sandbox number (Twilio console > Try WhatsApp)
TWILIO_SMS_FROM=                      # a Twilio number, if you have one
```
Without them the app works as before; the Alerts page says which sources are off, and the
flood-day demo still runs (no keys, no network).

**Instant-estimate model:** the trained model ships in `backend/app/ml/surrogate_model.json`,
so nothing extra is needed to use it. To retrain it after changing the engine (a test fails
until you do), which takes about 8 minutes:
```bash
cd backend
pip install -r requirements-ml.txt   # scikit-learn + numpy, training only
python scripts/train_surrogate.py
```

The frontend calls the API at `http://localhost:8000` (override with
`NEXT_PUBLIC_API_BASE_URL`). The backend allows CORS from `localhost:3000`; add other
origins comma-separated in `AEGIS_CORS_ORIGINS` before demoing from another host.

**Run the test suites** (GitHub Actions runs both, plus the Docker build, on every push):
```bash
cd backend && python -m pytest      # simulation, routing, optimizer, API, acceptance
cd frontend && npm test             # vitest: formatting, replay math, components
```

## What this is

- **An agent-based evacuation simulator.** Every evacuee is an agent with a movement
  profile (standard / reduced mobility), a Dijkstra route over open roads, and a
  capacity-checked shelter assignment. A tick-based engine moves them; each road lets in only
  as many people per tick as its width can carry, and the rest wait in line at the junction
  (a documented bottleneck model). No shelter ever exceeds capacity. Roads can flood partway
  through a run (people in line re-route, or are cut off), and shelters can open late or
  register arrivals at a limited rate (people wait at the door).
- **A what-if lab.** Close any road, leave it a share of its capacity (as a traffic jam
  does), or take any shelter offline (on the map or in the Scenario Lab) and re-run. Changes
  apply to a copy; scenario files are never modified.
- **A search-based plan optimizer.** Simulated annealing decides, for each group of evacuees,
  which shelter to use, which of up to three routes to walk, and when to leave (staged waves
  every 5 minutes, up to +30). It can also open standby shelters and post marshal teams on
  roads, each at a cost, so only when they pay for themselves. Each candidate plan is scored
  by simulating it: fewest unserved first, then earliest clearance, then shortest average
  time to shelter, with hazard exposure charged like extra walking time and a small cost per
  separate order so plans stay simple to announce. About 2,000 candidate plans are checked in
  about 5 s using a group-level copy of the engine that returns exactly the engine's numbers
  (tested). The winning plan is re-run on the real engine, shown as evacuation orders, set
  against a lower bound on clearance time ("no plan can clear in under 33.5 min"), and
  replayable. It says plainly when it can't beat the baseline.
- **Printable orders in English and हिन्दी**, wave by wave, with a signature line, and
  **saved plans with an approval trail**: each saved version is fingerprinted, approval
  checks the fingerprint, and every save and approval goes into an append-only audit log.
- **Robustness ranges.** Both plans are re-run under 40 random variations (walking speed,
  road capacity, reaction time, people ignoring their wave), and the comparison shows
  10th–90th percentile ranges and how often the optimized plan still wins.
- **Weak points.** One click in the Scenario Lab simulates losing each road in use and each
  shelter, one at a time, and ranks them by damage, with a "Try it" button for each.
- **An animated replay** of every evacuee, tick by tick, with live shelter occupancy and an
  arrivals-over-time chart — so bottlenecks are visible, not just reported.
- **Findings and reports** derived only from real run numbers: capacity shortfalls,
  bottleneck roads with routed headcount and delay, shelters that turned people away,
  hazard-exposed routes. Exportable as JSON.
- **Instant estimates (machine learning).** While you close roads or take shelters offline
  in the Scenario Lab, a gradient-boosted tree model estimates clearance time, unserved count
  and peak congestion in about 20 ms, before anything is run. It was trained on 6,400
  simulated what-ifs (including flooding roads, jammed roads, slow shelter doors and the
  detailed network),
  and each estimate carries its own 10th–90th percentile range. On Scenario Lab-style cases
  90% of clearance estimates are within ±1.2 min. After a run, the real numbers appear next
  to it. If the simulation code changes, the card warns that the model needs retraining.
- **Your own data.** Upload a district's wards and shelters as CSV (for example from its
  disaster management plan) in the Scenario Lab. They are placed on the street network and
  saved as a new scenario in `data/imported/`, which git ignores.
- **River level.** Record a Hindon gauge reading (or connect a feed); against the district's
  own warning and danger levels, which AEGIS never guesses, it suggests the flood scenario.
- **Live alerts.** With `AEGIS_LIVE=1`, AEGIS reads official warnings from NDMA's SACHET
  feed (IMD, UP SDMA, CWC; Ghaziabad and the Hindon, with nearby districts as information),
  river levels (typed in, a feed, or CWC flood bulletins), a 7-day Hindon flow forecast from
  GloFAS against the river's own 2-, 5- and 20-year flood flows, and live traffic from TomTom on
  the roads it covers. They become alerts: a banner across every page, an Alerts page with
  each source's state, a pulsing outline on jammed roads and the flood area on the map. One
  click applies an alert's conditions in the Scenario Lab (open the flood scenario, close a
  road, or set a jammed road to a share of its capacity); nothing changes a plan until it's
  run, and a plan saved afterwards records which alerts it was based on. Alerts can be
  acknowledged (with a name, logged) and sent to officials by WhatsApp or SMS in English
  and Hindi, after a preview of who gets what. A scripted flood-day demo, marked DEMO
  throughout, rehearses all of it without keys or network.
- **Seven evacuation-on-foot scenarios in Raj Nagar Extension, Ghaziabad** (synthetic people,
  real streets): normal conditions (A), a closed critical road (B), a shelter-capacity
  shortage (C), a Hindon river flood with a road flooding mid-run and a late-opening shelter
  (D), a night evacuation with many slow walkers (E), a compound failure (F), and A on every
  public street in the area, 841 roads (G). Every road follows its real street path from
  OpenStreetMap, on the map and in the replay. The files in `data/scenarios/` are generated
  by `python data/build_scenarios.py` from the networks in `data/network/` (the detailed one
  by `python data/build_detailed_network.py`).

## What this is not

- **Not a live emergency-response system.** It does not issue real evacuation instructions
  and must never be used that way.
- **Not validated against real human behavior.** Movement speeds, congestion penalties and
  the optimizer's heuristic are documented, simplified models — see `docs/ASSUMPTIONS.md`.
- **Not trained on real evacuations.** The estimate model learns this simulator from its own
  synthetic runs. Its error is measured against the simulation, which says nothing about
  real-world accuracy. Every number in a report or comparison comes from the simulation.
- **Not guaranteed optimal.** The optimizer is a heuristic search: it finds much better plans
  than the baseline, but not a proven optimum, and a different seed can find a different plan.
  The lower bound shows how far from the best possible it can be at most.
- **Not a secured multi-user system.** Saved plans and approvals record names as typed: there
  are no logins yet.
- **Not live unless switched on, and not complete when it is.** Live sources run only with
  `AEGIS_LIVE=1`. The GloFAS flow forecast is a model for a ~5 km area, not a gauge, and it
  missed the July 2023 Hindon flood. TomTom covers 4 of the 7 roads (NH-9 Bypass, Gaur Cascades Rd), measures
  vehicles rather than people on foot, and its speeds are applied as a share of capacity, an
  assumption. NDMA alerts are matched to the area by place names in their text. Scenario
  data is synthetic: roads follow real Raj Nagar Extension streets
  (NH-9 Bypass, Gaur Cascades Rd, Anandibai Joshi Rd and local lanes, from OpenStreetMap)
  with their real lengths, but populations, shelters and capacities are invented. Scenarios
  A–F use a 7-road subset of the area's streets; G uses all of them.

## Project layout

```
backend/
  app/models/schemas.py        shared Pydantic contracts (mirrored in frontend/lib/schemas/types.ts)
  app/simulation/engine.py     tick loop: agent states, shelter admission, run_simulation()
  app/routing/                 graph + Dijkstra, capacity-aware assignment, congestion model
  app/simulation/cohort.py     the engine's rules applied to groups (exact, ~70x faster) for search and training
  app/simulation/dynamics.py   roads that flood mid-run and the detours people take
  app/optimization/search.py   simulated-annealing plan optimizer (shelter, route, wave, standby shelters, marshals)
  app/optimization/bounds.py   lower bound on clearance time (walking and road-capacity limits)
  app/optimization/planner.py  baseline vs optimized plan, verdict, trade-offs, evacuation orders
  app/ml/                      instant-estimate features, model (JSON trees) and prediction
  app/services/                scenario loading and CSV import, what-if overrides, validation,
                               run comparison, robustness ranges, weak points, saved plans, river level
  scripts/train_surrogate.py   generates simulated what-ifs and trains the estimate model
  app/live/                    live sources (NDMA, river, TomTom, demo), alert store, poller, WhatsApp/SMS
  app/api/                     FastAPI routes and structured errors
  tests/                       unit tests per module + tests/acceptance (end-to-end via the API)
frontend/
  components/views/            Overview, Live Simulation, Scenario Lab, Plan Comparison, Reports, Settings
  components/map/              Leaflet map, one file per layer, canvas layer for the replay
  components/alerts/           alert banner, alert cards, sources, recipients, sending
  lib/                         API client, state, replay math, findings, formatting
data/scenarios/                the seven scenarios (generated — edit data/build_scenarios.py)
data/network/                  the 7-road and the detailed (841-road) Raj Nagar Extension networks
data/river_gauges.json         river gauges; warning/danger levels left for the district to set
data/live_sources.json         what live data watches: NDMA issuers and places, TomTom road sections
data/hindon_glofas.json        Hindon flood flows from GloFAS history (python data/build_glofas_thresholds.py)
docker-compose.yml             backend + frontend, with volumes for planner data
.github/workflows/ci.yml       tests, lint, type check and Docker build on every push
docs/                          ASSUMPTIONS.md, DEMO_SCRIPT.md, and the implementation plans
```

The full shared API/data contracts and the workstream plans this was built from are in
`docs/plans/`.

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + version |
| GET | `/api/scenarios`, `/api/scenarios/{id}` | list / load scenarios |
| POST | `/api/scenarios/validate` | check a scenario file; field-level errors |
| POST | `/api/scenarios/import` | build a scenario from uploaded zone/shelter CSVs on an existing street network |
| POST | `/api/simulations/run` | run a scenario (optional `closedEdgeIds`, `unavailableShelterIds`, `edgeCapacityFactors`, `params`) |
| POST | `/api/optimization/plan` | baseline vs optimized plan: verdict, trade-offs, evacuation orders, robustness ranges |
| POST | `/api/simulations/compare` | metric-by-metric comparison of two runs |
| POST | `/api/predict` | instant estimate for a scenario plus what-if changes, with its own range |
| POST | `/api/analysis/weak-points` | rank each road and shelter by the damage of losing it |
| POST / GET | `/api/plans`, `/api/plans/{id}` | save a plan as a new version / list and read saved plans |
| POST | `/api/plans/{id}/approve` | record an approval (refused if the saved file was changed) |
| GET | `/api/plans/audit` | every save and approval, newest first |
| GET | `/api/river` | river gauges: latest level, status, flood-scenario suggestion |
| POST | `/api/river/{id}/reading`, `/api/river/{id}/thresholds` | record a level / set the district's levels |
| GET | `/api/alerts` | every alert, each live source's state, messaging and auto-send settings |
| POST | `/api/alerts/demo/start`, `/api/alerts/demo/stop` | the scripted flood-day demo |
| POST | `/api/alerts/{id}/acknowledge` | record who acknowledged an alert |
| GET / POST | `/api/alerts/{id}/send-preview`, `/api/alerts/{id}/send` | who would get it / send by WhatsApp or SMS |
| GET / POST / DELETE | `/api/alerts/recipients` | phone recipients (shown masked) |
| PUT | `/api/alerts/settings` | auto-send per severity (off by default) |
| GET | `/api/alerts/log` | every alert raised, cleared, acknowledged and sent |

Every error returns `{errorCode, message, field}` — never a bare stack trace.
