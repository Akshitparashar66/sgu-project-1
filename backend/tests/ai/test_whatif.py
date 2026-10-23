from fastapi.testclient import TestClient

from app.ai.whatif import WhatIfInterpretation
from app.main import app
from tests.ai.test_briefing import no_gemini, use_fake_gemini

client = TestClient(app)


def ask(question: str, scenario_id: str = "scenario_a_normal", **extra) -> dict:
    return client.post("/api/ai/what-if", json={"scenarioId": scenario_id, "question": question, **extra}).json()


def interpretation(**fields) -> WhatIfInterpretation:
    defaults = dict(close_road_ids=[], reopen_road_ids=[], take_offline_shelter_ids=[],
                    bring_online_shelter_ids=[], interpretation="", unmatched=[])
    return WhatIfInterpretation(**{**defaults, **fields})


def test_gemini_interpretation_is_returned_with_unknown_ids_dropped(monkeypatch):
    models = use_fake_gemini(monkeypatch, parsed=interpretation(
        close_road_ids=["E3", "E42"], take_offline_shelter_ids=["S1"],
        interpretation="Close E3 and take S1 offline.", unmatched=["heavy rain"],
    ))
    body = ask("What if the Gaur Cascades link floods, the school camp shuts and it rains?")
    assert body["source"] == "gemini"
    assert body["closeEdgeIds"] == ["E3"]
    assert body["unavailableShelterIds"] == ["S1"]
    assert body["unmatched"] == ["heavy rain"]
    assert "E42" in body["warnings"][0]
    prompt = models.calls[0]["contents"]
    assert "<question>" in prompt and "North RNE School Camp" in prompt
    assert models.calls[0]["config"].response_schema is WhatIfInterpretation


def test_without_ai_ids_and_shelter_names_are_matched_by_keyword(monkeypatch):
    no_gemini(monkeypatch)
    body = ask("close e3 and lose the North RNE School Camp")
    assert body["source"] == "keywords"
    assert body["closeEdgeIds"] == ["E3"]
    assert body["unavailableShelterIds"] == ["S1"]


def test_keyword_fallback_understands_reopen(monkeypatch):
    no_gemini(monkeypatch)
    body = ask("reopen E3 and bring back S2")
    assert body["reopenEdgeIds"] == ["E3"] and body["restoreShelterIds"] == ["S2"]
    assert body["closeEdgeIds"] == [] and body["unavailableShelterIds"] == []


def test_keyword_fallback_reports_what_it_could_not_match(monkeypatch):
    no_gemini(monkeypatch)
    body = ask("what if it rains all night?")
    assert body["closeEdgeIds"] == [] and body["unmatched"] == ["what if it rains all night?"]


def test_a_road_closed_in_the_scenario_file_cannot_be_reopened(monkeypatch):
    use_fake_gemini(monkeypatch, parsed=interpretation(reopen_road_ids=["E3"]))
    body = ask("reopen the bridge", scenario_id="scenario_b_bridge_closure")
    assert body["reopenEdgeIds"] == []
    assert "scenario file" in body["warnings"][0]


def test_empty_question_and_unknown_scenario_are_rejected():
    assert client.post("/api/ai/what-if", json={"scenarioId": "scenario_a_normal", "question": ""}).status_code == 422
    assert ask("close E3", scenario_id="nope")["errorCode"] == "SCENARIO_NOT_FOUND"
