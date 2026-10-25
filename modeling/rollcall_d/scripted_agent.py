"""A scripted stand-in for Track B's text agent, behind the same POST /turn shape.

Same steps and question lines as voice/agent/conversation.ts, but keyword rules instead of Claude read
the resident's words. It exists so the persona eval runs before the real endpoint has a key, and as a
floor: the real agent should beat it on every field.
"""

import re
from dataclasses import dataclass, field

from .addresses import AddressBook, match
from .agent_lines import lines_for, with_safety
from .spoken_numbers import digits_in, strip_accents

# Lines whose value is a function in voice/agent/lines/<language>.ts, as format strings.
FORMATTED = {
    "en": {
        "greet_out": "Hello{name}, this is 911 calling about the evacuation in Altadena. An evacuation warning covers your street. Are you at {address} right now?",
        "confirm_address": "I have {address}. Is that right?",
        "needs_on_file": "Our records say {on_file}. Is that still right? Does anyone need oxygen?",
        "people": lambda n: "one person" if n == 1 else f"{n} people", "at": "at {address}",
    },
    "es": {
        "greet_out": "Hola{name}, le llama el 911 por la evacuación en Altadena. Hay una advertencia de evacuación en su calle. ¿Está usted en {address} ahora mismo?",
        "confirm_address": "Tengo {address}. ¿Es correcto?",
        "needs_on_file": "Nuestros registros dicen que {on_file}. ¿Sigue siendo así? ¿Alguien necesita oxígeno?",
        "people": lambda n: "una persona" if n == 1 else f"{n} personas", "at": "en {address}",
    },
}
# Every other line, by its key in voice/agent/lines, so the stand-in says exactly what the real agent says.
FROM_AGENT = {
    "greet_in": "greetInbound", "ask_address": "askAddress", "address_escalated": "addressEscalated", "can_leave": "askCanLeave",
    "has_car": "askHasCar", "household": "askHousehold", "needs": "askNeeds", "assistance": "askAssistance",
    "chair_kind": "askChairKind", "readback_intro": "readbackIntro", "readback_q": "readbackQuestion", "fixed": "readbackFixed",
    "fix": "whatToFix", "neighbor": "askNeighbor", "leave_now": "leaveNow", "goodbye": "goodbye", "repeat": "repeatPrompt",
    "emergency": "emergency", "pets": "pets", "no_car": "noCar", "leaving": "leavingOnOwn", "by_car": "byCar",
    "mobility": "mobility", "assist": "assistance", "oxygen": "oxygen",
}


def _lines(language: str) -> dict:
    agent = lines_for(language)
    lines = {key: agent[source] for key, source in FROM_AGENT.items()}
    lines["waiting"] = with_safety(agent["waiting"], language)
    return {**lines, **FORMATTED[language]}


LINES = {language: _lines(language) for language in ("en", "es")}

STAGE_OF = {"ask_address": "confirm_address", "confirm_address": "confirm_address", "can_leave": "can_leave", "has_car": "can_leave",
            "household": "household", "needs": "needs", "chair_kind": "needs", "assistance": "needs", "readback": "readback", "fix": "readback",
            "neighbor": "close", "done": "close"}
LIMITED = {"walker", "manual_wheelchair", "power_wheelchair", "bedbound"}
ADDRESS_STEPS = {"ask_address", "confirm_address", "readback", "fix"}
LEAVE_STEPS = {"can_leave", "has_car", "readback", "fix"}
CORRECTING = re.compile(r"(actually|wait|i meant|sorry|that'?s not right|en realidad|espere|perdon|quise decir|no es cierto)")

# Yes or no at the start of any sentence, so a tangent before the answer doesn't hide it. Text is read without
# accents, so "si" counts as "sí" only standing alone ("Sí, es correcto"), never as "if" ("Si me promete...").
SENTENCE_START = r"(?:^|[.!?\u00bf\u00a1]\s*)\W*"
SI_ALONE = r"si(?=\s*(?:[,.!?]|$))"
YES = re.compile(SENTENCE_START + rf"(yes|yeah|yep|correct|that'?s right|right|{SI_ALONE}|claro|correcto|es correcto|exacto)\b")
NO = re.compile(SENTENCE_START + r"(no|nope|not really)\b(?!,? (we|i|todos|puedo|podemos|necesitamos|uso))")
REPEAT = re.compile(r"(what\?|say that again|can'?t hear|repeat|como\?|no le oigo|repetir)")
FLAMES = re.compile(r"(flames|fire is (here|at)|llamas|fuego (esta|en))")
MEDICAL = re.compile(r"(trouble breathing|can'?t breathe|chest pain|no puede respirar|dolor de pecho|heart attack)")
# Which kind of wheelchair: one that's pushed, or one with a motor (interpreter.ts says_chair_kind).
CHAIR_KIND = re.compile(r"(manual|push|power|electric|motor|battery|electrica|empuj|bateria)")
RIDE = re.compile(r"(someone coming|anyone coming|are they coming|va a venir|vienen por|come get me)")
NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6}


