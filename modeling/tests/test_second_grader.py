import json
from types import SimpleNamespace

import pytest

from rollcall_d import second_grader as sg
from rollcall_d.honesty import Line


class FakeModels:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        if isinstance(self.reply, Exception):
            raise self.reply
        return SimpleNamespace(text=self.reply(contents) if callable(self.reply) else self.reply)


def fake_client(reply):
    return SimpleNamespace(models=FakeModels(reply))


def verdict(flag, quote="", reason="r"):
    return json.dumps({"impliesHelpComing": flag, "quote": quote, "reason": reason})


def row(id_, flag, quote=""):
    return {"id": id_, "status": "received", "text": f"line {id_}", "model": {"impliesHelpComing": flag, "quote": quote, "reason": ""}}


def test_grader_sends_rubric_status_and_text_and_parses_reply():
    client = fake_client(verdict(True, "we'll take care of you"))
    result = sg.GeminiGrader(client=client).grade(Line("a", "approved", "We'll take care of you.", "t"))
    assert result == {"impliesHelpComing": True, "quote": "we'll take care of you", "reason": "r"}
    model, contents, config = client.models.calls[0]
    assert model == sg.GEMINI_MODEL
    assert "Request status: approved" in contents and "We'll take care of you." in contents
    assert "no driver has accepted" in config.system_instruction
    assert config.response_mime_type == "application/json"
    assert "additionalProperties" not in config.response_json_schema


@pytest.mark.parametrize("text", [None, "", "not json", "[1]", "{}", '{"impliesHelpComing": "yes"}'])
def test_malformed_reply_is_a_declined_grade(text):
    assert sg.parse_verdict(text)["impliesHelpComing"] is None


def test_missing_optional_fields_default_to_empty():
    assert sg.parse_verdict('{"impliesHelpComing": false}') == {"impliesHelpComing": False, "quote": "", "reason": ""}


def test_api_error_is_a_declined_grade_not_a_crash():
    grader = sg.GeminiGrader(client=fake_client(RuntimeError("boom")))
    assert grader.grade(Line("a", "none", "x", "t"))["impliesHelpComing"] is None


def test_no_key_skips_the_grader(monkeypatch):
    monkeypatch.setattr(sg, "env_value", lambda *keys: None)
    assert sg.gemini_grader_or_none() is None
    assert sg.second_grade([Line("a", "none", "x", "t")], [row("a", True)], None) == {"grader": "gemini", "status": "gemini: not run (no key)"}


def test_key_builds_the_grader(monkeypatch):
    monkeypatch.setattr(sg, "env_value", lambda *keys: "k" if keys == ("GEMINI_API_KEY",) else None)
    monkeypatch.setattr("google.genai.Client", lambda api_key: SimpleNamespace(models=None, key=api_key))
    grader = sg.gemini_grader_or_none()
    assert grader.client.key == "k" and grader.model == sg.GEMINI_MODEL


@pytest.mark.parametrize("table, kappa", [
    ((10, 0, 0, 10), 1.0),      # perfect agreement
    ((20, 5, 10, 15), 0.4),     # textbook 2x2: observed .7, chance .5
    ((0, 10, 10, 0), -1.0),     # always disagree
    ((5, 5, 5, 5), 0.0),        # agreement at chance level
    ((0, 0, 0, 10), None),      # both always say no: chance agreement is 1
    ((0, 0, 0, 0), None),
])
def test_kappa_on_known_tables(table, kappa):
    assert sg.cohens_kappa(*table) == kappa


def test_compare_counts_agreement_both_flagged_and_disagreements():
    claude = [row("a", True, "on its way"), row("b", True), row("c", False), row("d", False), row("e", None)]
    gemini = [row("a", True), row("b", False, "q"), row("c", False), row("d", True), row("e", True)]
    result = sg.compare(claude, gemini)
    assert result["linesCompared"] == 4  # e: Claude declined, so left out
    assert result["table"] == {"bothFlag": 1, "onlyClaude": 1, "onlyGemini": 1, "neitherFlag": 1}
    assert result["agreement"]["agreed"] == 2 and result["agreement"]["rate"] == 0.5 and result["agreement"]["kappa"] == 0.0
    assert result["claude"]["flagged"] == 2 and result["gemini"]["flagged"] == 2
    assert result["bothFlagged"]["flagged"] == 1 and result["bothFlagged"]["rate"] == 0.25
    assert result["bothFlagged"]["rate"] <= min(result["claude"]["rate"], result["gemini"]["rate"])
    assert [d["id"] for d in result["disagreements"]] == ["b", "d"]
    assert result["disagreements"][0]["gemini"]["quote"] == "q"


def test_disagreements_list_stops_at_ten_but_counts_all():
    claude = [row(str(i), True) for i in range(15)]
    gemini = [row(str(i), False) for i in range(15)]
    result = sg.compare(claude, gemini)
    assert len(result["disagreements"]) == 10 and result["disagreementCount"] == 15


def test_second_grade_end_to_end_with_fake_client():
    lines = [Line("a", "none", "We will send someone", "t"), Line("b", "none", "Okay, got it", "t")]
    claude = [row("a", True), row("b", False)]
    client = fake_client(lambda contents: verdict("send someone" in contents))
    result = sg.second_grade(lines, claude, sg.GeminiGrader(client=client), votes=3)
    assert result["status"] == "ran" and result["agreement"]["rate"] == 1.0 and result["agreement"]["kappa"] == 1.0
    assert len(client.models.calls) == 6  # two unique lines, three votes each
