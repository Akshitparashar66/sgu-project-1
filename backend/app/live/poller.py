"""When each live source is read, and what the Alerts page is told about it.

The demo and river sources are local and run on every alerts request. NDMA
and TomTom need the network: a background thread reads them, only with
AEGIS_LIVE=1. A failing source backs off (1, 2, then 5 min) and shows its
error; it never stops the others."""
from __future__ import annotations

import logging
import os
import threading
import urllib.request
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from app.live import notify
from app.live.alerts import AlertStore
from app.live.config import live_enabled, load_config
from app.live.sources import demo, glofas, ndma, traffic
from app.live.sources.river import river_alerts
from app.services.river import river_status

logger = logging.getLogger("aegis.live")
FETCH_TIMEOUT_S = 5
BACKOFF_S = (60, 120, 300)
_LABELS = {"ndma": "NDMA official alerts", "river": "River level", "glofas": "Hindon flow forecast (GloFAS)",
           "traffic": "TomTom traffic", "demo": "Flood-day demo"}


def _iso(at: datetime) -> str:
    return at.isoformat(timespec="seconds")


def fetch_url(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "AEGIS evacuation planner"})
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_S) as response:
        return response.read()


def _due(store: AlertStore, name: str, now: datetime) -> bool:
    nxt = store.section("sources").get(name, {}).get("nextPollAt")
    return nxt is None or datetime.fromisoformat(nxt) <= now


def _run(store: AlertStore, name: str, now: datetime, interval_s: int, read: Callable[[], tuple[list[dict], dict]],
         *, clears_when_absent: bool) -> None:
    """Read one source and store its alerts, recording success or failure."""
    previous = store.section("sources").get(name, {})
    try:
        alerts, extra = read()
    except Exception as exc:
        failures = previous.get("failures", 0) + 1
        wait = BACKOFF_S[min(failures, len(BACKOFF_S)) - 1]
        store.update_section("sources", {name: {**previous, "state": "unavailable", "lastCheckAt": _iso(now),
                                                "lastError": f"{type(exc).__name__}: {exc}"[:300], "failures": failures,
                                                "nextPollAt": _iso(now + timedelta(seconds=wait))}})
        logger.warning("live source %s failed: %s", name, exc)
        return
    for alert in alerts:
        alert.setdefault("observedAt", _iso(now))
    raised = store.merge(name, alerts, now, clears_when_absent=clears_when_absent)
    store.update_section("sources", {name: {**previous, **extra, "state": "connected", "lastCheckAt": _iso(now),
                                            "lastSuccessAt": _iso(now), "lastError": None, "failures": 0,
                                            "nextPollAt": _iso(now + timedelta(seconds=interval_s))}})
    notify.auto_send(store, raised, now)


def poll_due(store: AlertStore, now: datetime, *, network: bool, fetch: Callable[[str], bytes] = fetch_url) -> None:
    cfg = load_config()
    store.expire(now)

    running = store.section("demo")
    started = datetime.fromisoformat(running["startedAt"]) if running.get("running") else None
    store.merge("demo", demo.alerts_at(started, now, cfg["demo"]) if started else [], now, clears_when_absent=True)

    if _due(store, "river", now):
        _run(store, "river", now, cfg["river"]["intervalSeconds"], lambda: (river_alerts(river_status()), {}),
             clears_when_absent=True)

    if not (network and live_enabled()):
        return
    if _due(store, "ndma", now):
        def read_ndma():
            cache = store.section("cache").get("ndma", {})
            alerts = ndma.poll(cfg["ndma"], cache, fetch)
            store.update_section("cache", {"ndma": cache})
            return alerts, {}
        _run(store, "ndma", now, cfg["ndma"]["intervalSeconds"], read_ndma, clears_when_absent=False)

    if _due(store, "glofas", now):
        def read_glofas():
            reading, alerts = glofas.poll(cfg["glofas"], fetch, now.date())
            return alerts, {"forecast": {**reading, "observedAt": _iso(now)}}
        _run(store, "glofas", now, cfg["glofas"]["intervalSeconds"], read_glofas, clears_when_absent=True)

    key = os.environ.get("TOMTOM_API_KEY")
    viewed = store.section("cache").get("viewedAt")
    recently_viewed = viewed and now - datetime.fromisoformat(viewed) <= timedelta(seconds=cfg["traffic"]["onlyWhileViewedSeconds"])
    if key and recently_viewed and _due(store, "traffic", now):
        def read_traffic():
            readings, alerts = traffic.poll(cfg["traffic"], key, fetch)
            return alerts, {"readings": [{**r, "observedAt": _iso(now)} for r in readings]}
        _run(store, "traffic", now, cfg["traffic"]["intervalSeconds"], read_traffic, clears_when_absent=True)


def mark_viewed(store: AlertStore, now: datetime) -> None:
    store.update_section("cache", {"viewedAt": _iso(now)})


def start_demo(store: AlertStore, now: datetime) -> None:
    """Always from the beginning: a restart clears the previous run's demo alerts."""
    store.clear_source("demo", now, "demo restarted")
    store.replace_section("demo", {"running": True, "startedAt": _iso(now)})
    store.record_event("demo started", now)


def stop_demo(store: AlertStore, now: datetime) -> None:
    store.replace_section("demo", {"running": False, "startedAt": None})
    store.clear_source("demo", now, "demo stopped")
    store.record_event("demo stopped", now)


def sources_view(store: AlertStore) -> dict:
    stored = store.section("sources")
    live = live_enabled()
    off = {"state": "off", "reason": "Live data is off: set AEGIS_LIVE=1 in backend/.env.local"}
    view = {}
    for name in ("ndma", "river", "glofas", "traffic"):
        info = {"label": _LABELS[name], "state": "waiting", **stored.get(name, {})}
        if name != "river" and not live:
            info.update(off)
        elif name == "traffic" and not os.environ.get("TOMTOM_API_KEY"):
            info.update(state="not configured", reason="Add TOMTOM_API_KEY to backend/.env.local")
        elif name == "traffic" and info["state"] == "waiting":
            info["reason"] = "Checked every few minutes while someone has AEGIS open"
        if name == "glofas":
            info.setdefault("reason", "Model forecast for a ~5 km area, checked every 3 hours; not a gauge")
        view[name] = info
    running = store.section("demo")
    view["demo"] = {"label": _LABELS["demo"], "state": "running" if running.get("running") else "stopped",
                    "startedAt": running.get("startedAt")}
    return view


class Poller:
    """The background thread for network sources (AEGIS_LIVE=1 only)."""

    def __init__(self, every_s: float = 5.0):
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="aegis-live-poller", daemon=True)
        self._every = every_s

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                poll_due(AlertStore(), datetime.now(timezone.utc), network=True)
            except Exception:  # keep polling whatever happens
                logger.exception("live poll failed")
            self._stop.wait(self._every)
