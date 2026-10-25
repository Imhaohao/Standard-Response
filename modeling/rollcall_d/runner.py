"""One pass of the live models against Convex.

  hazard      fireArrivalAt for every located household, and `hazard` closures as fronts reach roads
  need        needProbability for every household not yet reached (the real need model)
  door        doorPriority for every household on the door-check list
  addresses   open nominations and unlocated inbound callers matched to address points

Each pass reads `estimates:inputs` once and writes only what changed.
"""

import math
import time
from dataclasses import dataclass, field

from . import door, need
from .addresses import AddressBook, match
from .census import base_rate
from .convex_io import Convex
from .geo import meters_between
from .hazard import DEFAULT_HAZARD, Scenario
from .travel import RoadGraph

MINUTE_MS = 60_000
PROBABILITY_EPSILON = 0.005
ARRIVAL_EPSILON_MS = 15_000
DOOR_EPSILON = 1e-4
CLOSURE_BATCH = 50
UNCONFIRMED_ADDRESS = "Address not confirmed"


@dataclass
class RunnerConfig:
    # Seconds of real time per scenario second. 1 is real time; 10 runs a 4-hour night in 24 minutes.
    time_scale: float = 1.0
    # A road closes when a front comes within this distance: about 6 minutes of head-fire spread at
    # 24 m/min. A choice, not a measurement.
    closure_margin_meters: float = 150.0
    closures: bool = True
    need_config: need.NeedConfig = field(default_factory=need.NeedConfig)
    door_config: door.DoorConfig = field(default_factory=door.DoorConfig)


@dataclass
class PassResult:
    stats: dict[str, float]
    door_alpha: float | None
    incident_key: float | None


class HazardTiming:
    """When one scenario's fronts reach each home and each street segment."""

    def __init__(self, scenario: Scenario, roads: RoadGraph, config: RunnerConfig):
        self.scenario = scenario
        self._arrival_cache: dict[tuple[float, float], float] = {}
        self.edge_close_minutes = self._edge_close_minutes(roads, config.closure_margin_meters) if config.closures else {}

    def _edge_close_minutes(self, roads: RoadGraph, margin_meters: float) -> dict[str, tuple[float, list[dict]]]:
        """Scenario minute at which each street segment closes, with its path for the map."""
        margin = self.scenario.buffered(margin_meters)
        closes = {}
        for edge in roads.undirected_edges():
            samples = _densify(edge.coords, step=25.0)
            minute = min(margin.arrival_minutes(lat, lng) for lat, lng in samples)
            closes[edge.edge_key] = (minute, [{"lat": lat, "lng": lng} for lat, lng in edge.coords])
        return closes

    def arrival_minutes(self, lat: float, lng: float) -> float:
        key = (round(lat, 6), round(lng, 6))
        if key not in self._arrival_cache:
            self._arrival_cache[key] = self.scenario.arrival_minutes(lat, lng)
        return self._arrival_cache[key]


