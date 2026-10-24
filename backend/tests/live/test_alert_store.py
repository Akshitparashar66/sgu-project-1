from datetime import datetime, timedelta, timezone

import pytest

from app.live.alerts import AlertNotFound, AlertStore

T0 = datetime(2026, 10, 24, 9, 0, tzinfo=timezone.utc)


def alert(id_: str, severity: str = "warning", **extra) -> dict:
    return {"id": id_, "source": "traffic", "severity": severity, "title": f"{id_} {severity}", "detail": "",
            "area": "", "observedAt": T0.isoformat(), "isDemo": False, "action": None, **extra}


def test_a_new_alert_is_raised_once_and_repeats_only_update_it():
    store = AlertStore()
    assert [a["id"] for a in store.merge("traffic", [alert("t1")], T0, clears_when_absent=True)] == ["t1"]
    assert store.merge("traffic", [alert("t1", title="updated")], T0 + timedelta(minutes=3), clears_when_absent=True) == []
    [stored] = store.all()
    assert stored["status"] == "active" and stored["title"] == "updated" and stored["raisedAt"] == T0.isoformat()


def test_a_condition_that_clears_expires_its_alert_and_can_come_back():
    store = AlertStore()
    store.merge("traffic", [alert("t1")], T0, clears_when_absent=True)
    store.merge("traffic", [], T0 + timedelta(minutes=3), clears_when_absent=True)
    assert store.get("t1")["status"] == "expired" and store.get("t1")["clearedReason"] == "condition cleared"
    raised = store.merge("traffic", [alert("t1")], T0 + timedelta(minutes=6), clears_when_absent=True)
    assert [a["id"] for a in raised] == ["t1"] and store.get("t1")["status"] == "active"


def test_official_alerts_expire_at_their_own_time_not_when_they_leave_the_feed():
    store = AlertStore()
    expires = (T0 + timedelta(hours=3)).isoformat()
    store.merge("ndma", [alert("n1", expiresAt=expires, source="ndma")], T0, clears_when_absent=False)
    store.merge("ndma", [], T0 + timedelta(minutes=1), clears_when_absent=False)
    assert store.get("n1")["status"] == "active"
    store.expire(T0 + timedelta(hours=3, seconds=1))
    assert store.get("n1")["status"] == "expired" and store.get("n1")["clearedReason"] == "expired"
    # Still in the feed after expiring: not raised again.
    later = T0 + timedelta(hours=4)
    assert store.merge("ndma", [alert("n1", expiresAt=expires, source="ndma")], later, clears_when_absent=False) == []


def test_acknowledging_needs_a_name_is_logged_and_a_worse_update_raises_it_again():
    store = AlertStore()
    store.merge("traffic", [alert("t1")], T0, clears_when_absent=True)
    store.acknowledge("t1", by="SDM Sadar", note="police informed", now=T0 + timedelta(minutes=1))
    assert store.get("t1")["status"] == "acknowledged"
    assert store.get("t1")["acknowledgement"] == {"by": "SDM Sadar", "note": "police informed",
                                                  "at": (T0 + timedelta(minutes=1)).isoformat()}

    raised = store.merge("traffic", [alert("t1", severity="severe")], T0 + timedelta(minutes=4), clears_when_absent=True)
    assert [a["id"] for a in raised] == ["t1"] and store.get("t1")["status"] == "active"
    assert [e["event"] for e in store.log()][:3] == ["escalated", "acknowledged", "raised"]
    with pytest.raises(AlertNotFound):
        store.acknowledge("nope", by="x", note="", now=T0)


def test_most_serious_active_alerts_come_first():
    store = AlertStore()
    store.merge("traffic", [alert("w"), alert("s", "severe"), alert("i", "info")], T0, clears_when_absent=True)
    store.merge("ndma", [alert("x", "extreme", source="ndma")], T0, clears_when_absent=False)
    store.merge("traffic", [alert("s", "severe")], T0, clears_when_absent=True)  # w and i clear
    assert [(a["id"], a["status"]) for a in store.all()] == [("x", "active"), ("s", "active"), ("w", "expired"), ("i", "expired")]
