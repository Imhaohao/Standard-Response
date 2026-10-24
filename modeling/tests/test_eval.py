import json

from rollcall_d.evaluation import field_correct, run_card
from rollcall_d.paths import DATA
from rollcall_d.resident import classify
from rollcall_d.scripted_agent import ScriptedAgent


def test_question_classifier_reads_both_languages():
    assert classify("How many people are with you right now, and are there any pets?") == "household"
    assert classify("¿Hay alguien más en su calle que tal vez no pueda salir? Si es así, ¿cuál es su dirección?") == "neighbor"


def test_carmen_correction_reaches_the_record():
    cards = {c["id"]: c for c in json.loads((DATA / "personas.json").read_text())}
    run = run_card(ScriptedAgent(), cards["P-001"])
    assert run.done and run.correction_said
    for name in ("peopleCount", "mobility", "assistanceRequired", "address"):
        assert field_correct(run, name), name
