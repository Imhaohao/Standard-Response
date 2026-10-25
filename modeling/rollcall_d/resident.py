"""A simulated resident who answers the agent from a persona card.

It works out which question the agent just asked from the reply text (English or Spanish, matching
the voice agent's question lines), answers from the card's truth, and plays the card's traits: repeats for
hard of hearing, a partial address first, tangents, panic, a second voice, pushing for reassurance,
an emergency, a neighbor nomination, and the scripted correction. Deterministic for a given seed.
"""

import json
import random
import re

from .spoken_numbers import say_en, say_es, strip_accents

# Each question type, with phrases from the agent's lines (voice/agent/lines, both the question and its askAgain
# rewording) that identify it. The last one in the reply wins.
QUESTION_PATTERNS = {
    "neighbor": [r"anyone else on your street", r"alguien mas en su calle", r"anyone nearby who might need help", r"alguien cerca que tal vez"],
    "fix": [r"what should i change", r"que debo corregir", r"the part that's wrong", r"que parte esta mal"],
    "readback": [r"let me read that back", r"le confirmo lo que tengo", r"did i get all of that right", r"anote todo bien"],
    "confirm_address": [r"\bi have .{3,80}is that right", r"are you at .{3,80}right now", r"tengo .{3,80}es correcto", r"esta usted en .{3,80}ahora"],
    "ask_address": [r"what address", r"street address", r"en que direccion", r"la direccion donde",
                    r"what's the house number", r"cual es el numero de la casa", r"house number is often", r"numero de la casa suele"],
    "has_car": [r"car or someone", r"tiene carro", r"car you can use", r"carro que pueda usar"],
    "can_leave": [r"leave on their own", r"salir por su cuenta", r"get out and away", r"salir y alejarse"],
    "household": [r"how many people", r"cuantas personas"],
    "needs": [r"walker or a wheelchair", r"our records say", r"andadera o silla", r"nuestros registros", r"trouble walking", r"dificultad para caminar"],
    "oxygen": [r"anyone there need oxygen", r"alguien ahi necesita oxigeno"],
    "chair_kind": [r"kind with a motor", r"run on a battery", r"de las que tienen motor", r"funciona con bateria"],
    "assistance": [r"how much help", r"cuanta ayuda", r"one person helping, or would it take", r"harian falta dos personas"],
    "repeat": [r"say that again", r"didn't catch", r"me lo puede repetir", r"no le entendi"],
    "goodbye": [r"\bgoodbye\b", r"\badios\b"],
}


def classify(reply: str) -> str:
    text = strip_accents(reply.lower())
    best, position = "unknown", -1
    for kind, patterns in QUESTION_PATTERNS.items():
        for pattern in patterns:
            for m in re.finditer(pattern, text):
                if m.start() > position:
                    best, position = kind, m.start()
    return best


def _who(card: dict, language: str) -> str:
    """Who in the home has the mobility need, when it isn't the resident on the phone."""
    return ("my son" if card["age"] >= 75 else "my husband") if language == "en" else ("mi hijo" if card["age"] >= 75 else "mi esposo")


