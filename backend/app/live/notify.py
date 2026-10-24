"""Sending alerts to officials' phones by SMS or WhatsApp, through Twilio.

Recipients' numbers are planner data: kept in the git-ignored alerts folder
and masked everywhere they are shown. Sending is a person's decision unless
auto-send is switched on for a severity; demo alerts are never auto-sent."""
from __future__ import annotations

import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from app.live.alerts import _LOCK, RANK, SEVERITIES, AlertStore, alerts_dir

CHANNELS = ("whatsapp", "sms")
_CHANNEL_NAME = {"sms": "SMS", "whatsapp": "WhatsApp"}
_SOURCE_NAME = {"ndma": "NDMA SACHET", "river": "river gauge", "glofas": "GloFAS flow forecast",
                "traffic": "TomTom traffic", "demo": "AEGIS demo"}
_SEVERITY_HI = {"info": "सूचना", "warning": "चेतावनी", "severe": "गंभीर", "extreme": "अत्यंत गंभीर"}
_IST = timezone(timedelta(hours=5, minutes=30))
_PHONE = re.compile(r"^\+\d{8,15}$")


class NotConfigured(RuntimeError):
    pass


class SendError(RuntimeError):
    pass


# -- recipients ----------------------------------------------------------

def _path():
    return alerts_dir() / "recipients.json"


def _raw() -> list[dict]:
    path = _path()
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def _write(recipients: list[dict]) -> None:
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps(recipients, ensure_ascii=False, indent=1), encoding="utf-8")


def mask(phone: str) -> str:
    rest = phone[3:]
    return f"{phone[:3]} {rest[:2]}{'•' * max(0, len(rest) - 5)}{rest[-3:]}"


def _public(r: dict) -> dict:
    return {**r, "phone": mask(r["phone"])}


def add_recipient(data: dict) -> dict:
    phone = re.sub(r"[\s-]", "", data.get("phone", ""))
    channels = [c for c in CHANNELS if c in data.get("channels", [])]
    if not _PHONE.match(phone):
        raise ValueError("Phone numbers need the country code, e.g. +919876543210")
    if not channels or not data.get("name", "").strip():
        raise ValueError("A recipient needs a name and at least one channel")
    if data.get("minSeverity", "severe") not in SEVERITIES:
        raise ValueError(f"minSeverity must be one of {', '.join(SEVERITIES)}")
    recipient = {"id": uuid.uuid4().hex[:12], "name": data["name"].strip(), "role": data.get("role", "").strip(),
                 "phone": phone, "channels": channels, "minSeverity": data.get("minSeverity", "severe")}
    with _LOCK:
        _write([*_raw(), recipient])
    return _public(recipient)


def list_recipients() -> list[dict]:
    return [_public(r) for r in _raw()]


def remove_recipient(recipient_id: str) -> bool:
    with _LOCK:
        recipients = _raw()
        kept = [r for r in recipients if r["id"] != recipient_id]
        _write(kept)
    return len(kept) < len(recipients)


# -- messages --------------------------------------------------------------

def configured() -> dict:
    account = bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN"))
    return {"sms": account and bool(os.environ.get("TWILIO_SMS_FROM")),
            "whatsapp": account and bool(os.environ.get("TWILIO_WHATSAPP_FROM"))}


def message(alert: dict) -> str:
    """Short enough for one WhatsApp message; English, then Hindi."""
    at = datetime.fromisoformat(alert["observedAt"]).astimezone(_IST).strftime("%H:%M") if alert.get("observedAt") else ""
    source = _SOURCE_NAME.get(alert["source"], alert["source"])
    action = alert.get("action")
    english = f"AEGIS [{alert['severity'].upper()}]: {alert['title'].rstrip('.')}. Source: {source}, {at} IST."
    if action:
        english += f" Next step: {action['label']} in AEGIS."
    hindi = f"AEGIS [{_SEVERITY_HI[alert['severity']]}]: {(alert.get('titleHi') or alert['title']).rstrip('.।')}। स्रोत: {source}, {at}।"
    if action:
        hindi += " अगला कदम AEGIS में देखें।"
    prefix = "AEGIS DEMO – NOT A REAL ALERT / डेमो – असली चेतावनी नहीं\n" if alert.get("isDemo") else ""
    return f"{prefix}{english}\n{hindi}"


