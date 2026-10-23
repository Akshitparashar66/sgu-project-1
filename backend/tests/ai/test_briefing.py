from types import SimpleNamespace

from fastapi.testclient import TestClient
from google.genai import errors, types

import app.ai.llm as llm
from app.ai.briefing import unsupported_numbers
from app.main import app

client = TestClient(app)


class FakeModels:
    """Stands in for genai.Client().models: records every call, returns a canned answer."""

    def __init__(self, text="", parsed=None, finish_reason=types.FinishReason.STOP, block_reason=None,
                 errors_first: list[Exception] | None = None):
        self.text, self.parsed, self.finish_reason, self.block_reason = text, parsed, finish_reason, block_reason
        self.errors_first = list(errors_first or [])
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.errors_first:
            raise self.errors_first.pop(0)
        return SimpleNamespace(
            text=self.text if self.parsed is None else self.parsed.model_dump_json(), parsed=self.parsed,
            candidates=[SimpleNamespace(finish_reason=self.finish_reason)],
            prompt_feedback=SimpleNamespace(block_reason=self.block_reason) if self.block_reason else None,
        )


def use_fake_gemini(monkeypatch, **kwargs) -> FakeModels:
    models = FakeModels(**kwargs)
    monkeypatch.setattr(llm, "get_client", lambda: SimpleNamespace(models=models))
    return models


def no_gemini(monkeypatch):
    monkeypatch.setattr(llm, "get_client", lambda: None)


def test_without_ai_the_briefing_is_the_template_built_from_the_run(monkeypatch):
    no_gemini(monkeypatch)
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal"}).json()
    assert body["source"] == "template"
    run = client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal"}).json()
    assert f"{run['metrics']['evacuatedCount']} of 1500 evacuees reached a shelter" in body["text"]
    assert body["facts"]["baseline"]["unserved"] == run["metrics"]["unservedCount"]
    assert "not configured" in body["warnings"][0]


def test_template_names_the_what_if_conditions(monkeypatch):
    no_gemini(monkeypatch)
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal", "closedEdgeIds": ["E3"]}).json()
    assert "road E3" in body["text"]
    assert body["facts"]["whatIf"]["closedRoads"][0]["id"] == "E3"


def test_a_grounded_gemini_briefing_is_returned_as_is(monkeypatch):
    run = client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal"}).json()
    text = f"{run['metrics']['evacuatedCount']} of 1500 evacuees reached a shelter (S1)."
    models = use_fake_gemini(monkeypatch, text=text)
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal"}).json()
    assert body == {**body, "source": "gemini", "text": text, "warnings": []}
    call = models.calls[0]
    assert call["model"] == llm.MODELS[0]
    assert "<run_results>" in call["contents"]
    assert "Every number you write must appear in the JSON" in call["config"].system_instruction


def test_a_briefing_with_an_invented_number_is_replaced_by_the_template(monkeypatch):
    use_fake_gemini(monkeypatch, text="About 9876 people were evacuated.")
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal"}).json()
    assert body["source"] == "template"
    assert "9876" in body["warnings"][0]


def test_a_blocked_answer_falls_back_to_the_template(monkeypatch):
    use_fake_gemini(monkeypatch, text="", block_reason="SAFETY")
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal"}).json()
    assert body["source"] == "template"
    assert "declined" in body["warnings"][0]


def test_plan_briefing_includes_the_alternative_and_its_differences(monkeypatch):
    no_gemini(monkeypatch)
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_c_shelter_shortage", "includePlan": True}).json()
    alt = body["facts"]["alternative"]
    assert alt["verdict"] in {"improves on the baseline", "does not improve on the baseline"}
    assert "differencesFromBaseline" in alt
    assert "alternative plan" in body["text"]


def test_unknown_scenario_and_bad_overrides_are_structured_errors():
    assert client.post("/api/ai/briefing", json={"scenarioId": "nope"}).json()["errorCode"] == "SCENARIO_NOT_FOUND"
    response = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal", "closedEdgeIds": ["E99"]})
    assert response.status_code == 400 and response.json()["errorCode"] == "INVALID_OVERRIDE"


def test_number_check_allows_rounding_ids_and_small_counts():
    facts = {"peak": 1.8333, "evacuated": 742, "label": "NH-9 Bypass"}
    assert unsupported_numbers("742 evacuated; peak 1.8× on E3 near NH-9; two of 3 shelters", facts) == []
    assert unsupported_numbers("1,200 evacuated, peak 2.4", facts) == ["1200", "2.4"]


def test_an_overloaded_model_falls_through_to_the_next_one(monkeypatch):
    run = client.post("/api/simulations/run", json={"scenarioId": "scenario_a_normal"}).json()
    text = f"{run['metrics']['evacuatedCount']} of 1500 evacuees reached a shelter."
    overloaded = errors.ServerError(503, {"error": {"code": 503, "message": "high demand", "status": "UNAVAILABLE"}})
    models = use_fake_gemini(monkeypatch, text=text, errors_first=[overloaded])
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal"}).json()
    assert body["source"] == "gemini"
    assert [c["model"] for c in models.calls] == llm.MODELS[:2]


def test_a_rejected_key_is_reported_without_trying_other_models(monkeypatch):
    bad_key = errors.ClientError(403, {"error": {"code": 403, "message": "API key not valid", "status": "PERMISSION_DENIED"}})
    models = use_fake_gemini(monkeypatch, errors_first=[bad_key])
    body = client.post("/api/ai/briefing", json={"scenarioId": "scenario_a_normal"}).json()
    assert body["source"] == "template" and "key was rejected" in body["warnings"][0]
    assert len(models.calls) == 1


def test_status_reports_whether_ai_is_configured(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    assert client.get("/api/ai/status").json()["configured"] is False
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    assert client.get("/api/ai/status").json()["configured"] is True
    monkeypatch.setenv("AEGIS_AI_DISABLED", "1")
    assert client.get("/api/ai/status").json()["configured"] is False