EN = {
    "canLeave": {"yes": "Yes, I can get out.", "no": "No, I can't get out on my own.", "unsure": "I don't know. I'm not sure how I'd get out."},
    "hasCar": {True: "Yes, there's a car here I can use.", False: "No, I don't have a car."},
    "people": lambda n: "It's just me." if n == 1 else f"There are {n} of us.",
    "pets": {True: " And my dog.", False: " No pets."},
    "mobility": {
        "walks": "No, we can all walk.", "walker": "{who} uses a walker.", "manual_wheelchair": "{who} uses a wheelchair.",
        "power_wheelchair": "{who} uses a power wheelchair.", "bedbound": "{who} can't get out of bed.",
    },
    "mobility_self": {
        "walks": "No, I can walk.", "walker": "I use a walker.", "manual_wheelchair": "I use a wheelchair.",
        "power_wheelchair": "I use a power wheelchair.", "bedbound": "I can't get out of bed.",
    },
    "oxygen": {True: " And I'm on oxygen.", False: " No oxygen."},
    "oxygen_only": {True: "Yes, I'm on oxygen.", False: "No, no oxygen."},
    "chair_kind": {True: "Yes, it has a motor.", False: "No, it's a manual one. We push it."},
    "assistance": {"none": "No help needed, we can manage.", "one_person_assist": "One person to help.", "two_person_lift": "It takes two people to lift."},
    "yes": "Yes, that's right.",
    "no_neighbor": "No, I don't think so.",
    "neighbor": "Yes, the lady at {address}. She can't drive.",
    "repeat": "Sorry, what? I can't hear you very well.",
    "wait": "Wait, actually, ",
    "no_prefix": "No, ",
    "second_voice": "(someone else in the room) Tell them I'm here too! ... Oh, sorry. ",
    "second_voice_other": "(someone else in the room) That's not right, tell them! ... Oh, sorry. ",
    "partial": "I'm on {street}, near the corner.",
    "address": "I'm at {address}.",
    "reassure": " Is someone coming to get me?",
    "panic": "Oh God, okay, okay. ",
    "tangent": "My daughter was supposed to call me last night and she never did. Anyway. ",
    "flames": " I can see flames on the hill behind the house!",
    "medical": " My husband is having trouble breathing.",
}
ES = {
    "canLeave": {"yes": "Sí, puedo salir.", "no": "No, no puedo salir sola.", "unsure": "No sé. No sé cómo saldría."},
    "hasCar": {True: "Sí, hay un carro aquí que puedo usar.", False: "No, no tengo carro."},
    "people": lambda n: "Solo yo." if n == 1 else f"Somos {say_es(n)}.",
    "pets": {True: " Y mi perro.", False: " Sin mascotas."},
    "mobility": {
        "walks": "No, todos podemos caminar.", "walker": "{who} usa andadera.", "manual_wheelchair": "{who} usa silla de ruedas.",
        "power_wheelchair": "{who} usa silla de ruedas eléctrica.", "bedbound": "{who} no se puede levantar de la cama.",
    },
    "mobility_self": {
        "walks": "No, puedo caminar.", "walker": "Uso andadera.", "manual_wheelchair": "Uso silla de ruedas.",
        "power_wheelchair": "Uso silla de ruedas eléctrica.", "bedbound": "No me puedo levantar de la cama.",
    },
    "oxygen": {True: " Y uso oxígeno.", False: " No uso oxígeno."},
    "oxygen_only": {True: "Sí, uso oxígeno.", False: "No, no uso oxígeno."},
    "chair_kind": {True: "Sí, tiene motor.", False: "No, es manual. La empujamos."},
    "assistance": {"none": "No necesitamos ayuda.", "one_person_assist": "Una persona que ayude.", "two_person_lift": "Se necesitan dos personas para levantarlo."},
    "yes": "Sí, es correcto.",
    "no_neighbor": "No, creo que no.",
    "neighbor": "Sí, la señora de {address}. Ella no maneja.",
    "repeat": "¿Cómo? No le oigo bien.",
    "wait": "Espere, en realidad, ",
    "no_prefix": "No, ",
    "second_voice": "(otra persona en el cuarto) ¡Diles que yo también estoy aquí! ... Ay, perdón. ",
    "second_voice_other": "(otra persona en el cuarto) ¡Eso no es cierto, díselo! ... Ay, perdón. ",
    "partial": "Estoy en la {street}, cerca de la esquina.",
    "address": "Estoy en el {address}.",
    "reassure": " ¿Alguien va a venir por mí?",
    "panic": "Ay Dios, está bien, está bien. ",
    "tangent": "Mi hija me iba a llamar anoche y nunca llamó. Bueno. ",
    "flames": " ¡Veo llamas en el cerro detrás de la casa!",
    "medical": " Mi esposo no puede respirar bien.",
}

QUESTION_FIELD = {"household": "peopleCount", "needs": "mobility", "chair_kind": "mobility", "oxygen": "medical",
                  "assistance": "assistanceRequired", "can_leave": "canLeave"}
FIELD_QUESTION = {"peopleCount": "household", "mobility": "needs", "medical": "needs", "assistanceRequired": "assistance", "canLeave": "can_leave"}


def spoken_address(address: str, language: str, rng: random.Random) -> str:
    street_part = address.split(",")[0]
    number, street = street_part.split(" ", 1)
    if rng.random() < 0.5:
        return street_part
    words = say_en(int(number)) if language == "en" else say_es(int(number))
    return f"{words} {street}"


