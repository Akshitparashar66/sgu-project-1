# AEGIS — Adaptive Emergency Guidance & Intelligence System

Simulate the risk. Engineer the escape.

AEGIS is a prototype evacuation-planning and simulation tool (PS 021). Planners load a
scenario, simulate every evacuee moving through a road network to shelters, find the
congestion points and shelter shortfalls, try what-if changes (close a bridge, lose a
shelter), and compare the baseline plan against a computed alternative.

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

The frontend calls the API at `http://localhost:8000` (override with
`NEXT_PUBLIC_API_BASE_URL`). The backend allows CORS from `localhost:3000`; add other
origins comma-separated in `AEGIS_CORS_ORIGINS` before demoing from another host.

**Run the test suites:**
```bash
cd backend && python -m pytest      # simulation, routing, optimizer, API, acceptance
cd frontend && npm test             # vitest: formatting, replay math, components
```

## What this is

- **An agent-based evacuation simulator.** Every evacuee is an agent with a movement
  profile (standard / reduced mobility), a Dijkstra route over open roads, and a
  capacity-checked shelter assignment. A tick-based engine moves them, applies a documented
  capacity-ratio congestion model, and never lets a shelter exceed capacity.
- **A what-if lab.** Close any road or take any shelter offline (on the map or in the
  Scenario Lab) and re-run. Changes apply to a copy; scenario files are never modified.
- **A rule-based alternative-plan optimizer** (not machine learning). It load-balances
  shelter assignment across each evacuee's two nearest shelters, runs both plans through the
  same engine with the same seed, and says plainly when it cannot improve on the baseline.
- **An animated replay** of every evacuee, tick by tick, with live shelter occupancy and an
  arrivals-over-time chart — so bottlenecks are visible, not just reported.
- **Findings and reports** derived only from real run numbers: capacity shortfalls,
  bottleneck roads with routed headcount and delay, shelters that turned people away,
  hazard-exposed routes. Exportable as JSON.
- **Three synthetic scenarios:** normal conditions (A), a closed critical bridge (B), and a
  shelter-capacity shortage (C), in `data/scenarios/`.

## What this is not

- **Not a live emergency-response system.** It does not issue real evacuation instructions
  and must never be used that way.
- **Not validated against real human behavior.** Movement speeds, congestion penalties and
  the optimizer's heuristic are documented, simplified models — see `docs/ASSUMPTIONS.md`.
- **Not backed by machine learning.** Routing is Dijkstra; the optimizer is a greedy
  load-balancing heuristic. Neither is "AI-predicted" in the trained-model sense, and we
  don't describe them that way.
- **Not connected to any live feed.** All scenario data is synthetic and loaded from
  `data/scenarios/*.json`. The map's basemap is for orientation only; the road network
  drawn on it is schematic.

## Project layout

```
backend/
  app/models/schemas.py        shared Pydantic contracts (mirrored in frontend/lib/schemas/types.ts)
  app/simulation/engine.py     tick loop: agent states, shelter admission, run_simulation()
  app/routing/                 graph + Dijkstra, capacity-aware assignment, congestion model
  app/optimization/planner.py  alternative-plan heuristic with an honest feasibility verdict
  app/services/                scenario loading, what-if overrides, validation, run comparison
  app/api/                     FastAPI routes and structured errors
  tests/                       unit tests per module + tests/acceptance (end-to-end via the API)
frontend/
  components/views/            Overview, Live Simulation, Scenario Lab, Plan Comparison, Reports, Settings
  components/map/              Leaflet map, one file per layer, canvas layer for the replay
  lib/                         API client, state, replay math, findings, formatting
data/scenarios/                the three synthetic fixtures
docs/                          ASSUMPTIONS.md, DEMO_SCRIPT.md, and the implementation plans
```

The full shared API/data contracts and the workstream plans this was built from are in
`docs/superpowers/plans/`.

### API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + version |
| GET | `/api/scenarios`, `/api/scenarios/{id}` | list / load scenarios |
| POST | `/api/scenarios/validate` | check a scenario file; field-level errors |
| POST | `/api/simulations/run` | run a scenario (optional `closedEdgeIds`, `unavailableShelterIds`, `params`) |
| POST | `/api/optimization/plan` | baseline vs alternative plan, with verdict and trade-offs |
| POST | `/api/simulations/compare` | metric-by-metric comparison of two runs |

Every error returns `{errorCode, message, field}` — never a bare stack trace.
