import pytest


@pytest.fixture(autouse=True)
def isolated_imports(monkeypatch, tmp_path_factory):
    """Imported scenarios, saved plans, river readings and alerts go to
    throwaway folders, so tests never see or write a planner's real data."""
    monkeypatch.setenv("AEGIS_IMPORTED_DIR", str(tmp_path_factory.mktemp("imported")))
    monkeypatch.setenv("AEGIS_PLANS_DIR", str(tmp_path_factory.mktemp("plans")))
    monkeypatch.setenv("AEGIS_RIVER_STATE", str(tmp_path_factory.mktemp("river") / "state.json"))
    monkeypatch.delenv("AEGIS_RIVER_FEED_URL", raising=False)
    # Live data: alerts in a throwaway folder, and never the network or real keys.
    monkeypatch.setenv("AEGIS_ALERTS_DIR", str(tmp_path_factory.mktemp("alerts")))
    monkeypatch.setenv("AEGIS_NO_ENV_FILE", "1")
    for name in ("AEGIS_LIVE", "TOMTOM_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN",
                 "TWILIO_SMS_FROM", "TWILIO_WHATSAPP_FROM"):
        monkeypatch.delenv(name, raising=False)
