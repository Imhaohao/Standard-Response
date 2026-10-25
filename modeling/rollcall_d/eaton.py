"""The night of the Eaton Fire in west Altadena, rebuilt from public records for the replay.

Records come from the UL FSRI Southern California Fires Timeline Dataset (dispatch logs, radio and body
camera transcripts, alert archives), doi:10.60752/102376.29905157. Order times come from the Citygate
investigation for LA County (May 2026). House numbers in the records are redacted to the block
("25** Porter Ave"), so every place here is a block, an intersection or a whole address.
"""

from __future__ import annotations

import csv
import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import networkx as nx

from .addresses import AddressBook, AddressPoint, street_parts
from .geo import meters_between
from .paths import DATA

PACIFIC = timezone(timedelta(hours=-8))
NIGHT_START = datetime(2025, 1, 7, 18, 0, tzinfo=PACIFIC)
NIGHT_END = datetime(2025, 1, 8, 12, 0, tzinfo=PACIFIC)
ROADS_FILE = DATA / "roads" / "altadena.json"

# Interpolating a block from its neighbors only when they are this close in house numbers.
MAX_INTERPOLATION_SPAN = 800
# With no neighbor on one side, the closest known house number on the same street stands in.
MAX_NEAREST_GAP = 300
STREET_TYPES = {"wy": "way"}


@dataclass(frozen=True)
class Record:
    row: int
    at: datetime
    source: str
    location: str
    text: str


@dataclass(frozen=True)
class Place:
    kind: str  # "block", "address" or "intersection"
    low: int | None
    high: int | None
    streets: tuple[str, ...]


@dataclass(frozen=True)
class Located:
    lat: float
    lng: float
    precision: str  # "block", "address", "interpolated" or "intersection"


def parse_time(day: str, clock: str) -> datetime | None:
    match = re.fullmatch(r"(\d+)/(\d+)/(\d{4})", day.strip())
    hours = re.fullmatch(r"(\d{1,2}):(\d{2})", clock.strip())
    if not match or not hours:
        return None
    month, date, year = (int(part) for part in match.groups())
    return datetime(year, month, date, int(hours.group(1)), int(hours.group(2)), tzinfo=PACIFIC)


def load_records(path: Path) -> list[Record]:
    """Rows inside the night, 6 p.m. Jan 7 to noon Jan 8, in the order FSRI sorted them."""
    with path.open(newline="") as handle:
        rows = list(csv.reader(handle))[1:]
    records = []
    for row_number, row in enumerate(rows, start=2):
        at = parse_time(row[1], row[2])
        if at and NIGHT_START <= at <= NIGHT_END:
            records.append(Record(row_number, at, row[0].strip(), row[4].strip(), row[6].strip()))
    return records


def clean_location(location: str) -> str:
    first = location.splitlines()[0] if location else ""
    first = re.sub(r"^(LOC|GEO)\s*:\s*", "", first.strip(), flags=re.IGNORECASE)
    first = first.split(",")[0]
    words = [STREET_TYPES.get(word.lower(), word) for word in first.split()]
    return " ".join(words).strip(" .")


def split_intersection(text: str) -> list[str]:
    parts = re.split(r"\s*/\s*|\s+and\s+|\s*&\s*", text, flags=re.IGNORECASE)
    return [part for part in parts if part]


def parse_place(location: str) -> Place | None:
    text = clean_location(location)
    if not text or text.lower().startswith("lat"):
        return None
    block = re.match(r"^(\d+)(\*+)\s+(.+)$", text)
    if block:
        scale = 10 ** len(block.group(2))
        low = int(block.group(1)) * scale
        return Place("block", low, low + scale - 1, (block.group(3),))
    address = re.match(r"^(\d+)[A-Za-z]?\s+(.+)$", text)
    if address:
        number = int(address.group(1))
        return Place("address", number, number, (address.group(2),))
    streets = split_intersection(text)
    return Place("intersection", None, None, tuple(streets)) if len(streets) == 2 else None


def _number(point: AddressPoint) -> int | None:
    digits = re.match(r"\d+", point.number)
    return int(digits.group()) if digits else None


def _mean(points: list[tuple[float, float]]) -> tuple[float, float]:
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


class Geocoder:
    """Places a record's location on the map from OSM address points and named street segments."""

    def __init__(self, book: AddressBook, roads: dict):
        self.book = book
        self.nodes = [tuple(node) for node in roads["nodes"]]
        self.nodes_by_core: dict[str, set[int]] = {}
        for edge in roads["edges"]:
            for name in _names(edge.get("name")):
                core = street_parts(name)[0]
                self.nodes_by_core.setdefault(core, set()).update((edge["u"], edge["v"]))

    def locate(self, place: Place) -> Located | None:
        if place.kind == "intersection":
            return self._intersection(place.streets)
        return self._on_street(place)

    def _street_points(self, street: str) -> list[tuple[int, AddressPoint]]:
        core, direction = street_parts(street)
        points = self.book.by_core.get(core, [])
        if direction:
            points = [p for p in points if p.direction in (direction, None)]
        return sorted(((n, p) for p in points if (n := _number(p)) is not None), key=lambda pair: pair[0])

    def _on_street(self, place: Place) -> Located | None:
        numbered = self._street_points(place.streets[0])
        inside = [(p.lat, p.lng) for n, p in numbered if place.low <= n <= place.high]
        if inside:
            return Located(*_mean(inside), "address" if place.kind == "address" else "block")
        target = (place.low + place.high) / 2
        return _interpolate(numbered, target) or _nearest_number(numbered, target)

    def _intersection(self, streets: tuple[str, ...]) -> Located | None:
        sets = [self.nodes_by_core.get(street_parts(street)[0], set()) for street in streets]
        shared = set.intersection(*sets) if all(sets) else set()
        if not shared:
            return None
        return Located(*_mean([self.nodes[i] for i in shared]), "intersection")