def _people(text: str) -> int | None:
    if re.search(r"(just me|only me|it'?s me alone|i live alone|solo yo|nada mas yo|vivo sola|vivo solo)", text):
        return 1
    m = re.search(r"\b(\d|one|two|three|four|five|six|dos|tres|cuatro|cinco|seis)\b (of us|people|personas)(?! (to|para) )", text)
    m = m or re.search(r"\b(somos|there are|we are|we're) (\d|two|three|four|five|six|dos|tres|cuatro|cinco|seis)\b", text)
    if not m:
        return None
    word = m.group(1) if m.group(1) in NUMBER_WORDS or m.group(1).isdigit() else m.group(2)
    return int(word) if word.isdigit() else NUMBER_WORDS[word]


def _mobility(text: str) -> str | None:
    rules = [(r"(bed|cama)", "bedbound"), (r"(power wheelchair|electric wheelchair|silla de ruedas electrica)", "power_wheelchair"),
             (r"(wheelchair|silla de ruedas)", "manual_wheelchair"), (r"(walker|andadera)", "walker"),
             (r"(can all walk|can walk|everyone walks|podemos caminar|puedo caminar)", "walks")]
    for pattern, value in rules:
        if re.search(pattern, text):
            return value
    return None


def _assistance(text: str) -> str | None:
    if re.search(r"(two people|two-person|dos personas)", text):
        return "two_person_lift"
    if re.search(r"(one person|someone to help|una persona)", text):
        return "one_person_assist"
    if re.search(r"(no help|we can manage|i can manage|no necesitamos ayuda|ninguna)", text):
        return "none"
    return None


def _can_leave(text: str) -> str | None:
    if re.search(r"(not sure|don'?t know|no se)", text):
        return "unsure"
    if re.search(r"(can'?t|cannot|no puedo|no podemos)", text):
        return "no"
    if re.search(rf"(yes|{SI_ALONE}).*(get out|leave|salir)|i can get out|puedo salir", text):
        return "yes"
    return None


def _has_car(text: str) -> bool | None:
    if re.search(r"(no car|don'?t have a car|no tengo carro|no tenemos carro)", text):
        return False
    if re.search(r"(my car|a car here|car i can use|tengo carro|hay un carro|someone can drive)", text):
        return True
    return None


def _oxygen(text: str) -> bool | None:
    if re.search(r"(no oxygen|no uso oxigeno|sin oxigeno)", text):
        return False
    if re.search(r"(oxygen|oxigeno)", text):
        return True
    return None


def interpret(utterance: str, book: AddressBook) -> dict:
    text = strip_accents(utterance.lower())
    if REPEAT.search(text) and not digits_in(utterance):
        # "Sorry, I can't hear you" asks for the question again; it answers nothing.
        return {"updates": {}, "answer": None, "emergency": None, "asksAboutRide": False, "wantsRepeat": True, "saysChairKind": False}
    updates: dict = {}
    for key, value in (("peopleCount", _people(text)), ("mobility", _mobility(text)), ("assistanceRequired", _assistance(text)),
                       ("canLeave", _can_leave(text))):
        if value is not None:
            updates[key] = value
    has_car = _has_car(text)
    if has_car is not None:
        updates["hasCar"] = has_car
    oxygen = _oxygen(text)
    if oxygen is not None:
        updates["medical"] = ["oxygen"] if oxygen else []
    if re.search(r"(dog|cat|perro|gato|mascota)", text):
        updates["pets"] = not re.search(r"(no pets|sin mascotas)", text)
    elif re.search(r"(no pets|sin mascotas)", text):
        updates["pets"] = False
    if digits_in(utterance):
        found = match(utterance, [book])
        if found.point:
            updates["address"] = found.point.label
    answer = "yes" if YES.search(text) else "no" if NO.search(text) else None
    emergency = "flames" if FLAMES.search(text) else "medical" if MEDICAL.search(text) else None
    return {"updates": updates, "answer": answer, "emergency": emergency, "asksAboutRide": bool(RIDE.search(text)),
            "wantsRepeat": False, "saysChairKind": bool(CHAIR_KIND.search(text))}