class ModelRunner:
    """Follows the hazard the operator picked (`control.hazard`), unless a scenario is pinned. A hazard with no
    scenario file gets no deadlines or closures from us: the households keep the ones they have."""

    def __init__(self, convex: Convex, config: RunnerConfig, scenario: Scenario | None = None, roads: RoadGraph | None = None):
        self.convex = convex
        self.config = config
        self.pinned = scenario
        self.roads = roads or RoadGraph.load()
        self.osm_book = AddressBook.from_osm()
        self.started_at_ms = time.time() * 1000
        self._timings: dict[str, HazardTiming | None] = {}

    # ---- hazard -------------------------------------------------------------------------------

    def timing(self, inputs: dict) -> HazardTiming | None:
        key = "pinned" if self.pinned else inputs.get("hazard") or DEFAULT_HAZARD
        if key not in self._timings:
            scenario = self.pinned or Scenario.for_hazard(key)
            self._timings[key] = HazardTiming(scenario, self.roads, self.config) if scenario else None
        return self._timings[key]

    def anchor_ms(self, inputs: dict) -> float:
        """Minute zero of the scenario: the warning, else the zone being drawn, else runner start."""
        if inputs.get("warningIssuedAt"):
            return inputs["warningIssuedAt"]
        if inputs.get("zone"):
            return inputs["zone"]["drawnAt"]
        return self.started_at_ms

    def scenario_minutes_now(self, inputs: dict) -> float:
        return (inputs["now"] - self.anchor_ms(inputs)) / MINUTE_MS * self.config.time_scale

    def arrival_ms(self, inputs: dict, lat: float, lng: float) -> float | None:
        timing = self.timing(inputs)
        if timing is None:
            return None
        return self.anchor_ms(inputs) + timing.arrival_minutes(lat, lng) * MINUTE_MS / self.config.time_scale

    def due_closures(self, inputs: dict) -> list[dict]:
        timing = self.timing(inputs)
        if timing is None:
            return []
        existing = {c["edgeKey"] for c in inputs["closures"] if c.get("edgeKey")}
        minute_now = self.scenario_minutes_now(inputs)
        due = [
            {"edgeKey": key, "path": path, "source": "hazard"}
            for key, (minute, path) in timing.edge_close_minutes.items()
            if minute <= minute_now and key not in existing
        ]
        return due

    # ---- estimates ----------------------------------------------------------------------------

    def estimates(self, inputs: dict) -> list[dict]:
        households = inputs["households"]
        nominated = set(inputs["nominatedHouseholdIds"])
        smoothing = bool(inputs["state"].get("smoothing", True))
        probabilities = need.estimate(households, nominated, smoothing, self.config.need_config)
        rows = []
        for h in households:
            p = probabilities.get(h["_id"], h["needProbability"])
            arrival = self.arrival_ms(inputs, h["lat"], h["lng"]) if h.get("lat") is not None else None
            arrival = h["fireArrivalAt"] if arrival is None else arrival
            p_changed = abs(p - h["needProbability"]) > PROBABILITY_EPSILON
            arrival_changed = abs(arrival - h["fireArrivalAt"]) > ARRIVAL_EPSILON_MS
            if p_changed or arrival_changed:
                rows.append({"householdId": h["_id"], "needProbability": round(p, 4), "fireArrivalAt": round(arrival)})
        return rows

    # ---- door checks --------------------------------------------------------------------------

    def door_scores(self, inputs: dict, estimates: dict[str, dict], alpha: float | None) -> tuple[list[dict], float | None]:
        """Scores for the door-check list, and alpha once it is fixed for the incident (else None)."""
        queue = [h for h in inputs["households"] if h["callStatus"] == "door_check" and h.get("lat") is not None]
        if not queue:
            return [], alpha
        closed = self.roads.closed_edges(inputs["closures"])
        from_teams = self.roads.minutes_from(self.config.door_config.teams, closed)
        now = inputs["now"]
        terms = {}
        for h in queue:
            fresh = estimates.get(h["_id"], {})
            p = fresh.get("needProbability", h["needProbability"])
            arrival = fresh.get("fireArrivalAt", h["fireArrivalAt"])
            tau = self.roads.minutes_to(h["lat"], h["lng"], from_teams)
            terms[h["_id"]] = door.need_urgency_term(p, (arrival - now) / MINUTE_MS, tau)
        frozen = alpha is not None
        if not frozen:
            alpha = door.alpha_for(list(terms.values()), self.config.door_config)
        scores = []
        for h in queue:
            entered = h.get("lastAttemptAt") or now
            score = door.priority(terms[h["_id"]], (now - entered) / MINUTE_MS, alpha)
            if h.get("doorPriority") is None or abs(score - h["doorPriority"]) > DOOR_EPSILON:
                scores.append({"householdId": h["_id"], "doorPriority": round(score, 6)})
        keep = frozen or len(queue) >= door.MIN_QUEUE_FOR_ALPHA
        return scores, (alpha if keep else None)

    # ---- addresses ----------------------------------------------------------------------------

    def match_addresses(self, inputs: dict) -> dict[str, float]:
        households = inputs["households"]
        by_id = {h["_id"]: h for h in households}
        books = [AddressBook.from_households(households), self.osm_book]
        counts = {"nominationsMatched": 0, "nominationsFlagged": 0, "located": 0}
        for nomination in inputs["openNominations"]:
            nominator = by_id.get(nomination.get("fromHouseholdId") or "")
            near = (nominator["lat"], nominator["lng"]) if nominator and nominator.get("lat") is not None else None
            result = match(nomination["spokenAddress"], books, near)
            if result.point is None:
                self.convex.mutation("nominations:resolve", {"nominationId": nomination["_id"], "note": result.note})
                counts["nominationsFlagged"] += 1
            elif result.point.household_id:
                self.convex.mutation("nominations:resolve", {"nominationId": nomination["_id"], "matchedHouseholdId": result.point.household_id})
                counts["nominationsMatched"] += 1
            else:
                self._add_nominated(inputs, nomination["_id"], result.point)
                counts["nominationsMatched"] += 1
        for h in households:
            if h.get("lat") is not None or h["address"] == UNCONFIRMED_ADDRESS:
                continue
            result = match(h["address"], [self.osm_book])
            if result.point:
                self.convex.mutation("households:setLocation", {"householdId": h["_id"], "address": result.point.label, "lat": result.point.lat, "lng": result.point.lng})
                counts["located"] += 1
        return counts

    def _add_nominated(self, inputs: dict, nomination_id: str, point) -> None:
        prior = base_rate(point.lat, point.lng)
        nominated = need._odds_update(prior, self.config.need_config.nomination_lr)
        self.convex.mutation("nominations:matchAddress", {
            "nominationId": nomination_id,
            "address": point.label,
            "lat": point.lat,
            "lng": point.lng,
            "needPrior": prior,
            "needProbability": round(nominated, 4),
            "fireArrivalAt": round(self._arrival_at_new_point(inputs, point.lat, point.lng)),
        })

    def _arrival_at_new_point(self, inputs: dict, lat: float, lng: float) -> float:
        """The scenario's arrival there; with no scenario, the deadline of the nearest home we know, and with
        none of those, now. A new home is never given more time than its neighbors."""
        arrival = self.arrival_ms(inputs, lat, lng)
        if arrival is not None:
            return arrival
        located = [h for h in inputs["households"] if h.get("lat") is not None]
        if not located:
            return inputs["now"]
        nearest = min(located, key=lambda h: meters_between((lat, lng), (h["lat"], h["lng"])))
        return nearest["fireArrivalAt"]

    # ---- one pass -----------------------------------------------------------------------------

    def run_pass(self) -> PassResult:
        inputs = self.convex.query("estimates:inputs")
        state = inputs["state"]
        incident_key = inputs.get("warningIssuedAt")
        alpha = state.get("doorAlpha") if state.get("incidentKey") == incident_key else None

        match_counts = self.match_addresses(inputs)
        if any(match_counts.values()):
            inputs = self.convex.query("estimates:inputs")

        rows = self.estimates(inputs)
        self.convex.batched("households:setEstimates", "estimates", rows)
        by_id = {row["householdId"]: row for row in rows}

        scores, alpha = self.door_scores(inputs, by_id, alpha)
        self.convex.batched("doorChecks:setPriorities", "scores", scores)

        closures = self.due_closures(inputs)
        for start in range(0, len(closures), CLOSURE_BATCH):
            self.convex.mutation("roads:addClosures", {"closures": closures[start : start + CLOSURE_BATCH]})

        stats = {
            "estimated": len(rows),
            "doorScored": len(scores),
            "closuresAdded": len(closures),
            **({"scenarioMinute": round(self.scenario_minutes_now(inputs), 1)} if self.timing(inputs) else {}),
            **match_counts,
        }
        self.convex.mutation("estimates:reportRun", {
            "stats": stats,
            **({"doorAlpha": alpha} if alpha is not None else {}),
            **({"incidentKey": incident_key} if incident_key is not None else {}),
        })
        return PassResult(stats, alpha, incident_key)


def _densify(coords: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    out = [coords[0]]
    for a, b in zip(coords, coords[1:]):
        n = max(1, math.ceil(meters_between(a, b) / step))
        out.extend((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(1, n + 1))
    return out
