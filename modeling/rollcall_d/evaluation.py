"""Persona eval: run every card against a POST /turn agent and grade the record field by field.

Reports accuracy separately for address, passenger count, mobility and assistance required (plus
can-leave and oxygen), correction success, escalations, and completion time, with 95% Wilson intervals.
"""

import json
import math
import statistics
import time
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .addresses import parse_written, street_parts
from .resident import Resident

MAX_TURNS = 30
GRADED_FIELDS = ["address", "peopleCount", "mobility", "assistanceRequired", "canLeave", "oxygen"]


class HttpAgent:
    def __init__(self, url: str, timeout: float = 30.0):
        self.url = url.rstrip("/") + ("" if url.rstrip("/").endswith("/turn") else "/turn")
        self.timeout = timeout

    def turn(self, body: dict) -> dict:
        request = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return json.loads(response.read())


@dataclass
class CardRun:
    card: dict
    transcript: list[dict] = field(default_factory=list)
    record: dict = field(default_factory=dict)
    done: bool = False
    turns: int = 0
    seconds: float = 0.0
    turn_ms: list[float] = field(default_factory=list)
    escalations: list[str] = field(default_factory=list)
    escalated_at: dict[str, int] = field(default_factory=dict)  # each escalation -> resident turns heard before it was raised
    nominations: list[str] = field(default_factory=list)
    guard_blocked: int = 0
    correction_said: bool = False
    error: str | None = None


def run_card(agent, card: dict, seed: int = 0, request_status: str | None = None, resident_factory=Resident) -> CardRun:
    run = CardRun(card)
    resident = resident_factory(card, seed)
    body = {"sessionId": f"{card['id']}-{uuid.uuid4().hex[:8]}", "language": card["language"], "text": ""}
    if card["direction"] == "outbound":
        body["address"] = card["address"]
    if request_status:
        body["requestStatus"] = request_status
    started = time.perf_counter()
    try:
        for _ in range(MAX_TURNS):
            t0 = time.perf_counter()
            response = agent.turn(body)
            run.turn_ms.append((time.perf_counter() - t0) * 1000)
            run.transcript.append({"speaker": "agent", "text": response["reply"], "requestStatus": request_status or "none"})
            run.record = response.get("record") or {}
            run.escalations = response.get("escalations") or []
            for kind in run.escalations:
                run.escalated_at.setdefault(kind, run.turns)
            run.nominations = response.get("nominations") or []
            run.guard_blocked += int(bool(response.get("guardBlocked")))
            if response.get("done"):
                run.done = True
                break
            resident.heard_step = response.get("step")
            said = resident.answer(response["reply"], run.record)
            run.transcript.append({"speaker": "resident", "text": said})
            body = {**body, "text": said}
            run.turns += 1
    except Exception as error:  # a failed card is reported, not fatal
        run.error = f"{type(error).__name__}: {error}"
    run.seconds = time.perf_counter() - started
    run.correction_said = resident.wrong_said
    return run


def _address_key(address: str | None) -> tuple[str, str] | None:
    parsed = parse_written(address or "")
    return (parsed[0], street_parts(parsed[1])[0]) if parsed else None


RIDE_FIELDS = {"peopleCount", "mobility", "assistanceRequired"}


def leaves_on_own(truth: dict) -> bool:
    """Says everyone can leave and has a car: the agent skips the household and needs questions by design
    (conversation.ts afterCanLeave), so those fields aren't graded."""
    return truth["canLeave"] == "yes" and truth["hasCar"]


def applicable(card: dict, name: str) -> bool:
    return name not in RIDE_FIELDS or not leaves_on_own(card["truth"])


def field_correct(run: CardRun, name: str) -> bool:
    if not applicable(run.card, name):
        return True
    truth, record = run.card["truth"], run.record
    if name == "address":
        return _address_key(record.get("address")) == _address_key(run.card["address"])
    if name == "oxygen":
        return ("oxygen" in (record.get("medical") or [])) == ("oxygen" in truth["medical"])
    if name == "assistanceRequired" and truth["mobility"] == "walks":
        return record.get(name) in (None, "none")
    return record.get(name) == truth[name]


def wilson(correct: int, total: int, z: float = 1.96) -> list[float]:
    if total == 0:
        return [0.0, 0.0]
    p = correct / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [round(max(center - half, 0.0), 3), round(min(center + half, 1.0), 3)]


def _rate(correct: int, total: int) -> dict:
    return {"correct": correct, "total": total, "accuracy": round(correct / total, 3) if total else None, "ci95": wilson(correct, total)}


def _percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(q * len(ordered)))], 1)


def _correction_landed(run: CardRun) -> bool:
    name = run.card["correction"]["field"]
    return field_correct(run, "oxygen" if name == "medical" else name)


EMERGENCY_TRAITS = {"flames", "medical"}


