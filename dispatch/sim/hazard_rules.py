"""What "on time" means for each hazard, when its streets close, and when the vans can roll.

Every number here carries the reason it was chosen; city_night writes them into the results file's
assumptions so nothing in a headline is unlabeled.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

import numpy as np
import shapely
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from .constants import MINUTE
from .population import RideNeed, ride_need_for

METERS_PER_DEGREE = 111_320.0
BURNOVER_RADIUS_M = 150.0
# A home's fire time is the first documented sighting within the near radius, else the far one (as in eaton_night).
SIGHTING_NEAR_M, SIGHTING_FAR_M = 250.0, 500.0
NIST_UTC_OFFSET = "-08:00"  # NIST TN 2135 times are PST
# Lower Ninth: the first breach at 04:30 on 29 Aug 2005 (data/cities/lower-ninth/sources.md, IPET's earliest time).
FLOOD_NO_ENTRY_MINUTE = 1050
# Fort Myers Beach: Lee County told residents to be sheltered by 20:00 on 27 Sep 2022 (data/cities/fort-myers-beach/sources.md).
SURGE_SHELTER_BY_MINUTE = 780
# Blizzard: the outage curve peaks at 18:00 on 23 Dec (minute 510). Its denominator is the City of Buffalo's occupied
# households, ACS 2019-2023 B11001 for place 3611000, standing in for National Grid's residential customers there.
PEAK_OUTAGE_MINUTE = 510
BUFFALO_CUSTOMERS = 119_548
POWER_DRAW_SEED = 23
# Assumption: National Grid's outage map shows a block group out about half an hour after it goes dark.
OUTAGE_FEED_DELAY_MINUTES = 30
# Until a home's outage is known, the dispatcher treats it as able to ride out the storm for the no-heat window.
NO_HEAT_WINDOW_S = 12 * 3600


def first_sighting_within(lat, lng, sightings: list[tuple[float, float, float]], radius_m: float) -> np.ndarray:
    out = np.full(len(lat), np.inf)
    scale = np.cos(np.radians(np.mean(lat)))
    for s_lat, s_lng, seconds in sightings:
        near = np.hypot((lat - s_lat) * METERS_PER_DEGREE, (lng - s_lng) * METERS_PER_DEGREE * scale) <= radius_m
        out[near] = np.minimum(out[near], seconds)
    return out


def sighting_arrival(lat, lng, sightings, fallback_s: np.ndarray) -> np.ndarray:
    """First sighting within 250 m, else 500 m, else the front's arrival. Only homes a front reaches are at risk."""
    near = first_sighting_within(lat, lng, sightings, SIGHTING_NEAR_M)
    far = first_sighting_within(lat, lng, sightings, SIGHTING_FAR_M)
    seen = np.where(np.isfinite(near), near, far)
    return np.where(np.isfinite(fallback_s), np.where(np.isfinite(seen), seen, fallback_s), np.inf)


def edge_arrival_seconds(net, fronts) -> np.ndarray:
    """Seconds after the warning when the first front covers each street's midpoint; inf if never."""
    mid = net.edge_midpoints()
    out = np.full(len(mid), np.inf)
    for minutes, geometry in fronts:
        inside = shapely.contains_xy(geometry, mid[:, 1], mid[:, 0]) & ~np.isfinite(out)
        out[inside] = minutes * MINUTE
    return out


def front_closures(net, fronts, scenario, folder) -> np.ndarray:
    return edge_arrival_seconds(net, fronts)


def documented_burnovers(folder) -> list[dict]:
    path = folder / "fronts.geojson"
    if not path.exists():
        return []
    return (json.loads(path.read_text()).get("metadata") or {}).get("roadBurnovers") or []


def wildfire_closures(net, fronts, scenario, folder) -> np.ndarray:
    """The front closes a street when it reaches the midpoint; a documented burnover closes streets near it from its start."""
    closes = edge_arrival_seconds(net, fronts)
    burnovers = documented_burnovers(folder)
    if not burnovers:
        return closes
    mid = net.edge_midpoints()
    scale = np.cos(np.radians(mid[:, 0].mean()))
    for burnover in burnovers:
        meters = np.hypot((mid[:, 0] - burnover["lat"]) * METERS_PER_DEGREE, (mid[:, 1] - burnover["lng"]) * METERS_PER_DEGREE * scale)
        near = meters <= BURNOVER_RADIUS_M
        closes[near] = np.minimum(closes[near], burnover["startMinutesAfterWarning"] * MINUTE)
    return closes


