import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.live import notify
from app.live.alerts import AlertStore
from app.live.config import load_config
from app.live.poller import mark_viewed, poll_due, sources_view, start_demo

FIXTURES = Path(__file__).parent / "fixtures"
CFG = load_config()
T0 = datetime(2026, 10, 23, 9, 0, tzinfo=timezone.utc)  # while the saved CWC alert was in force


def jammed_fetch(calls: list):
    """NDMA: the saved feed, every CAP file the (constructed) Hindon one.
    TomTom: a road through the point asked about, at 5 of 26 km/h."""
    flow = json.loads((FIXTURES / "tomtom_gaur_cascades_free_flow.json").read_text(encoding="utf-8"))

    def fetch(url: str) -> bytes:
        calls.append(url)
        if url == CFG["ndma"]["feedUrl"]:
            return (FIXTURES / "ndma_rss.xml").read_bytes()
        if "sachet" in url:
            return (FIXTURES / "cap_cwc_hindon_constructed.xml").read_bytes()
        if "open-meteo" in url:
            return (FIXTURES / "glofas_hindon_2026-10-24.json").read_bytes()
        lat, lon = (float(v) for v in url.split("point=")[1].split("&")[0].split(","))
        flow["flowSegmentData"].update(currentSpeed=5, coordinates={"coordinate": [
            {"latitude": lat - 0.001, "longitude": lon}, {"latitude": lat + 0.001, "longitude": lon}]})
        return json.dumps(flow).encode()
    return fetch


def test_network_sources_only_run_with_live_data_on(monkeypatch):
    store, calls = AlertStore(), []
    poll_due(store, T0, network=True, fetch=jammed_fetch(calls))
    assert calls == [] and sources_view(store)["ndma"]["state"] == "off"

    monkeypatch.setenv("AEGIS_LIVE", "1")
    monkeypatch.setenv("TOMTOM_API_KEY", "k")
    poll_due(store, T0, network=True, fetch=jammed_fetch(calls))
    assert not any("tomtom" in c for c in calls)  # nobody has the app open: traffic isn't checked
    assert sources_view(store)["ndma"]["state"] == "connected"
    assert {a["source"] for a in store.all()} == {"ndma"}
    forecast = sources_view(store)["glofas"]
    assert forecast["state"] == "connected" and forecast["forecast"]["thresholdsM3s"]["warning"] == 232

    mark_viewed(store, T0)
    poll_due(store, T0 + timedelta(seconds=5), network=True, fetch=jammed_fetch(calls))
    assert {a["id"] for a in store.all() if a["source"] == "traffic"} == {"traffic:nh9-bypass", "traffic:gaur-cascades"}
    assert len(sources_view(store)["traffic"]["readings"]) == 2


def test_a_failing_source_backs_off_and_shows_its_error(monkeypatch):
    monkeypatch.setenv("AEGIS_LIVE", "1")
    store, calls = AlertStore(), []

    def down(url: str) -> bytes:
        calls.append(url)
        raise TimeoutError("timed out")

    def ndma_calls() -> int:
        return sum("sachet" in c for c in calls)

    poll_due(store, T0, network=True, fetch=down)
    poll_due(store, T0 + timedelta(seconds=30), network=True, fetch=down)  # still backing off
    ndma = sources_view(store)["ndma"]
    assert ndma_calls() == 1 and ndma["state"] == "unavailable" and "timed out" in ndma["lastError"]
    assert sources_view(store)["glofas"]["state"] == "unavailable"  # each source fails on its own
    poll_due(store, T0 + timedelta(seconds=61), network=True, fetch=down)
    assert ndma_calls() == 2 and sources_view(store)["ndma"]["failures"] == 2


def test_auto_send_only_for_switched_on_severities_and_never_for_the_demo(monkeypatch):
    monkeypatch.setenv("AEGIS_LIVE", "1")
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACtest")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "t")
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "+14155238886")
    notify.add_recipient({"name": "ADM", "phone": "+919876543210", "channels": ["whatsapp"], "minSeverity": "info"})
    sent = []
    monkeypatch.setattr(notify, "twilio_send", lambda channel, to, body: sent.append(body) or "SM1")

    store = AlertStore()
    store.update_section("settings", {"autoSend": {"warning": True}})
    start_demo(store, T0)
    poll_due(store, T0, network=True, fetch=jammed_fetch([]))
    # Both watched NDMA items read as the Hindon CWC warning here: sent. The demo's IMD alert is
    # severe but a demo: not sent.
    assert len(sent) == 2 and all("Hindon" in body and "DEMO" not in body for body in sent)


def test_starting_the_demo_again_replays_it_from_the_beginning():
    store = AlertStore()
    start_demo(store, T0)
    poll_due(store, T0 + timedelta(seconds=95), network=False)
    start_demo(store, T0 + timedelta(minutes=10))
    poll_due(store, T0 + timedelta(minutes=10), network=False)
    open_alerts = [a for a in store.all() if a["status"] != "expired"]
    assert [a["id"] for a in open_alerts] == ["demo:imd-rain"]
    assert open_alerts[0]["raisedAt"] == (T0 + timedelta(minutes=10)).isoformat(timespec="seconds")
