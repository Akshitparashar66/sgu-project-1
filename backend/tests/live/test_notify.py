"""Sending alerts to phones, with a fake sender: nothing here reaches Twilio."""
from datetime import datetime, timezone

import pytest

from app.live import notify
from app.live.alerts import AlertStore

T0 = datetime(2026, 10, 24, 9, 0, tzinfo=timezone.utc)
RIVER = {"id": "river:hindon:danger", "source": "river", "severity": "severe", "isDemo": False,
         "title": "Hindon at danger level: 206.3 m (danger 206.0 m)", "titleHi": "हिंडन नदी खतरे के स्तर पर: 206.3 मी",
         "detail": "", "area": "Hindon", "observedAt": T0.isoformat(), "action": {"label": "Open flood scenario D"}}


@pytest.fixture
def twilio(monkeypatch):
    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "ACtest")
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "token")
    monkeypatch.setenv("TWILIO_WHATSAPP_FROM", "+14155238886")


def add_people():
    officer = notify.add_recipient({"name": "ADM Finance", "role": "Incident commander", "phone": "+919876543210",
                                    "channels": ["whatsapp", "sms"], "minSeverity": "warning"})
    warden = notify.add_recipient({"name": "Shelter warden", "role": "S2", "phone": "+919811122233",
                                   "channels": ["whatsapp"], "minSeverity": "extreme"})
    return officer, warden


def test_phone_numbers_are_masked_and_bad_numbers_refused():
    officer, _ = add_people()
    assert officer["phone"] == "+91 98•••••210"
    assert all("9876543210" not in str(r) for r in notify.list_recipients())
    with pytest.raises(ValueError):
        notify.add_recipient({"name": "x", "phone": "98765", "channels": ["sms"], "minSeverity": "info"})


def test_the_message_is_in_english_and_hindi_and_demo_ones_say_so():
    text = notify.message(RIVER)
    assert text.startswith("AEGIS [SEVERE]: Hindon at danger level") and "हिंडन नदी खतरे के स्तर पर" in text
    assert notify.message({**RIVER, "isDemo": True}).startswith("AEGIS DEMO – NOT A REAL ALERT")


def test_preview_shows_who_gets_what_and_why_not(twilio):
    officer, warden = add_people()
    rows = {(r["name"], r["channel"]): r for r in notify.preview(RIVER)}
    assert rows[("ADM Finance", "whatsapp")]["send"] is True
    assert rows[("ADM Finance", "sms")] == {**rows[("ADM Finance", "sms")], "send": False, "reason": "SMS is not configured"}
    assert rows[("Shelter warden", "whatsapp")]["reason"] == "below their minimum severity (extreme)"


def test_sending_records_each_delivery_once_and_logs_failures(twilio):
    add_people()
    store = AlertStore()
    store.merge("river", [RIVER], T0, clears_when_absent=True)
    sent = []

    def fake_sender(channel, to, body):
        sent.append((channel, to))
        return "SM123"

    first = notify.send(store, RIVER["id"], by="Control room", sender=fake_sender)
    again = notify.send(store, RIVER["id"], by="Control room", sender=fake_sender)
    assert sent == [("whatsapp", "+919876543210")]
    assert [d["status"] for d in first] == ["sent"] and again == []
    assert store.get(RIVER["id"])["deliveries"][0]["sid"] == "SM123"

    def failing(channel, to, body):
        raise notify.SendError("The 'To' number is not a valid WhatsApp sandbox participant")

    store.merge("river", [{**RIVER, "id": "river:hindon:other"}], T0, clears_when_absent=False)
    [failed] = notify.send(store, "river:hindon:other", by="Control room", sender=failing)
    assert failed["status"] == "failed" and "sandbox" in failed["error"]


def test_without_twilio_keys_nothing_is_sent():
    add_people()
    store = AlertStore()
    store.merge("river", [RIVER], T0, clears_when_absent=True)
    assert notify.configured() == {"sms": False, "whatsapp": False}
    with pytest.raises(notify.NotConfigured):
        notify.send(store, RIVER["id"], by="x", sender=lambda *a: pytest.fail("must not send"))


def test_whatsapps_24_hour_rule_is_explained(twilio, monkeypatch):
    import io
    import json
    import urllib.error

    def refuse(request, timeout):
        body = io.BytesIO(json.dumps({"code": 21656, "message": "ContentSid Required"}).encode())
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, body)

    monkeypatch.setattr(notify.urllib.request, "urlopen", refuse)
    with pytest.raises(notify.SendError) as exc_info:
        notify.twilio_send("whatsapp", "+919876543210", "hello")
    assert "within 24 hours" in str(exc_info.value) and "+14155238886" in str(exc_info.value)


def test_a_template_only_trial_is_explained(twilio, monkeypatch):
    import io
    import json
    import urllib.error

    def refuse(request, timeout):
        body = io.BytesIO(json.dumps({"message": "Invalid template name. Trial accounts can only use predefined SMS templates."}).encode())
        raise urllib.error.HTTPError(request.full_url, 400, "Bad Request", {}, body)

    monkeypatch.setenv("TWILIO_SMS_FROM", "+17372508034")
    monkeypatch.setattr(notify.urllib.request, "urlopen", refuse)
    with pytest.raises(notify.SendError) as exc_info:
        notify.twilio_send("sms", "+919876543210", "hello")
    assert "upgrade the account" in str(exc_info.value)