def street_class_closures(net, fronts, scenario, folder) -> np.ndarray:
    """Blizzard: each OSM highway class closes when the research timeline says it became unusable; any class it
    does not name closes with the side streets."""
    classes = json.loads((folder / "scenario.json").read_text())["series"]["streetClasses"]
    closes_at = {}
    for street in classes:
        event = street.get("closed") or street.get("impassable")
        for highway in street["osmHighway"]:
            closes_at[highway] = event["minutesAfterWarning"] * MINUTE
    fallback = max(closes_at.values())
    return np.array([closes_at.get(highway, fallback) for highway in net.edge_highway], dtype=float)


def power_loss_seconds(folder, households: int, rng: np.random.Generator) -> np.ndarray:
    """When each home loses power, drawn from the city's rising outage curve: a home whose draw is under the share of
    the city's customers out by minute t has lost power by then. Homes above the storm's peak share keep power."""
    scenario = json.loads((folder / "scenario.json").read_text())
    curve = scenario["series"]["cityCustomersWithoutPower"]
    rising = [point for point in curve if point["minutesAfterWarning"] <= PEAK_OUTAGE_MINUTE]
    minutes = np.array([point["minutesAfterWarning"] for point in rising], dtype=float)
    share = np.array([point["customersOut"] for point in rising], dtype=float) / BUFFALO_CUSTOMERS
    draws = rng.random(households)
    lost = np.interp(draws, share, minutes, left=minutes[0], right=np.inf) * MINUTE
    return np.where(draws <= share[-1], lost, np.inf)


def seconds_to_leave_zone(net, fronts, nodes: list[int]) -> np.ndarray:
    """Free-flow driving seconds from each node to the nearest street outside every front."""
    zone = shapely.union_all([geometry for _, geometry in fronts])
    coords = net.coordinates
    outside = np.flatnonzero(~shapely.contains_xy(zone, coords[:, 1], coords[:, 0]))
    keep = net.cheapest_parallel_edges(np.ones(len(net.edge_from), dtype=bool))
    reverse = csr_matrix((net.edge_seconds[keep], (net.edge_to[keep], net.edge_from[keep])), shape=(net.size, net.size))
    to_safety = dijkstra(reverse, directed=True, indices=outside, min_only=True)
    return to_safety[np.array(nodes)]


@dataclass
class ArrivalContext:
    net: object
    fronts: list
    nodes: list[int]
    records: list[dict]
    folder: object
    warning_at: float


def wildfire_arrival(arrival_s, context: ArrivalContext) -> np.ndarray:
    """Where the research gives first sightings (Paradise: NIST TN 2135 Appendix F), a home's fire time is the first
    sighting within 250 m, else 500 m, else the front's arrival."""
    path = context.folder / "nist-observations.json"
    if not path.exists():
        return arrival_s
    rows = json.loads(path.read_text())["observations"]
    sightings = [(r["lat"], r["lng"], datetime.fromisoformat(f"{r['date']}T{r['time']}:00{NIST_UTC_OFFSET}").timestamp() - context.warning_at) for r in rows]
    lat = np.array([r["lat"] for r in context.records])
    lng = np.array([r["lng"] for r in context.records])
    return sighting_arrival(lat, lng, sightings, arrival_s)


def last_exit(arrival_s, context: ArrivalContext) -> np.ndarray:
    """The hazard time minus the drive from the door to the edge of the zone, for homes inside it."""
    return arrival_s - np.where(np.isfinite(arrival_s), seconds_to_leave_zone(context.net, context.fronts, context.nodes), 0.0)


def tsunami_last_exit(arrival_s, context: ArrivalContext) -> np.ndarray:
    """Every van must be out of the inundation zone before the first wave reaches any of it, so each home in the zone
    has the first wave's time, minus the drive from its door to the zone's edge."""
    first_wave = min(minutes for minutes, _ in context.fronts) * MINUTE
    return last_exit(np.where(np.isfinite(arrival_s), first_wave, np.inf), context)


