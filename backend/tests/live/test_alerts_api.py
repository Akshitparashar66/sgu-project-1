from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_with_live_data_off_the_sources_say_so_and_nothing_is_fetched():
    body = client.get("/api/alerts").json()
    assert body["alerts"] == [] and body["liveEnabled"] is False
    assert body["sources"]["ndma"]["state"] == "off" and body["sources"]["traffic"]["state"] == "off"
    assert body["messaging"] == {"sms": False, "whatsapp": False}
    assert body["traffic"]["notCovered"]["edgeIds"] == ["E5", "E6", "E7"]


def test_the_demo_runs_without_keys_and_its_alerts_can_be_acknowledged():
    body = client.post("/api/alerts/demo/start").json()
    assert body["demo"]["running"] and [a["id"] for a in body["alerts"]] == ["demo:imd-rain"]

    ack = client.post("/api/alerts/demo:imd-rain/acknowledge", json={"by": "Control room", "note": "seen"}).json()
    assert ack["status"] == "acknowledged"
    assert client.post("/api/alerts/demo:imd-rain/acknowledge", json={"by": ""}).status_code == 422
    assert client.post("/api/alerts/nope/acknowledge", json={"by": "x"}).json()["errorCode"] == "ALERT_NOT_FOUND"

    stopped = client.post("/api/alerts/demo/stop").json()
    assert not stopped["demo"]["running"]
    assert all(a["status"] == "expired" for a in stopped["alerts"])
    assert client.get("/api/alerts/log").json()[0]["event"] == "demo stopped"


def test_recipients_are_stored_masked_and_removable():
    added = client.post("/api/alerts/recipients", json={"name": "ADM", "phone": "+919876543210",
                                                       "channels": ["whatsapp"], "minSeverity": "severe"}).json()
    assert added["phone"] == "+91 98•••••210"
    assert client.post("/api/alerts/recipients", json={"name": "x", "phone": "123", "channels": ["sms"]}).status_code == 422
    assert [r["id"] for r in client.get("/api/alerts/recipients").json()] == [added["id"]]
    client.delete(f"/api/alerts/recipients/{added['id']}")
    assert client.get("/api/alerts/recipients").json() == []


def test_sending_without_twilio_is_refused_and_auto_send_needs_a_name():
    client.post("/api/alerts/demo/start")
    preview = client.get("/api/alerts/demo:imd-rain/send-preview").json()
    assert preview["message"].startswith("AEGIS DEMO – NOT A REAL ALERT")
    assert client.post("/api/alerts/demo:imd-rain/send", json={"by": "x"}).json()["errorCode"] == "MESSAGING_NOT_CONFIGURED"

    assert client.put("/api/alerts/settings", json={"autoSend": {"severe": True}, "by": ""}).status_code == 422
    settings = client.put("/api/alerts/settings", json={"autoSend": {"severe": True}, "by": "DM Ghaziabad"}).json()
    assert settings["autoSend"]["severe"] is True and settings["autoSend"]["extreme"] is False
    client.post("/api/alerts/demo/stop")
