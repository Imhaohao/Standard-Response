"""Persona cards: simulated residents for the text eval, red-team set and usability tests.

A card's `truth` has the same shape as the `personas` table, so the eval grades the agent's record
field by field. `correction` says what the resident says first before correcting it (as in the table),
plus when and how. `traits` drive how the simulated resident talks.
"""

from typing import Literal, TypedDict

Mobility = Literal["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"]
Assistance = Literal["none", "one_person_assist", "two_person_lift"]

TRAITS = [
    "hard_of_hearing",  # asks for repeats, mishears once
    "partial_address",  # gives a street without a number first
    "panic",  # frightened, short answers, sometimes off topic
    "tangents",  # talks about other things before answering
    "second_voice",  # someone else in the room chimes in, often with a correction
    "asks_reassurance",  # keeps asking whether someone is coming
    "flames",  # can see flames: must escalate
    "medical",  # medical emergency: must escalate
    "nominates_neighbor",  # names a neighbor who may not be able to leave
]


class Truth(TypedDict):
    canLeave: Literal["yes", "no", "unsure"]
    peopleCount: int
    mobility: Mobility
    assistanceRequired: Assistance
    medical: list[str]
    pets: bool
    hasCar: bool


class Correction(TypedDict):
    field: str  # the field the resident first gets wrong
    firstSays: str  # JSON of the wrong value, as in the personas table
    when: Literal["next_turn", "readback", "second_voice"]


class Card(TypedDict, total=False):
    id: str
    name: str
    age: int
    language: Literal["en", "es"]
    direction: Literal["outbound", "inbound"]
    riderId: str | None
    address: str
    lat: float
    lng: float
    onFile: dict
    truth: Truth
    correction: Correction
    traits: list[str]
    neighborAddress: str
    card: str  # the human-readable card handed to a usability tester or a judge
