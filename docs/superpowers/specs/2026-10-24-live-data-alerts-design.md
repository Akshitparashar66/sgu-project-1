# Live data and alerts: design

Date: 2026-10-24. Status: approved in conversation (sections 1–5) and built.

## Goal

Bring real, current conditions into AEGIS and turn them into alerts an official can see,
act on in one click, and send to phones, without ever changing a plan on their own.

## Sources (backend `app/live/sources/`)

| Source | What | How often | Becomes an alert when |
|---|---|---|---|
| NDMA SACHET | National CAP feed `rss_india.xml`; the CAP file of each item from an issuer in `data/live_sources.json` (IMD Lucknow, UP SDMA, CWC, IMD New Delhi) | 60 s | Headline or area mentions a watched place (Ghaziabad, Hindon, …). A nearby place (Gautam Buddha Nagar, Noida, …) gives an *info* alert. CAP severity maps Minor→info, Moderate→warning, Severe→severe, Extreme→extreme. Expires at CAP `expires`. |
| CWC via NDMA | CWC flood alerts name river, station, level, warning and danger level | with NDMA | A CWC alert naming a gauge's river records its level as a river reading (source "CWC via NDMA"). Thresholds are still only set by the district. |
| Hindon flow forecast (added after the first build) | GloFAS discharge for the ~5 km Hindon cell via Open-Meteo, 10-day forecast | 3 h | 7-day likely peak (ensemble median) above the cell's 2-, 5-, 20-year flows (232/457/750 m³/s, Gumbel over 1997–2025) → warning/severe/extreme; only the ensemble maximum above → info. A model, not a gauge; missed July 2023. |
| River | The existing gauge service (manual readings, optional `AEGIS_RIVER_FEED_URL`, CWC readings) | 30 s | Latest reading at warning (→ warning) or danger (→ severe). Cleared when the level drops. |
| TomTom traffic | Flow Segment Data at one point per covered section | 3 min, only while someone has the app open (an `/api/alerts` call in the last 2 min) | Current/free-flow speed < 0.5 (warning) or < 0.25 (severe), or TomTom reports the road closed (severe). Readings with confidence < 0.5 or snapped > 50 m from the query point are ignored. |
| Demo | Scripted flood day, ~2 min, off by default | on each alerts request | IMD heavy rain → river warning → river danger → jam on NH-9 Bypass (E1, E4). Every alert is marked DEMO. |

Measured on 2026-10-24: TomTom covers E1+E4 (NH-9 Bypass, one section) and E2+E3 (Gaur
Cascades Rd, one section). E5, E6, E7 are local lanes it does not cover (nearest match
200–1,000 m away); they get no traffic data.

## Alert

`{id, source, severity, title, titleHi, detail, area, observedAt, raisedAt, expiresAt,
status: active|acknowledged|expired, clearedReason, acknowledgement, link, isDemo,
action, deliveries}`. `id` is source + source id, so repeats update instead of duplicating.
`action = {label, scenarioId?, closedEdgeIds?, edgeCapacityFactors?}`. Stored in
`data/alerts/` (git-ignored) with an append-only `log.jsonl`.

## Road capacity what-if

New override `edgeCapacityFactors: {edgeId: 0.05–1}` beside `closedEdgeIds` and
`unavailableShelterIds`, accepted by run, optimize, predict, weak points and saved plans.
`apply_overrides` scales `capacity_per_tick` (`max(1, round(cap × f))`, as robustness
already does), so engine, cohort simulator, optimizer, bound and estimate all see it.
A traffic speed ratio is used as the share of the road's capacity left for people on
foot: an assumption, disclosed in ASSUMPTIONS.md. The estimate model is retrained with
reduced-capacity cases.

## Screens

- **Banner** on every page: most serious active, unacknowledged warning-or-worse alert;
  Apply / Acknowledge (needs a name, logged) / All alerts.
- **Alerts page** (nav, with count): list with filters, sources strip (connected / not
  configured / unavailable + last check), flood-day demo start/stop, recipients, send.
- **Map**: roads with a traffic alert get a pulsing outline and tooltip; river alerts
  mark the hazard area; NDMA alerts show as a corner badge, not a shape.
- **Apply**: loads the action's scenario if any, adds its closures/capacities to the
  Scenario Lab what-ifs, and shows "Live conditions applied from alert …". A plan saved
  afterwards records the alert ids in its fingerprint.

## Messages (`app/live/notify.py`)

Recipients (name, role, E.164 phone, SMS and/or WhatsApp, minimum severity) in git-ignored
`data/alerts/recipients.json`, masked on screen. Sending is manual by default with a
preview of who gets what; auto-send per severity is a switch, off by default, changed
with a name and logged. Demo alerts are never auto-sent and are prefixed "AEGIS DEMO – NOT
A REAL ALERT". Text in English and Hindi. Twilio REST API; without credentials the
button says "Not configured" and nothing is sent. One delivery per alert, recipient and
channel; each attempt logged with the Twilio id or error.

## Settings, failure and safety

Keys in `backend/.env.local` (loaded at startup, never committed; Docker reads it as an
optional `env_file`). Network sources run only with `AEGIS_LIVE=1`; tests never touch the
network. Each source has a 5 s timeout and backs off 1 → 2 → 5 min after errors; its
state and last error are shown. If the API is unreachable the banner says since when.
Keys never reach the browser.

## Testing

Backend: NDMA/CAP parsing on saved copies of real feed files, area filter, severity map,
expiry; CWC → river reading; river alerts; traffic mapping on saved TomTom responses;
demo timeline with a fake clock; dedupe, clear, acknowledge, log; notify with a fake
sender (text, masking, no double-send, not configured); capacity override through engine
and cohort (exact match kept), optimizer, predict, saved-plan fingerprint (old plans stay
intact). Frontend: banner priority and acknowledge, Alerts page, sources, apply → what-ifs,
capacity chips, map layer.