def _names(raw) -> list[str]:
    if isinstance(raw, list):
        return [str(name) for name in raw]
    return [str(raw)] if raw else []


def _interpolate(numbered: list[tuple[int, AddressPoint]], target: float) -> Located | None:
    below = [(n, p) for n, p in numbered if n <= target]
    above = [(n, p) for n, p in numbered if n >= target]
    if not below or not above:
        return None
    (n0, p0), (n1, p1) = below[-1], above[0]
    if n1 - n0 > MAX_INTERPOLATION_SPAN:
        return None
    share = 0.5 if n1 == n0 else (target - n0) / (n1 - n0)
    return Located(p0.lat + share * (p1.lat - p0.lat), p0.lng + share * (p1.lng - p0.lng), "interpolated")


def _nearest_number(numbered: list[tuple[int, AddressPoint]], target: float) -> Located | None:
    if not numbered:
        return None
    number, point = min(numbered, key=lambda pair: abs(pair[0] - target))
    return Located(point.lat, point.lng, "nearest") if abs(number - target) <= MAX_NEAREST_GAP else None


def load_geocoder() -> Geocoder:
    return Geocoder(AddressBook.from_osm(), json.loads(ROADS_FILE.read_text()))


# What a record says. Help requests are read by hand afterwards (data/eaton/help-requests.json keeps the
# reviewed list); these patterns only pick the candidates.
HELP = re.compile(
    r"unable to (evac|get out|leave|walk|move)|can'?t (get out|leave|evac|walk|move)|cannot (get out|evac|leave|walk)"
    r"|bed ?ridden|bed ?bound|wheel ?chair|non.?ambulatory|not mobile|immobile|disabled|stuck in (the )?(home|house)"
    r"|trapped|needs? (help )?evac|evac(uation)? (assist|help)|on oxygen|oxygen tank|walker|amputee|paraly|elderly",
    re.IGNORECASE,
)
FIRE = re.compile(
    r"on fire|house fire|structure fire|residential fire|fire in (the )?(back)?yard|fully involved|in flames|flames"
    r"|catching fire|caught fire|burning|engulfed|fire next door|fire to the house|fire at the house",
    re.IGNORECASE,
)


def says_help(record: Record) -> bool:
    return bool(HELP.search(record.text))


# Pre-midnight fires west of Lake were mostly power lines and trees blown into them (Citygate finding
# 12), not the fire front, so a sighting that is only about a line doesn't date the front's arrival.
POWER_ONLY = re.compile(r"power ?line|transformer|\bpole\b|\bwires?\b|line down", re.IGNORECASE)
HOME_FIRE = re.compile(r"house|home|structure|residen|roof|garage|yard|bldg|building|apartment|street|block|"
                       r"trees|brush|bushes|vegetation|fence|shed", re.IGNORECASE)


def says_fire(record: Record) -> bool:
    if not FIRE.search(record.text):
        return False
    return not POWER_ONLY.search(record.text) or bool(HOME_FIRE.search(record.text))


@dataclass(frozen=True)
class Sighting:
    at: datetime
    lat: float
    lng: float
    row: int


def first_fire_near(lat: float, lng: float, sightings: list[Sighting], radius_m: float) -> Sighting | None:
    near = [s for s in sightings if meters_between((lat, lng), (s.lat, s.lng)) <= radius_m]
    return min(near, key=lambda s: s.at) if near else None


class LakeAvenue:
    """Lake Avenue as drawn in OSM, to tell west of Lake (the 3:25 a.m. and later orders) from east."""

    def __init__(self, roads: dict):
        points = []
        for edge in roads["edges"]:
            if "Lake Avenue" in " ".join(_names(edge.get("name"))):
                points.extend(tuple(point) for point in edge.get("geometry") or [roads["nodes"][edge["u"]], roads["nodes"][edge["v"]]])
        self.points = sorted(points)

    def lng_at(self, lat: float) -> float:
        nearest = min(self.points, key=lambda point: abs(point[0] - lat))
        return nearest[1]

    def is_west(self, lat: float, lng: float) -> bool:
        return lng < self.lng_at(lat)


def road_network(roads: dict) -> nx.DiGraph:
    graph = nx.DiGraph()
    for edge in roads["edges"]:
        graph.add_edge(edge["u"], edge["v"], seconds=edge["seconds"])
    return graph


class DriveTimes:
    """Free-flow driving minutes from one place on the real road graph to anywhere else."""

    def __init__(self, roads: dict, origin: tuple[float, float]):
        self.nodes = [tuple(node) for node in roads["nodes"]]
        graph = road_network(roads)
        seconds = nx.single_source_dijkstra_path_length(graph, self.nearest(*origin), weight="seconds")
        self.minutes = {node: value / 60.0 for node, value in seconds.items()}

    def nearest(self, lat: float, lng: float) -> int:
        return min(range(len(self.nodes)), key=lambda i: (self.nodes[i][0] - lat) ** 2 + (self.nodes[i][1] - lng) ** 2)

    def to(self, lat: float, lng: float) -> float:
        return self.minutes.get(self.nearest(lat, lng), math.inf)