class Resident:
    def __init__(self, card: dict, seed: int = 0):
        self.card = card
        self.truth = card["truth"]
        self.lang = card["language"]
        self.say = EN if self.lang == "en" else ES
        self.rng = random.Random(f"{card['id']}-{seed}")
        self.traits = set(card.get("traits", []))
        self.correction = card.get("correction")
        self.wrong_said = False
        self.corrected = False
        self.repeats_left = 2 if "hard_of_hearing" in self.traits else 0
        self.partial_given = False
        self.emergency_said = False
        self.turns = 0

    # ---- values the resident states (possibly the wrong first one) ----------------------------

    def _value(self, field: str):
        if self.correction and field == self.correction["field"] and not self.corrected:
            self.wrong_said = True
            return json.loads(self.correction["firstSays"])
        return self.truth[field]

    def _field_sentence(self, field: str, value) -> str:
        s, t = self.say, self.truth
        if field == "peopleCount":
            return s["people"](value) + s["pets"][t["pets"]]
        if field == "mobility":
            if t["peopleCount"] == 1:
                return s["mobility_self"][value]
            text = s["mobility"][value].format(who=_who(self.card, self.lang))
            return text[0].upper() + text[1:]
        if field == "medical":
            return s["oxygen"][bool(value)].strip()
        if field == "assistanceRequired":
            return s["assistance"][value]
        if field == "canLeave":
            return s["canLeave"][value]
        return ""

    def _needs_answer(self, reply: str) -> str:
        mobility = self._value("mobility")
        oxygen = bool(self._value("medical"))
        on_file = self.card.get("onFile", {}).get("mobility")
        records = re.search(r"our records say|nuestros registros", strip_accents(reply.lower()))
        if records and on_file == mobility:
            return self.say["yes"] + self.say["oxygen"][oxygen]
        return self._field_sentence("mobility", mobility) + self.say["oxygen"][oxygen]

    # ---- corrections --------------------------------------------------------------------------

    def _correction_due(self, kind: str) -> bool:
        if not self.correction or self.corrected or not self.wrong_said:
            return False
        return self.correction["when"] in ("next_turn", "second_voice") or kind in ("readback", "fix")

    def _correction_text(self) -> str:
        field = self.correction["field"]
        self.corrected = True
        if self.correction["when"] != "second_voice":
            prefix = self.say["wait"]
        else:
            # "I'm here too" only fits when the correction is about who's home
            prefix = self.say["second_voice" if field in ("peopleCount", "mobility", "assistanceRequired") else "second_voice_other"]
        text = self._field_sentence(field, self.truth[field])
        if field == "peopleCount" and self.truth["mobility"] != "walks":
            text += " " + self._field_sentence("mobility", self.truth["mobility"])
            if self.truth["assistanceRequired"] != "none":
                text += " " + self._field_sentence("assistanceRequired", self.truth["assistanceRequired"])
        return prefix + text[0].lower() + text[1:]

    def _readback_fix(self, record: dict) -> str | None:
        """A resident listening to the read-back corrects anything that's wrong."""
        if record.get("canLeave") is not None and record["canLeave"] != self.truth["canLeave"]:
            return self.say["no_prefix"] + self._field_sentence("canLeave", self.truth["canLeave"]).lower()
        checks = [("peopleCount", record.get("peopleCount")), ("mobility", record.get("mobility")),
                  ("assistanceRequired", record.get("assistanceRequired"))]
        for field, got in checks:
            if got is not None and got != self.truth[field] and not (field == "assistanceRequired" and self.truth["mobility"] == "walks"):
                return self.say["no_prefix"] + self._field_sentence(field, self.truth[field]).lower()
        has_oxygen = "oxygen" in (record.get("medical") or [])
        if has_oxygen != bool(self.truth["medical"]):
            return self.say["no_prefix"] + self._field_sentence("medical", self.truth["medical"]).lower()
        return None

    # ---- one turn -----------------------------------------------------------------------------

    def answer(self, reply: str, record: dict) -> str:
        self.turns += 1
        kind = classify(reply)
        if self.repeats_left and kind not in ("goodbye", "repeat") and self.rng.random() < 0.4:
            self.repeats_left -= 1
            return self.say["repeat"]
        if self._correction_due(kind):
            return self._decorate(self._correction_text(), kind)
        return self._decorate(self._answer_for(kind, reply, record), kind)

    def _answer_for(self, kind: str, reply: str, record: dict) -> str:
        s = self.say
        if kind == "ask_address":
            if "partial_address" in self.traits and not self.partial_given:
                self.partial_given = True
                return s["partial"].format(street=self.card["address"].split(",")[0].split(" ", 1)[1])
            return s["address"].format(address=spoken_address(self.card["address"], self.lang, self.rng))
        if kind in ("confirm_address", "repeat"):
            return s["yes"] if kind == "confirm_address" else s["address"].format(address=self.card["address"].split(",")[0])
        if kind == "can_leave":
            return self._field_sentence("canLeave", self._value("canLeave"))
        if kind == "has_car":
            return s["hasCar"][self.truth["hasCar"]]
        if kind == "household":
            return self._field_sentence("peopleCount", self._value("peopleCount"))
        if kind == "needs":
            return self._needs_answer(reply)
        if kind == "oxygen":
            return s["oxygen_only"][bool(self._value("medical"))]
        if kind == "chair_kind":
            # "uses a wheelchair" didn't say which kind; the answer is the chair the resident has described so far
            return s["chair_kind"][self._value("mobility") == "power_wheelchair"]
        if kind == "assistance":
            return self._field_sentence("assistanceRequired", self._value("assistanceRequired"))
        if kind in ("readback", "fix"):
            return self._readback_fix(record) or s["yes"]
        if kind == "neighbor":
            if "nominates_neighbor" in self.traits and self.card.get("neighborAddress"):
                return s["neighbor"].format(address=spoken_address(self.card["neighborAddress"], self.lang, self.rng))
            return s["no_neighbor"]
        return s["yes"]

    def _decorate(self, text: str, kind: str) -> str:
        s = self.say
        if "tangents" in self.traits and self.rng.random() < 0.3:
            text = s["tangent"] + text
        if "panic" in self.traits and self.rng.random() < 0.4:
            text = s["panic"] + text
        if not self.emergency_said and kind == "can_leave":
            for trait in ("flames", "medical"):
                if trait in self.traits:
                    self.emergency_said = True
                    text += s[trait]
        if "asks_reassurance" in self.traits and kind not in ("goodbye",) and self.rng.random() < 0.5:
            text += s["reassure"]
        return text
