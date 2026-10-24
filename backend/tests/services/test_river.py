import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def hindon(body: dict) -> dict:
    return next(g for g in body["gauges"] if g["id"] == "hindon")


def test_without_thresholds_a_reading_is_shown_but_never_classified():
    assert hindon(client.get("/api/river").json())["status"] == "no reading"
    body = client.post("/api/river/hindon/reading", json={"levelM": 205.1}).json()
    gauge = hindon(body)
    assert gauge["latest"]["levelM"] == 205.1 and gauge["latest"]["source"] == "manual"
    assert gauge["status"] == "thresholds not set" and gauge["suggestion"] is None


def test_crossing_the_warning_level_suggests_the_flood_scenario():
    client.post("/api/river/hindon/thresholds", json={"warningLevelM": 205.0, "dangerLevelM": 206.0})
    assert hindon(client.post("/api/river/hindon/reading", json={"levelM": 204.2}).json())["status"] == "normal"
    gauge = hindon(client.post("/api/river/hindon/reading", json={"levelM": 205.4}).json())
    assert gauge["status"] == "warning"
    assert gauge["suggestion"]["scenarioId"] == "scenario_d_hindon_flood"
    assert hindon(client.post("/api/river/hindon/reading", json={"levelM": 206.3}).json())["status"] == "danger"


def test_bad_thresholds_and_unknown_gauges_are_rejected():
    assert client.post("/api/river/hindon/thresholds", json={"warningLevelM": 206, "dangerLevelM": 205}).status_code == 422
    assert client.post("/api/river/yamuna/reading", json={"levelM": 1}).json()["errorCode"] == "GAUGE_NOT_FOUND"


def test_a_configured_feed_is_read_and_a_broken_one_never_breaks_the_page(monkeypatch):
    class Feed(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"gaugeId": "hindon", "levelM": 204.9, "observedAt": "2026-10-24T06:00:00+00:00"}).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Feed)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("AEGIS_RIVER_FEED_URL", f"http://127.0.0.1:{server.server_port}/")
        body = client.get("/api/river").json()
        assert body["feedConnected"] and body["feedError"] is None
        assert hindon(body)["latest"] == {"levelM": 204.9, "observedAt": "2026-10-24T06:00:00+00:00", "source": "feed"}
    finally:
        server.shutdown()

    monkeypatch.setenv("AEGIS_RIVER_FEED_URL", "http://127.0.0.1:9/nothing-here")
    body = client.get("/api/river").json()
    assert body["feedError"].startswith("River feed unavailable")
