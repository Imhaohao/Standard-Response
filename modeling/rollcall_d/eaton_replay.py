"""Would calling every home that can't leave on its own have helped in west Altadena?

Each documented request for help (data/eaton/help-requests.json) is replayed with the system's own
rules: the call goes out when an alert covers the street, a paratransit van leaves when the household
says it needs one, and the pickup counts only if it is boarded before fire was documented within two
blocks of the home. Every number below is a stated assumption with its reason, written into the results.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from .addresses import street_parts
from .eaton import (
    DATA, PACIFIC, ROADS_FILE, DriveTimes, Geocoder, LakeAvenue, Located, Record, Sighting, first_fire_near,
    load_geocoder, load_records, parse_place, says_fire,
)
from .geo import meters_between

EATON = DATA / "eaton"
FIRE_RADIUS_M = 200.0
REACH_MINUTES = 4.0
APPROVE_MINUTES = 3.0
UNLOAD_MINUTES = 2.0
ACCESS_READY = datetime(2025, 1, 8, 4, 0, tzinfo=PACIFIC)
ORDER_WEST = datetime(2025, 1, 8, 3, 25, tzinfo=PACIFIC)
ORDER_CALAVERAS = datetime(2025, 1, 8, 5, 42, tzinfo=PACIFIC)
DEPOT = {"name": "Rose Bowl incident command post", "lat": 34.1613, "lng": -118.1676}
SHELTER = {"name": "Pasadena Convention Center", "lat": 34.1443, "lng": -118.1446}
BOARDING_MINUTES = {"bedbound": 20.0, "wheelchair": 10.0, "disabled": 10.0, "elderly": 5.0, "unknown": 5.0}

ASSUMPTIONS = [
    ("Fire at the home", f"the first documented fire within {FIRE_RADIUS_M:.0f} m (about two blocks), leaving out sightings that are only about power lines", "the records date fire by block, not by house; power-line fires before midnight were mostly not the fire front (Citygate finding 12)"),
    ("Reaching the household", f"{REACH_MINUTES:.0f} min after calls start", "households already known to need help are dialed first at about one call a second, and a call takes 2 to 4 minutes (dispatch/sim/constants.py)"),
    ("Approval and driver acceptance", f"{APPROVE_MINUTES:.0f} min", "a dispatcher approves the offer and a driver accepts it on their phone"),
    ("Vans", "AccessLA vans, available from 4:00 a.m., leaving the Rose Bowl incident command post", "AccessLA said it was ready by 4 a.m. and was never called (LAist); the command post moved to the Rose Bowl at 8:52 p.m. (Citygate Table 2)"),
    ("Driving", "free-flow times on the OpenStreetMap road graph (data/roads/altadena.json)", "closures and smoke would slow vans; the margins below show how much slack each pickup had"),
    ("Boarding", "20 min bedbound, 10 min wheelchair or disabled, 5 min elderly or unknown", "the boarding times in PLAN.md"),
    ("Order times west of Lake", "3:25 a.m., or 5:42 a.m. for the Calaveras zone", "the Calaveras boundary isn't public, so every request is scored against both"),
    ("Earlier trigger", "calls to every household west of Lake that can't leave start at the first fire reported west of Lake, and AccessLA is asked at the same moment", "the timeline dates that report to 10:50 p.m., four and a half hours before the order; calling only households that can't leave displaces nobody else, and the system's job is to call the agency with vans"),
    ("Two finish lines", "a pickup counts against the first time the household had to ask for help, and separately against the first fire documented within two blocks", "many requests already say 'house on fire' or 'fire in yard', so beating the first request means the van arrived before the danger reached the door; the two-block line also counts spot fires that the household outlasted"),
]


@dataclass(frozen=True)
class Request:
    id: str
    block: str
    category: str
    need: str
    people: int | None
    first_at: datetime
    rows: list[int]
    outcome: str
    where: Located | None


def at(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=PACIFIC)


def clock(moment: datetime | None) -> str | None:
    return moment.strftime("%Y-%m-%dT%H:%M") if moment else None


def place_request(raw: dict, geocoder: Geocoder) -> Located | None:
    manual = raw.get("place") or {}
    if "near" in manual:
        return geocoder.locate(parse_place(" / ".join(manual["near"])))
    if "street" in manual:
        nodes = geocoder.nodes_by_core.get(street_parts(manual["street"])[0], set())
        points = [geocoder.nodes[i] for i in nodes]
        return Located(sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points), "street") if points else None
    return geocoder.locate(parse_place(raw["block"]))


def load_requests(geocoder: Geocoder) -> list[Request]:
    raw = json.loads((EATON / "help-requests.json").read_text())["requests"]
    requests = []
    for item in raw:
        where = place_request(item, geocoder)
        if where is None and item["category"] == "cannot_leave":
            raise ValueError(f"could not place {item['id']} ({item['block']})")
        requests.append(Request(item["id"], item["block"], item["category"], item["need"], item.get("people"),
                                at(item["firstAt"]), item["rows"], item["outcome"], where))
    return requests


def fire_sightings(records: list[Record], geocoder: Geocoder) -> list[Sighting]:
    sightings = []
    for record in records:
        place = parse_place(record.location) if says_fire(record) else None
        where = geocoder.locate(place) if place else None
        if where:
            sightings.append(Sighting(record.at, where.lat, where.lng, record.row))
    return sightings


@dataclass(frozen=True)
class Pickup:
    calls_start: datetime
    reached: datetime
    van_leaves: datetime
    boarded: datetime


def pickup_for(request: Request, calls_start: datetime, drive: DriveTimes, vans_from: datetime = ACCESS_READY) -> Pickup:
    reached = calls_start + timedelta(minutes=REACH_MINUTES)
    van_leaves = max(vans_from, reached + timedelta(minutes=APPROVE_MINUTES))
    travel = drive.to(request.where.lat, request.where.lng)
    boarded = van_leaves + timedelta(minutes=travel + BOARDING_MINUTES[request.need])
    return Pickup(calls_start, reached, van_leaves, boarded)


def minutes_between(earlier: datetime, later: datetime | None) -> float | None:
    return None if later is None else (later - earlier).total_seconds() / 60.0


def first_fire_west(sightings: list[Sighting], lake: LakeAvenue) -> Sighting:
    return min((s for s in sightings if lake.is_west(s.lat, s.lng)), key=lambda s: s.at)


def scenario_row(pickup: Pickup, request: Request, fire: Sighting | None) -> dict:
    before_ask = minutes_between(pickup.boarded, request.first_at)
    before_fire = minutes_between(pickup.boarded, fire.at if fire else None)
    return {
        "callsStart": clock(pickup.calls_start),
        "reached": clock(pickup.reached),
        "vanLeaves": clock(pickup.van_leaves),
        "boarded": clock(pickup.boarded),
        "minutesBeforeTheyAsked": round(before_ask),
        "beforeTheyAsked": before_ask >= 0,
        "minutesBeforeFireNearby": None if before_fire is None else round(before_fire),
        "beforeFireNearby": None if before_fire is None else before_fire >= 0,
    }


def unplaced_row(request: Request) -> dict:
    return {
        "id": request.id, "block": request.block, "category": request.category, "need": request.need,
        "people": request.people, "lat": None, "lng": None, "placedBy": None,
        "firstAskedForHelp": clock(request.first_at), "outcomeThatNight": request.outcome, "rows": request.rows,
    }


def placed_row(request: Request, sightings: list[Sighting]) -> dict:
    fire = first_fire_near(request.where.lat, request.where.lng, sightings, FIRE_RADIUS_M)
    row = unplaced_row(request)
    row.update(lat=round(request.where.lat, 5), lng=round(request.where.lng, 5), placedBy=request.where.precision,
               fireDocumentedNearby=clock(fire.at if fire else None))
    return row


def replay_request(request: Request, sightings: list[Sighting], drive: DriveTimes, trigger: datetime) -> dict:
    if request.where is None or request.category != "cannot_leave":
        return unplaced_row(request) if request.where is None else placed_row(request, sightings)
    fire = first_fire_near(request.where.lat, request.where.lng, sightings, FIRE_RADIUS_M)
    early = min(trigger, request.first_at)
    scenarios = {
        "order325": pickup_for(request, ORDER_WEST, drive),
        "order542": pickup_for(request, ORDER_CALAVERAS, drive),
        "firstFireWestOfLake": pickup_for(request, early, drive, vans_from=early),
    }
    return {
        "id": request.id,
        "block": request.block,
        "category": request.category,
        "need": request.need,
        "people": request.people,
        "lat": round(request.where.lat, 5),
        "lng": round(request.where.lng, 5),
        "placedBy": request.where.precision,
        "firstAskedForHelp": clock(request.first_at),
        "fireDocumentedNearby": clock(fire.at if fire else None),
        "fireRow": fire.row if fire else None,
        "driveMinutesFromDepot": round(drive.to(request.where.lat, request.where.lng), 1),
        "outcomeThatNight": request.outcome,
        "rows": request.rows,
        "replay": {name: scenario_row(pickup, request, fire) for name, pickup in scenarios.items()},
    }


def median(values: list[float]) -> float | None:
    ordered = sorted(values)
    return ordered[len(ordered) // 2] if ordered else None


def summarize(rows: list[dict], scenario: str) -> dict:
    runs = [row["replay"][scenario] for row in rows if "replay" in row]
    with_fire = [run for run in runs if run["beforeFireNearby"] is not None]
    return {
        "households": len(runs),
        "beforeTheyAsked": sum(run["beforeTheyAsked"] for run in runs),
        "medianMinutesBeforeTheyAsked": median([run["minutesBeforeTheyAsked"] for run in runs]),
        "withFireDocumentedNearby": len(with_fire),
        "beforeFireNearby": sum(run["beforeFireNearby"] for run in with_fire),
    }


def asked_before_order(rows: list[dict]) -> int:
    return sum(1 for row in rows if at(row["firstAskedForHelp"]) < ORDER_WEST)


def build() -> dict:
    geocoder = load_geocoder()
    records = load_records(EATON / "fsri-timeline-eaton.csv")
    sightings = fire_sightings(records, geocoder)
    roads = json.loads(ROADS_FILE.read_text())
    drive = DriveTimes(roads, (DEPOT["lat"], DEPOT["lng"]))
    requests = load_requests(geocoder)
    lake = LakeAvenue(roads)
    first_west = first_fire_west(sightings, lake)
    rows = [replay_request(request, sightings, drive, first_west.at) for request in requests]
    cannot_leave = [row for row in rows if row["category"] == "cannot_leave"]
    return {
        "label": "Replay of documented requests, not a prediction",
        "generatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "assumptions": [{"name": n, "value": v, "why": w} for n, v, w in ASSUMPTIONS],
        "depot": DEPOT,
        "cannotLeave": {
            "households": len(cannot_leave),
            "askedBeforeTheWestOrder": asked_before_order(cannot_leave),
            "order325": summarize(cannot_leave, "order325"),
            "order542": summarize(cannot_leave, "order542"),
            "firstFireWestOfLake": summarize(cannot_leave, "firstFireWestOfLake"),
        },
        "firstFireWestOfLake": {"at": clock(first_west.at), "row": first_west.row, "lat": round(first_west.lat, 5), "lng": round(first_west.lng, 5)},
        "fleetCheck": fleet_check(roads, lake, sightings, drive, first_west.at),
        "requests": rows,
        "fireSightings": [
            {"at": clock(s.at), "lat": round(s.lat, 5), "lng": round(s.lng, 5), "row": s.row}
            for s in sorted(sightings, key=lambda s: s.at)
            if lake.is_west(s.lat, s.lng)
        ],
    }


def write() -> dict:
    results = build()
    (EATON / "replay-results.json").write_text(json.dumps(results, indent=2) + "\n")
    return results


# The documented requests are only the people whose calls got through. The fleet check asks whether
# AccessLA's vans could have carried everyone west of Lake who needs a ride, using Track D's synthetic
# population (real census records reweighted to Altadena; not real people).
FLEET_SIZES = [10, 25, 50, 100, 200]
DIAL_SECONDS_PER_CALL = 1.0
# Needs an accessible vehicle whatever else is true (convex/model.ts ACCESSIBLE_MOBILITY). A walker user who
# can leave and has a car is leaving, as on the night.
ACCESSIBLE_MOBILITY = {"manual_wheelchair", "power_wheelchair", "bedbound"}
POPULATION_BOARDING = {"walks": 2.0, "walker": 5.0, "manual_wheelchair": 10.0, "power_wheelchair": 10.0, "bedbound": 20.0}


def needs_ride(household: dict) -> bool:
    """Mirrors outcomeFor in convex/model.ts (needs_ride or needs_accessible) and dispatch/sim/population.py outcome_of."""
    if household["mobility"] in ACCESSIBLE_MOBILITY or "oxygen" in household["medical"]:
        return True
    if household["canLeave"] in ("no", "unsure"):
        return True
    return household["canLeave"] == "yes" and not household["hasCar"]


def boarding_minutes(household: dict) -> float:
    if household["assistanceRequired"] == "two_person_lift":
        return 20.0
    return POPULATION_BOARDING[household["mobility"]]


@dataclass(frozen=True)
class Stop:
    lat: float
    lng: float
    deadline: datetime
    boarding: float


def population_stops(lake: LakeAvenue, sightings: list[Sighting]) -> tuple[list[Stop], int]:
    """Households west of Lake that need a ride, with the first fire documented within two blocks."""
    population = json.loads((DATA / "population.json").read_text())
    west = [h for h in population if needs_ride(h) and lake.is_west(h["lat"], h["lng"])]
    stops = []
    for household in west:
        fire = first_fire_near(household["lat"], household["lng"], sightings, FIRE_RADIUS_M)
        if fire:
            stops.append(Stop(household["lat"], household["lng"], fire.at, boarding_minutes(household)))
    return sorted(stops, key=lambda stop: stop.deadline), len(west)


def run_fleet(stops: list[Stop], vans: int, calls_start: datetime, vans_from: datetime, depot: DriveTimes, shelter: DriveTimes) -> int:
    """Earliest deadline first, one household per trip, each van returning to the shelter between trips."""
    free_at = [vans_from] * vans
    from_depot = [True] * vans
    served = 0
    for order, stop in enumerate(stops):
        reached = calls_start + timedelta(minutes=REACH_MINUTES + APPROVE_MINUTES, seconds=order * DIAL_SECONDS_PER_CALL)
        van = min(range(vans), key=lambda i: free_at[i])
        leg = (depot if from_depot[van] else shelter).to(stop.lat, stop.lng)
        boarded = max(free_at[van], reached) + timedelta(minutes=leg + stop.boarding)
        if boarded > stop.deadline:
            continue
        served += 1
        free_at[van] = boarded + timedelta(minutes=shelter.to(stop.lat, stop.lng) + UNLOAD_MINUTES)
        from_depot[van] = False
    return served


def fleet_rows(stops: list[Stop], calls_start: datetime, vans_from: datetime, depot: DriveTimes, shelter: DriveTimes) -> list[dict]:
    rows = []
    for vans in FLEET_SIZES:
        served = run_fleet(stops, vans, calls_start, vans_from, depot, shelter)
        rows.append({"vans": vans, "pickedUpBeforeFireNearby": served, "share": round(served / len(stops), 3) if stops else None})
    return rows


def fleet_check(roads: dict, lake: LakeAvenue, sightings: list[Sighting], depot: DriveTimes, trigger: datetime) -> dict:
    stops, needing = population_stops(lake, sightings)
    shelter = DriveTimes(roads, (SHELTER["lat"], SHELTER["lng"]))
    return {
        "households": "Track D synthetic population (data/population.json), west of Lake Avenue",
        "needARide": needing,
        "withFireDocumentedNearby": len(stops),
        "shelter": SHELTER,
        "assumptions": "one household per trip; the shelter is the drive-time origin for every return leg (roads treated as two-way); dialing at one call a second in deadline order",
        "order325": {"callsStart": clock(ORDER_WEST), "vansFrom": clock(ACCESS_READY), "byFleetSize": fleet_rows(stops, ORDER_WEST, ACCESS_READY, depot, shelter)},
        "firstFireWestOfLake": {"callsStart": clock(trigger), "vansFrom": clock(trigger), "byFleetSize": fleet_rows(stops, trigger, trigger, depot, shelter)},
    }