@dataclass
class ScriptedConversation:
    language: str
    book: AddressBook
    known_address: str | None = None
    on_file: dict = field(default_factory=dict)
    record: dict = field(default_factory=dict)
    step: str = "ask_address"
    tries: int = 0
    readbacks: int = 0
    chair_kind_known: bool = False  # "wheelchair" alone doesn't say whether it's a 400-pound battery chair
    escalations: list = field(default_factory=list)
    nominations: list = field(default_factory=list)

    def __post_init__(self):
        self.record = {k: v for k, v in self.on_file.items() if v}
        self.step = "confirm_address" if self.known_address else "ask_address"

    @property
    def lines(self):
        return LINES[self.language]

    @property
    def done(self):
        return self.step == "done"

    def start(self) -> str:
        if self.known_address:
            return self.lines["greet_out"].format(name="", address=self.known_address)
        return f"{self.lines['greet_in']} {self.lines['ask_address']}"

    def question(self) -> str:
        l, step = self.lines, self.step
        if step == "confirm_address":
            return l["confirm_address"].format(address=self.record.get("address") or self.known_address)
        if step == "needs" and self.record.get("mobility"):
            return l["needs_on_file"].format(on_file=l["mobility"][self.record["mobility"]])
        if step == "readback":
            return self.readback()
        return l[step] if step != "done" else l["goodbye"]

    def readback(self) -> str:
        l, r = self.lines, self.record
        leaving = r.get("canLeave") == "yes" and r.get("hasCar") is not False and not r.get("mobility")
        parts = [l["leaving"] if leaving else None, l["by_car"] if leaving and r.get("hasCar") else None,
                 l["people"](r["peopleCount"]) if "peopleCount" in r else None, l["mobility"].get(r.get("mobility")),
                 l["oxygen"] if "oxygen" in (r.get("medical") or []) else None, l["assist"].get(r.get("assistanceRequired")) if r.get("assistanceRequired") != "none" else None,
                 l["pets"] if r.get("pets") else None, l["no_car"] if r.get("hasCar") is False else None,
                 l["at"].format(address=r["address"]) if r.get("address") else None]
        summary = ", ".join(p for p in parts if p)
        return f"{l['readback_intro']} {summary[:1].upper()}{summary[1:]}. {l['readback_q']}"

    def needs_ride(self) -> bool:
        r = self.record
        if r.get("mobility") in LIMITED or "oxygen" in (r.get("medical") or []):
            return True
        return r.get("canLeave") in ("no", "unsure") or (r.get("canLeave") == "yes" and r.get("hasCar") is False)

    def hear(self, utterance: str) -> str:
        heard = interpret(utterance, self.book)
        if self.step == "neighbor":
            heard["updates"] = {}  # the answer is about someone else's home
        elif self.step not in ADDRESS_STEPS:
            heard["updates"].pop("address", None)
        if self.step not in LEAVE_STEPS and not CORRECTING.search(strip_accents(utterance.lower())):
            heard["updates"].pop("canLeave", None)  # "no se puede levantar" isn't an answer to "can you leave"
        changed = {k: v for k, v in heard["updates"].items() if self.record.get(k) != v}
        self.record.update(changed)
        if heard["saysChairKind"] and "mobility" in heard["updates"]:
            self.chair_kind_known = True
        urgent = []
        if heard["emergency"] and heard["emergency"] not in self.escalations:
            self.escalations.append(heard["emergency"])
            urgent.append(self.lines["emergency"])
        if self.step == "neighbor" and digits_in(utterance):
            self.nominations.append(utterance)
        extra = []
        if heard["wantsRepeat"]:
            nxt = self.step  # a request to repeat isn't a failed try
        else:
            nxt, extra = self._advance(heard, bool(changed))
            self.tries = self.tries + 1 if nxt == self.step else 0
        self.step = nxt
        ride = [self.lines["waiting"] if self.needs_ride() else self.lines["leave_now"]] if heard["asksAboutRide"] and not self.done else []
        closing = [self.lines["waiting"] if self.needs_ride() else self.lines["leave_now"], self.lines["goodbye"]] if self.done else [self.question()]
        return " ".join(urgent + extra + ride + closing)

    def _retry_or(self, fallback: str) -> str:
        return fallback if self.tries + 1 >= 2 else self.step

    def _advance(self, heard: dict, changed: bool) -> tuple[str, list[str]]:
        step, r = self.step, self.record
        if step in ("ask_address", "confirm_address"):
            if step == "confirm_address" and heard["answer"] == "yes":
                r.setdefault("address", self.known_address)
                return "can_leave", []
            if "address" in heard["updates"]:
                return "confirm_address", []
            if heard["answer"] == "no":
                return "ask_address", []
            if self.tries + 1 < 2:
                return step, []
            self.escalations.append("address_unconfirmed")
            return "can_leave", [self.lines["address_escalated"]]
        if step == "can_leave":
            if r.get("canLeave") == "yes":
                return ("has_car" if "hasCar" not in r else self._after_leave()), []
            return ("household" if r.get("canLeave") else self._retry_or("household")), []
        if step == "has_car":
            if "hasCar" not in r and heard["answer"]:
                r["hasCar"] = heard["answer"] == "yes"
            return (self._after_leave() if "hasCar" in r else self._retry_or("household")), []
        if step == "household":
            return ("needs" if "peopleCount" in r else self._retry_or("needs")), []
        if step == "needs":
            if heard["answer"] == "no" and "mobility" not in r:
                r["mobility"] = "walks"
            if "mobility" not in r:
                return self._retry_or("readback"), []
            return self._after_mobility(), []
        if step == "chair_kind":
            if heard["answer"] == "yes" and r["mobility"] == "manual_wheelchair":
                r["mobility"] = "power_wheelchair"
            settled = heard["answer"] in ("yes", "no") or r["mobility"] != "manual_wheelchair"
            if not settled and self.tries + 1 < 2:
                return "chair_kind", []
            self.chair_kind_known = True
            return self._after_mobility(), []
        if step == "assistance":
            if "assistanceRequired" not in r and heard["answer"] == "no":
                r["assistanceRequired"] = "none"
            return ("readback" if "assistanceRequired" in r else self._retry_or("readback")), []
        if step == "readback":
            self.readbacks += 1
            if self.readbacks >= 3:
                return "neighbor", []
            if changed:
                return self._after_fix(), [self.lines["fixed"]]
            return {"yes": "neighbor", "no": "fix"}.get(heard["answer"] or "", "readback"), []
        if step == "fix":
            return (self._after_fix(), [self.lines["fixed"]]) if changed else (self._retry_or("neighbor"), [])
        if step == "neighbor":
            return "done", []
        return "done", []

    def _after_fix(self) -> str:
        """After a correction, go back to the first thing the record is now missing (as conversation.ts nextMissing)."""
        r = self.record
        if not self.needs_ride():
            return "readback"
        if "peopleCount" not in r:
            return "household"
        if "mobility" not in r:
            return "needs"
        return self._after_mobility()

    def _needs_chair_kind(self) -> bool:
        """A wheelchair heard on this call with no kind said; the agency's file already says which kind (conversation.ts)."""
        mobility = self.record.get("mobility")
        return mobility == "manual_wheelchair" and mobility != self.on_file.get("mobility") and not self.chair_kind_known

    def _after_mobility(self) -> str:
        if self._needs_chair_kind():
            return "chair_kind"
        return "assistance" if self.record["mobility"] in LIMITED and "assistanceRequired" not in self.record else "readback"

    def _after_leave(self) -> str:
        """Residents leaving on their own still hear a short read-back, so a mistaken yes can be corrected."""
        return "household" if self.needs_ride() else "readback"


class ScriptedAgent:
    """In-process POST /turn: {sessionId, language, text, address?} -> {reply, stage, record, done, escalations, nominations, guardBlocked}."""

    def __init__(self, book: AddressBook | None = None):
        self.book = book or AddressBook.from_osm()
        self.sessions: dict[str, ScriptedConversation] = {}

    def turn(self, body: dict) -> dict:
        session_id = body["sessionId"]
        text = (body.get("text") or "").strip()
        conversation = self.sessions.get(session_id)
        parts = []
        if conversation is None:
            conversation = ScriptedConversation(body.get("language", "en") if body.get("language") == "es" else "en", self.book,
                                                body.get("address") or None, body.get("onFile") or {})
            self.sessions[session_id] = conversation
            parts.append(conversation.start())
        if text and not conversation.done:
            parts.append(conversation.hear(text))
        return {"reply": " ".join(parts), "stage": STAGE_OF[conversation.step], "record": dict(conversation.record), "done": conversation.done,
                "escalations": list(conversation.escalations), "nominations": list(conversation.nominations), "guardBlocked": False}