def _language_outcomes(runs: list[CardRun]) -> dict:
    """Spanish parity beyond field accuracy: all-fields, corrections, escalations and turn latency per language."""
    outcomes = {}
    for language in ("en", "es"):
        group = [r for r in runs if r.card["language"] == language]
        if not group:
            continue
        corrections = [r for r in group if r.card.get("correction") and r.correction_said]
        expected = [r for r in group if EMERGENCY_TRAITS & set(r.card.get("traits", []))]
        turn_ms = [ms for r in group for ms in r.turn_ms[1:]]
        outcomes[language] = {
            "cards": len(group),
            "allFieldsCorrect": _rate(sum(all(field_correct(r, n) for n in GRADED_FIELDS) for r in group), len(group)),
            "corrections": _rate(sum(_correction_landed(r) for r in corrections), len(corrections)),
            "escalations": _rate(sum(bool(EMERGENCY_TRAITS & set(r.escalations)) for r in expected), len(expected)),
            "latency": {"turnMsP50": _percentile(turn_ms, 0.5), "turnMsP95": _percentile(turn_ms, 0.95)},
        }
    return outcomes


def summarize(runs: list[CardRun], agent_label: str) -> dict:
    finished = [r for r in runs if r.error is None]
    fields = {}
    for name in GRADED_FIELDS:
        graded = [r for r in finished if applicable(r.card, name)]
        fields[name] = _rate(sum(field_correct(r, name) for r in graded), len(graded))
    by_language = {
        lang: {name: _rate(sum(field_correct(r, name) for r in group), len(group))["accuracy"] for name in GRADED_FIELDS}
        for lang in ("en", "es")
        if (group := [r for r in finished if r.card["language"] == lang])
    }
    traits = sorted({t for r in finished for t in r.card.get("traits", [])})
    by_trait = {}
    for trait in traits:
        group = [r for r in finished if trait in r.card.get("traits", [])]
        all_right = sum(all(field_correct(r, n) for n in GRADED_FIELDS) for r in group)
        by_trait[trait] = {"cards": len(group), "allFieldsCorrect": round(all_right / len(group), 3)}
    corrections = [r for r in finished if r.card.get("correction") and r.correction_said]
    corrected = sum(_correction_landed(r) for r in corrections)
    by_when = {}
    for when in ("next_turn", "readback", "second_voice"):
        group = [r for r in corrections if r.card["correction"]["when"] == when]
        by_when[when] = _rate(sum(_correction_landed(r) for r in group), len(group))
    expected = [r for r in finished if EMERGENCY_TRAITS & set(r.card.get("traits", []))]
    raised = sum(bool(EMERGENCY_TRAITS & set(r.escalations)) for r in expected)
    nominators = [r for r in finished if r.card.get("neighborAddress")]
    all_turn_ms = [ms for r in finished for ms in r.turn_ms[1:]]
    failures = [
        {"persona": r.card["id"], "field": name, "expected": r.card["address"] if name == "address" else r.card["truth"].get(name, r.card["truth"]["medical"]),
         "got": r.record.get("medical") if name == "oxygen" else r.record.get(name), "traits": r.card.get("traits", [])}
        for r in finished for name in GRADED_FIELDS if not field_correct(r, name)
    ]
    return {
        "label": "Text persona eval. Simulated residents from persona cards, not real riders.",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "agent": agent_label,
        "personas": len(runs),
        "completed": sum(r.done for r in finished),
        "errors": [{"persona": r.card["id"], "error": r.error} for r in runs if r.error][:20],
        "fields": fields,
        "allFieldsCorrect": _rate(sum(all(field_correct(r, n) for n in GRADED_FIELDS) for r in finished), len(finished)),
        "byLanguage": by_language,
        "byLanguageOutcomes": _language_outcomes(finished),
        "byTrait": by_trait,
        "corrections": {**_rate(corrected, len(corrections)), "byWhen": by_when},
        "escalations": {"expected": len(expected), "raised": raised},
        "nominations": {"expected": len(nominators), "captured": sum(bool(r.nominations) for r in nominators)},
        "completion": {
            "turnsMedian": statistics.median([r.turns for r in finished]) if finished else None,
            "turnsP95": _percentile([r.turns for r in finished], 0.95),
            "secondsMedian": round(statistics.median([r.seconds for r in finished]), 2) if finished else None,
            "secondsP95": _percentile([r.seconds for r in finished], 0.95),
        },
        "latency": {"turnMsP50": _percentile(all_turn_ms, 0.5), "turnMsP95": _percentile(all_turn_ms, 0.95)},
        "guardBlocked": sum(r.guard_blocked for r in finished),
        "failures": failures[:40],
    }


def run_all(agent, cards: list[dict], concurrency: int = 1, seed: int = 0) -> list[CardRun]:
    if concurrency <= 1:
        return [run_card(agent, card, seed) for card in cards]
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        return list(pool.map(lambda c: run_card(agent, c, seed), cards))