def preview(alert: dict) -> list[dict]:
    """Every recipient and channel, and whether this alert would go to it."""
    ready = configured()
    sent = {(d["recipientId"], d["channel"]) for d in alert.get("deliveries", []) if d["status"] == "sent"}
    rows = []
    for r in _raw():
        for channel in r["channels"]:
            if not ready[channel]:
                reason = f"{_CHANNEL_NAME[channel]} is not configured"
            elif RANK[alert["severity"]] < RANK[r["minSeverity"]]:
                reason = f"below their minimum severity ({r['minSeverity']})"
            elif (r["id"], channel) in sent:
                reason = "already sent"
            else:
                reason = None
            rows.append({"recipientId": r["id"], "name": r["name"], "role": r["role"], "phone": mask(r["phone"]),
                         "channel": channel, "send": reason is None, "reason": reason})
    return rows


def twilio_send(channel: str, to: str, body: str) -> str:
    """Send one message; returns Twilio's message id."""
    sid, token = os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"]
    sender = os.environ["TWILIO_WHATSAPP_FROM" if channel == "whatsapp" else "TWILIO_SMS_FROM"]
    prefix = "whatsapp:" if channel == "whatsapp" else ""
    request = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        data=urllib.parse.urlencode({"From": prefix + sender, "To": prefix + to, "Body": body}).encode(),
        headers={"Authorization": "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode()},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())["sid"]
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read()).get("message", str(exc))
        except ValueError:
            detail = str(exc)
        if channel == "whatsapp" and "contentsid" in detail.lower():
            # WhatsApp allows free text only within 24 hours of the person's last message to us;
            # newer Twilio trials also refuse free text outright.
            raise SendError(f"WhatsApp only delivers free-text messages within 24 hours of the recipient's last "
                            f"message to {sender}: ask them to send any message to it, then send again. If it "
                            f"still fails, this Twilio trial allows only Twilio's sample templates: upgrade the "
                            f"account (Twilio: {detail})") from exc
        if "trial accounts can only use predefined" in detail.lower():
            raise SendError(f"This Twilio trial allows only Twilio's sample templates, not AEGIS's own text: "
                            f"upgrade the account (Twilio: {detail})") from exc
        raise SendError(f"Twilio: {detail}") from exc
    except OSError as exc:
        raise SendError(f"Twilio unreachable: {exc}") from exc


def send(store: AlertStore, alert_id: str, *, by: str,
         sender: Callable[[str, str, str], str] | None = None, now: datetime | None = None) -> list[dict]:
    """Send the alert to everyone the preview says should get it, once per
    recipient and channel. Returns the deliveries made now."""
    if not any(configured().values()):
        raise NotConfigured("Messaging is not configured: add the Twilio settings to backend/.env.local")
    now = now or datetime.now(timezone.utc)
    sender = sender or twilio_send
    alert = store.get(alert_id)
    body = message(alert)
    phones = {r["id"]: r["phone"] for r in _raw()}
    deliveries = []
    for row in preview(alert):
        if not row["send"]:
            continue
        delivery = {"recipientId": row["recipientId"], "name": row["name"], "phone": row["phone"],
                    "channel": row["channel"], "by": by, "at": now.isoformat(timespec="seconds")}
        try:
            delivery.update(status="sent", sid=sender(row["channel"], phones[row["recipientId"]], body))
        except Exception as exc:  # a failed number must not stop the others
            delivery.update(status="failed", error=str(exc))
        store.add_delivery(alert_id, delivery, now)
        deliveries.append(delivery)
    return deliveries


def auto_send(store: AlertStore, raised: list[dict], now: datetime) -> None:
    """Called by the poller with newly raised alerts. Only for severities an
    official switched on, never for demo alerts."""
    enabled = store.section("settings").get("autoSend", {})
    for alert in raised:
        if alert["isDemo"] or not enabled.get(alert["severity"]) or not any(configured().values()):
            continue
        try:
            send(store, alert["id"], by="auto-send", now=now)
        except Exception as exc:
            store.record_event("auto-send failed", now, alertId=alert["id"], error=str(exc))