def tsunami_closures(net, fronts, scenario, folder) -> np.ndarray:
    """Every street anywhere in the inundation zone closes at the first wave."""
    reached = edge_arrival_seconds(net, fronts)
    return np.where(np.isfinite(reached), min(minutes for minutes, _ in fronts) * MINUTE, np.inf)


def blizzard_deadline(arrival_s, context: ArrivalContext) -> np.ndarray:
    """At risk: homes that lose power in the storm. Their deadline is the front (streets impassable, minute 330), or
    the moment the power goes out for a home on oxygen, whichever is first."""
    power = power_loss_seconds(context.folder, len(context.records), np.random.default_rng(POWER_DRAW_SEED))
    oxygen = np.array(["oxygen" in r["medical"] for r in context.records])
    deadline = np.where(oxygen, np.minimum(arrival_s, np.maximum(power, 0.0)), arrival_s)
    return np.where(np.isfinite(power) & np.isfinite(arrival_s), deadline, np.inf)


def flood_last_exit(arrival_s, context: ArrivalContext) -> np.ndarray:
    """Lower Ninth: aboard and out of the ward before the water reaches the home, and no van enters after the first
    breach. The household's hazard time is the earlier of the two, minus the drive from its door out of the ward."""
    return last_exit(np.minimum(arrival_s, FLOOD_NO_ENTRY_MINUTE * MINUTE), context)


def flood_closures(net, fronts, scenario, folder) -> np.ndarray:
    """Streets close as the water reaches them, and every street in the ward closes to vans at the first breach."""
    closes = edge_arrival_seconds(net, fronts)
    return np.where(np.isfinite(closes), np.minimum(closes, FLOOD_NO_ENTRY_MINUTE * MINUTE), closes)


def surge_shelter_by(arrival_s, context: ArrivalContext) -> np.ndarray:
    """Fort Myers Beach: aboard by the county's shelter-in-place time, for every home the surge reaches."""
    return np.minimum(arrival_s, SURGE_SHELTER_BY_MINUTE * MINUTE)


def evacuation_need(truth: dict) -> RideNeed | None:
    """Fire, water and tsunami: a household needs a ride when it can't leave on its own (rule from convex/model.ts)."""
    return ride_need_for(truth)


def blizzard_need(truth: dict) -> RideNeed | None:
    """In a driving ban nobody drives, so having no car doesn't put a home at risk. A home needs moving to a warming
    center when it can't stay safe through days without heat or power: someone 65+ living alone, someone with a
    mobility or self-care limitation, or someone on oxygen or dialysis."""
    alone_65 = truth["peopleCount"] == 1 and truth["age"] >= 65
    limited = truth["mobility"] != "walks" or truth["assistanceRequired"] != "none"
    if not (alone_65 or limited or truth["medical"]):
        return None
    return ride_need_for({**truth, "canLeave": "no"})


def always_known(context: ArrivalContext, households: int) -> np.ndarray:
    """Fire, water and tsunami: the scenario's fronts are the forecast the dispatcher plans with from the start."""
    return np.full(households, -np.inf)


def outage_reported(context: ArrivalContext, households: int) -> np.ndarray:
    """Blizzard: the dispatcher learns a home has lost power when the utility's outage feed shows its block group out,
    OUTAGE_FEED_DELAY_MINUTES after the outage. A call that reaches the home after the outage would tell it sooner;
    this run doesn't credit that, so it errs late."""
    power = power_loss_seconds(context.folder, households, np.random.default_rng(POWER_DRAW_SEED))
    return np.maximum(power, 0.0) + OUTAGE_FEED_DELAY_MINUTES * MINUTE


def keep_arrival(arrival_s, context: ArrivalContext) -> np.ndarray:
    return arrival_s


