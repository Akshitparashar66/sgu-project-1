"""NDMA SACHET parsing, on saved copies of the real feed and CAP files
(fixtures/, fetched 2026-10-24). The Hindon CWC file is constructed from the
real Gandak one and says so."""
from datetime import datetime, timezone
from pathlib import Path

from app.live.config import load_config
from app.live.sources import ndma

FIXTURES = Path(__file__).parent / "fixtures"
CFG = load_config()["ndma"]


def read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_the_feed_lists_items_with_their_issuer():
    items = ndma.parse_feed(read("ndma_rss.xml"))
    assert [i["issuer"] for i in items] == ["IMD Lucknow", "CWC", "IMD Thiruvananthapuram"]
    assert all(i["guid"] and i["link"].startswith("https://sachet.ndma.gov.in/") for i in items)
    assert [i["issuer"] for i in items if ndma.watched_issuer(i, CFG)] == ["IMD Lucknow", "CWC"]


def test_a_cap_alert_keeps_both_languages_and_its_expiry():
    cap = ndma.parse_cap(read("cap_up_sdma_thunderstorm.xml"))
    assert cap["sender"] == "Uttar-Pradesh-SDMA" and cap["msgType"] == "Update"
    assert [i["language"].lower()[:2] for i in cap["infos"]] == ["en", "hi"]
    assert cap["infos"][0]["severity"] == "Severe"
    assert cap["infos"][0]["expires"] == datetime(2026, 10, 23, 14, 30, tzinfo=timezone.utc)


def test_an_alert_for_a_nearby_district_is_shown_as_information_only():
    item = {"guid": "1792755127217013", "issuer": "IMD Lucknow", "link": "https://sachet.ndma.gov.in/x"}
    alert = ndma.alert_from_cap(ndma.parse_cap(read("cap_up_sdma_thunderstorm.xml")), item, CFG)
    # Gautam Buddha Nagar (Noida) borders Ghaziabad: worth knowing, not worth a banner.
    assert alert["severity"] == "info" and alert["title"].startswith("Nearby")
    assert alert["id"] == "ndma:1792755127217013" and alert["source"] == "ndma"
    assert alert["titleHi"]  # the official Hindi text from the same CAP file
    assert alert["action"] is None and alert["isDemo"] is False


def test_an_alert_for_ghaziabad_keeps_its_cap_severity_and_offers_the_flood_scenario():
    item = {"guid": "1", "issuer": "CWC", "link": "https://sachet.ndma.gov.in/x"}
    alert = ndma.alert_from_cap(ndma.parse_cap(read("cap_cwc_hindon_constructed.xml")), item, CFG)
    assert alert["severity"] == "warning"  # CAP "Moderate"
    assert "Hindon" in alert["title"] and alert["area"].startswith("Hindon, Ghaziabad")
    assert alert["action"]["scenarioId"] == "scenario_d_hindon_flood"


def test_alerts_elsewhere_are_ignored():
    item = {"guid": "2", "issuer": "CWC", "link": "https://sachet.ndma.gov.in/x"}
    assert ndma.alert_from_cap(ndma.parse_cap(read("cap_cwc_gandak_flood.xml")), item, CFG) is None


def test_a_cwc_flood_alert_for_the_hindon_gives_a_river_reading():
    gauges = [{"id": "hindon", "river": "Hindon"}]
    reading = ndma.river_reading_from_cap(ndma.parse_cap(read("cap_cwc_hindon_constructed.xml")), gauges)
    assert reading == {"gaugeId": "hindon", "levelM": 205.10, "observedAt": datetime(2026, 10, 23, 4, 41, 37, tzinfo=timezone.utc),
                       "cwcWarningLevelM": 205.0, "cwcDangerLevelM": 206.0}
    assert ndma.river_reading_from_cap(ndma.parse_cap(read("cap_cwc_gandak_flood.xml")), gauges) is None


def test_polling_fetches_each_cap_file_once_and_records_cwc_readings(monkeypatch):
    feed = read("ndma_rss.xml")
    caps = {"1792755127217013": read("cap_up_sdma_thunderstorm.xml"), "1792730555445016": read("cap_cwc_hindon_constructed.xml")}
    fetched = []

    def fetch(url: str) -> bytes:
        fetched.append(url)
        if url == CFG["feedUrl"]:
            return feed
        return caps[url.rsplit("=", 1)[1]]

    readings = []
    monkeypatch.setattr(ndma, "record_river_reading", lambda **kw: readings.append(kw))
    cache: dict = {}
    first = ndma.poll(CFG, cache, fetch)
    second = ndma.poll(CFG, cache, fetch)

    assert sorted(a["id"] for a in first) == ["ndma:1792730555445016", "ndma:1792755127217013"]
    assert [a["id"] for a in second] == [a["id"] for a in first]
    assert len(fetched) == 2 + 2  # the feed twice, each watched CAP file once; Thiruvananthapuram never
    assert len(readings) == 1 and readings[0]["gauge_id"] == "hindon" and readings[0]["level_m"] == 205.10
