"""Match spoken addresses to real address points.

Used for neighbor nominations ("is there anyone else on your street who might not be able to leave?")
and for inbound callers whose number isn't on file. Existing households are tried first, then the OSM
address points for the area. A match needs a house number and a street that agree; anything weaker
stays flagged for the dispatcher with the reason, because sending a door team to the wrong house
costs time nobody has.
"""

import json
import re
from dataclasses import dataclass
from typing import Iterable

from rapidfuzz import fuzz

from .geo import meters_between
from .paths import OSM
from .spoken_numbers import digits_in, tokenize

DIRECTIONS = {
    "north": "north", "n": "north", "norte": "north",
    "south": "south", "s": "south", "sur": "south",
    "east": "east", "e": "east", "este": "east",
    "west": "west", "w": "west", "oeste": "west",
}
SUFFIXES = {
    "street": "street", "st": "street", "avenue": "avenue", "ave": "avenue", "av": "avenue", "avenida": "avenue",
    "drive": "drive", "dr": "drive", "road": "road", "rd": "road", "boulevard": "boulevard", "blvd": "boulevard",
    "place": "place", "pl": "place", "lane": "lane", "ln": "lane", "way": "way", "terrace": "terrace", "ter": "terrace",
    "court": "court", "ct": "court", "circle": "circle", "cir": "circle", "calle": "street", "camino": "road",
    "trail": "trail", "canyon": "canyon",
}
# Phrases that point at a home without naming it. They need the nominator's location and stay flagged.
RELATIVE = ("next door", "across the street", "behind", "al lado", "enfrente", "de enfrente", "vecina", "vecino", "neighbor")
STREET_MATCH_THRESHOLD = 86
# Same street name and number on both sides of a directional split (West vs East Mariposa) are told
# apart by the spoken direction, or by being this close to the nominator.
NEAR_NOMINATOR_METERS = 800


@dataclass(frozen=True)
class AddressPoint:
    number: str
    street: str  # as written, "West Mariposa Street"
    core: str  # "mariposa"
    direction: str | None
    lat: float
    lng: float
    household_id: str | None = None

    @property
    def label(self) -> str:
        return f"{self.number} {self.street}, Altadena"


@dataclass(frozen=True)
class Match:
    point: AddressPoint | None
    note: str | None  # why there's no match, for the dispatcher


def street_parts(street: str) -> tuple[str, str | None]:
    """'West Mariposa Street' -> ('mariposa', 'west'). Keeps names like 'La Vina Lane' whole."""
    tokens = tokenize(street)
    direction = None
    if tokens and tokens[0] in DIRECTIONS and len(tokens) > 1:
        direction = DIRECTIONS[tokens[0]]
        tokens = tokens[1:]
    while len(tokens) > 1 and tokens[-1] in SUFFIXES:
        tokens = tokens[:-1]
    return " ".join(tokens), direction


def parse_written(address: str) -> tuple[str, str] | None:
    """'486 West Mariposa Street, Altadena' -> ('486', 'West Mariposa Street')."""
    m = re.match(r"\s*(\d+[A-Za-z]?)\s+([^,]+)", address)
    return (m.group(1), m.group(2).strip()) if m else None


def point_from_written(address: str, lat: float, lng: float, household_id: str | None = None) -> AddressPoint | None:
    parsed = parse_written(address)
    if not parsed:
        return None
    core, direction = street_parts(parsed[1])
    return AddressPoint(parsed[0], parsed[1], core, direction, lat, lng, household_id)


class AddressBook:
    def __init__(self, points: Iterable[AddressPoint]):
        self.by_core: dict[str, list[AddressPoint]] = {}
        for point in points:
            self.by_core.setdefault(point.core, []).append(point)
        self.cores = sorted(self.by_core)

    @classmethod
    def from_osm(cls, path=OSM / "addresses.json") -> "AddressBook":
        rows = json.loads(path.read_text())
        points = []
        for row in rows:
            core, direction = street_parts(row["street"])
            points.append(AddressPoint(row["housenumber"], row["street"], core, direction, row["lat"], row["lng"]))
        return cls(points)

    @classmethod
    def from_households(cls, households: Iterable[dict]) -> "AddressBook":
        points = []
        for h in households:
            if h.get("lat") is None:
                continue
            point = point_from_written(h["address"], h["lat"], h["lng"], h["_id"])
            if point:
                points.append(point)
        return cls(points)

    def street_candidates(self, words: list[str]) -> list[tuple[str, float]]:
        """Street names that appear in the words right after a house number, best first."""
        window_words = words[:7]
        scored = []
        for core in self.cores:
            size = len(core.split())
            best = 0.0
            for start in range(0, max(len(window_words) - size + 1, 1)):
                window = " ".join(window_words[start : start + size])
                best = max(best, fuzz.ratio(core, window))
            if best >= STREET_MATCH_THRESHOLD:
                scored.append((core, best))
        return sorted(scored, key=lambda s: -s[1])

    def lookup(self, number: str, core: str) -> list[AddressPoint]:
        return [p for p in self.by_core.get(core, []) if p.number.lower() == number.lower()]


def spoken_direction(words: list[str]) -> str | None:
    for word in words[:7]:
        if word in DIRECTIONS and len(word) > 1:
            return DIRECTIONS[word]
    return None


def _pick(candidates: list[AddressPoint], direction: str | None, near: tuple[float, float] | None) -> Match:
    unique = {(p.number, p.street): p for p in candidates}
    options = list(unique.values())
    if direction:
        directed = [p for p in options if p.direction == direction]
        options = directed or options
    if len(options) > 1 and near:
        close = [p for p in options if meters_between(near, (p.lat, p.lng)) <= NEAR_NOMINATOR_METERS]
        options = close or options
    if len(options) == 1:
        return Match(options[0], None)
    names = " or ".join(sorted(f"{p.number} {p.street}" for p in options[:3]))
    return Match(None, f"two streets match: {names}")


def match(spoken: str, books: list[AddressBook], near: tuple[float, float] | None = None) -> Match:
    """Try each address book in order (households first, then OSM). First confident match wins."""
    numbers = digits_in(spoken)
    lowered = spoken.lower()
    if not numbers:
        if any(phrase in lowered for phrase in RELATIVE):
            return Match(None, "points at a neighbor without an address (next door, across the street)")
        return Match(None, "no house number")
    saw_street = False
    for book in books:
        for number, after in numbers:
            for core, _score in book.street_candidates(after):
                saw_street = True
                found = book.lookup(number, core)
                if found:
                    return _pick(found, spoken_direction(after), near)
    if saw_street:
        return Match(None, "street found but not that house number")
    return Match(None, "street not recognized in the area")