@dataclass(frozen=True)
class HazardRule:
    on_time: str
    on_time_why: str
    margin_s: float
    closure_rule: str
    closure_why: str
    vans_from_s: float = 0.0
    vans_why: str = "the warning is the trigger for both calls and vans"
    closures: Callable = front_closures
    adjust_arrival: Callable = keep_arrival
    ride_need: Callable = evacuation_need
    # When the dispatcher learns each home is in danger, and how much later it plans for a home it hasn't heard about.
    known_at: Callable = always_known
    unknown_slack_s: float = 0.0
    # Whether a roof turns "too late" when the hazard's front reaches it, rather than at the pickup deadline.
    roof_at_front: bool = False
    need_rule: str = "can't leave on its own: no car, or a mobility or medical need a car can't carry (convex/model.ts)"
    notes: list = field(default_factory=list)

    def margins(self, count: int) -> np.ndarray:
        return np.full(count, self.margin_s)


RULES: dict[str, HazardRule] = {
    "wildfire": HazardRule(
        on_time="everyone in the household aboard 10 min before the first documented fire sighting within 250 m of the home (else 500 m, else the front)",
        on_time_why="data/cities/paradise/sources.md, the Eaton rule: 19 of Paradise's 85 victims died trying to leave, so boarding as fire arrives is too late",
        margin_s=10 * MINUTE,
        closure_rule="a street closes for good when the front reaches its midpoint, or when a documented burnover within 150 m of it begins",
        closure_why="burnovers from NIST TN 2135 Appendix B; NIST shows some reopening hours later, which this run does not model, so it is slightly pessimistic on roads",
        closures=wildfire_closures,
        adjust_arrival=wildfire_arrival,
    ),
    "flood": HazardRule(
        on_time="aboard and driven out of the ward before the water reaches the home, and before the first breach at 04:30 on 29 Aug (minute 1050)",
        on_time_why="data/cities/lower-ninth/sources.md: water went from the floor to 9 ft in about 15 minutes, so there is no safe depth to wait for; no van is routed into the ward after the first breach",
        margin_s=0.0,
        closure_rule="a street closes when the water reaches its midpoint, and every street in the ward closes at minute 1050",
        closure_why="a lift van cannot drive through flood water, and nothing should drive into the ward once the walls have failed",
        closures=flood_closures,
        adjust_arrival=flood_last_exit,
        roof_at_front=True,
    ),
    "surge": HazardRule(
        on_time="aboard by 20:00 on 27 Sep (minute 780), when Lee County told residents to be sheltered, for every home the surge reached",
        on_time_why="data/cities/fort-myers-beach/sources.md: travel after that was into the storm, and the island's only ways off are two bridges",
        margin_s=0.0,
        closure_rule="a street closes for good when the surge reaches its midpoint",
        closure_why="a lift van cannot drive through surge water; the shelter time ends pickups well before that",
        adjust_arrival=surge_shelter_by,
        roof_at_front=True,
    ),
    "tsunami": HazardRule(
        on_time="everyone aboard, and the van able to drive out of the inundation zone, at least 10 min before the first wave reaches any of it",
        on_time_why="a van caught inside the zone at the first wave is lost with its riders",
        margin_s=10 * MINUTE,
        closure_rule="every street inside the inundation zone closes at the first wave",
        closure_why="the 1960 waves came in a series over hours; nobody re-enters the zone",
        closures=tsunami_closures,
        adjust_arrival=tsunami_last_exit,
        roof_at_front=True,
    ),
    "blizzard": HazardRule(
        on_time="aboard before the streets become impassable at 15:00 (minute 330), or before the power goes out for a home on oxygen; "
                "only homes that lose power in the storm are at risk",
        on_time_why="data/cities/buffalo/sources.md: after 15:00 no ordinary vehicle reached a home until the plows, and 911 waits in District E "
                    "averaged 30 hours; power-loss times are drawn from National Grid's city outage curve over the city's 119,548 households (ACS)",
        margin_s=0.0,
        closure_rule="expressways closed before the travel ban; every other street closes at 15:00 on 23 Dec",
        closure_why="NYU Wagner review timeline, by OSM highway class (data/cities/buffalo/scenario.json streetClasses)",
        closures=street_class_closures,
        adjust_arrival=blizzard_deadline,
        ride_need=blizzard_need,
        known_at=outage_reported,
        unknown_slack_s=NO_HEAT_WINDOW_S,
        need_rule="someone 65+ living alone, someone with a mobility or self-care limitation, or someone on oxygen or dialysis; having no car doesn't count in a driving ban",
    ),
}
