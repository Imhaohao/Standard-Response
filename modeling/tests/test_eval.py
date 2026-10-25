import json

from rollcall_d.agent_lines import lines_for
from rollcall_d.evaluation import field_correct, run_card
from rollcall_d.paths import DATA
from rollcall_d.resident import classify
from rollcall_d.scripted_agent import ScriptedAgent

# Each question the voice agent asks (voice/agent/lines), first wording and askAgain, and what the resident must hear.
AGENT_QUESTIONS = {
    "askAddress": "ask_address", "askCanLeave": "can_leave", "askHasCar": "has_car", "askHousehold": "household",
    "askPeople": "household", "askNeeds": "needs", "askOxygen": "oxygen", "askAssistance": "assistance",
    "askChairKind": "chair_kind", "whatToFix": "fix", "askNeighbor": "neighbor", "repeatPrompt": "repeat",
}
AGENT_ASKS_AGAIN = {
    "address": "ask_address", "canLeave": "can_leave", "hasCar": "has_car", "household": "household", "needs": "needs",
    "assistance": "assistance", "chairKind": "chair_kind", "readback": "readback", "fix": "fix", "neighbor": "neighbor",
}


def test_question_classifier_reads_both_languages():
    assert classify("How many people are with you right now, and are there any pets?") == "household"
    assert classify("Okay. What's the house number on Catherine Road?") == "ask_address"
    assert classify("¿Cuál es el número de la casa en Catherine Road?") == "ask_address"
    assert classify("¿Hay alguien más en su calle que tal vez no pueda salir? Si es así, ¿cuál es su dirección?") == "neighbor"


def test_every_agent_question_is_recognized_in_both_languages():
    for language in ("en", "es"):
        lines = lines_for(language)
        for key, kind in AGENT_QUESTIONS.items():
            assert classify(lines[key]) == kind, (language, key)
        for key, kind in AGENT_ASKS_AGAIN.items():
            assert classify(lines["askAgain"][key]) == kind, (language, "askAgain", key)


def test_a_wheelchair_of_no_stated_kind_gets_the_motor_question():
    cards = json.loads((DATA / "personas.json").read_text())
    for mobility in ("manual_wheelchair", "power_wheelchair"):
        card = next(c for c in cards if c["truth"]["mobility"] == mobility and c["truth"]["canLeave"] != "yes" and not c.get("correction") and not c.get("traits")
                    and not c.get("onFile", {}).get("mobility"))
        run = run_card(ScriptedAgent(), card)
        asked = any(classify(t["text"]) == "chair_kind" for t in run.transcript if t["speaker"] == "agent")
        assert asked == (mobility == "manual_wheelchair"), mobility
        assert field_correct(run, "mobility"), mobility


def test_carmen_correction_reaches_the_record():
    cards = {c["id"]: c for c in json.loads((DATA / "personas.json").read_text())}
    run = run_card(ScriptedAgent(), cards["P-001"])
    assert run.done and run.correction_said
    for name in ("peopleCount", "mobility", "assistanceRequired", "address"):
        assert field_correct(run, name), name
