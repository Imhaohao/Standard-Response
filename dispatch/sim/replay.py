"""Write public/scenarios/<id>-replay.json: everything that happened to every household and van in one traced night.

The map's replay overlay plays it back at the scene's minute. Times are whole seconds after the warning,
coordinates are integers in 1e-5 degrees, and every repeated string is an index into a short table, so a
whole town's night gzips small.

    uv run python -m sim.replay --city paradise --seed 2 --fleet 25
    uv run python -m sim.replay --city altadena --seed 0 --fleet 25
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from . import trace
from .constants import REPO
from .fleetstate import PARTY_ID_STRIDE
from .metrics import boarded_at
from .roads import network

SCENARIOS = REPO / "public" / "scenarios"
EVENT_KINDS = ["call", "answer", "noAnswer", "text", "textReply", "doorQueued", "door", "clear", "request",
               "accepted", "cancel", "arrive", "pickup", "expired", "noRoad"]
OUTCOMES = ["leaving", "onTime", "late", "missed", "boardedSafe", "notBoardedSafe"]
NEEDS = ["none", "ride", "accessible"]
SCALE = 100_000


def e5(value: float) -> int:
    return int(round(value * SCALE))


class PathFinder:
    """Street paths for each van leg, under the closures in force when the leg started."""

    def __init__(self, travel, roads_raw: dict):
        self.net = network()
        self.travel = travel
        self.geometry = [e.get("geometry") for e in roads_raw["edges"]]
        self._graphs: dict[int, tuple] = {}
        self._trees: dict[tuple[int, int], np.ndarray] = {}

    def _graph(self, epoch: int):
        if epoch not in self._graphs:
            keep = self.net.cheapest_parallel_edges(self.travel.open_edges(epoch))
            graph = csr_matrix((self.net.edge_seconds[keep], (self.net.edge_from[keep], self.net.edge_to[keep])), shape=(self.net.size, self.net.size))
            lookup = {(int(self.net.edge_from[e]), int(self.net.edge_to[e])): int(e) for e in keep}
            self._graphs[epoch] = (graph, lookup)
        return self._graphs[epoch]

    def _predecessors(self, epoch: int, source: int) -> np.ndarray:
        key = (epoch, source)
        if key not in self._trees:
            graph, _ = self._graph(epoch)
            _, predecessors = dijkstra(graph, directed=True, indices=source, return_predecessors=True)
            self._trees[key] = predecessors
        return self._trees[key]

    def edges(self, start: int, end: int, at: float) -> list[int]:
        for epoch in (self.travel.epoch_of(at), 0):
            predecessors = self._predecessors(epoch, start)
            if start == end or predecessors[end] >= 0:
                return self._walk(epoch, predecessors, start, end)
        return []

    def _walk(self, epoch: int, predecessors: np.ndarray, start: int, end: int) -> list[int]:
        _, lookup = self._graph(epoch)
        path, node = [], end
        while node != start:
            parent = int(predecessors[node])
            path.append(lookup[(parent, node)])
            node = parent
        return path[::-1]

    def polyline(self, edges: list[int], start: int) -> tuple[list[tuple[float, float]], list[float]]:
        """Points along the path and the free-flow seconds to reach each one."""
        points = [tuple(self.net.coordinates[start])]
        seconds = [0.0]
        for edge in edges:
            shape = self.geometry[edge] or [self.net.coordinates[self.net.edge_from[edge]], self.net.coordinates[self.net.edge_to[edge]]]
            shape = [tuple(p) for p in shape][1:]
            lengths = [math.dist(a, b) for a, b in zip([points[-1], *shape[:-1]], shape)]
            total = sum(lengths) or 1.0
            for point, length in zip(shape, lengths):
                points.append(point)
                seconds.append(seconds[-1] + self.net.edge_seconds[edge] * length / total)
        return points, seconds


class ReplayWriter:
    def __init__(self, night, finder: PathFinder):
        self.night = night
        self.finder = finder
        self.points: dict[tuple[int, int], int] = {}
        self.flat_points: list[int] = []

    def point(self, lat: float, lng: float) -> int:
        key = (e5(lat), e5(lng))
        if key not in self.points:
            self.points[key] = len(self.points)
            self.flat_points.extend(key)
        return self.points[key]

    def leg(self, at: float, vehicle: int, start: int, end: int, seconds: float) -> list:
        points, offsets = self.finder.polyline(self.finder.edges(start, end, at), start)
        stretch = seconds / offsets[-1] if offsets[-1] > 0 else 0.0
        indices, times, last = [], [], None
        for (lat, lng), offset in zip(points, offsets):
            index = self.point(lat, lng)
            if index != last:
                indices.append(index)
                times.append(int(round(offset * stretch)))
                last = index
        return [vehicle, int(round(at)), indices, times]


def household_outcome(household, boarded: dict[int, float]) -> int:
    if household.need is None:
        return OUTCOMES.index("leaving")
    at = boarded.get(household.index)
    if not household.at_risk:
        return OUTCOMES.index("boardedSafe" if at is not None else "notBoardedSafe")
    if at is None:
        return OUTCOMES.index("missed")
    return OUTCOMES.index("onTime" if at <= household.deadline_s else "late")


def need_code(household) -> int:
    if household.need is None:
        return 0
    return 2 if household.need.accessible else 1


def seconds_or_missing(value: float) -> int:
    return int(round(value)) if math.isfinite(value) else -1


def vehicle_kind(label: str) -> str:
    if label.startswith("Bus"):
        return "bus"
    return "ambulance" if label.startswith("Medic") else "van"


def split_events(writer: ReplayWriter, events: list[tuple]) -> tuple[list, list, list]:
    log, plans, legs = [], [], []
    for at, kind, *fields in events:
        if kind == "plan":
            plans.append([int(round(at)), fields[0], fields[1], fields[2]])
        elif kind == "leg":
            legs.append(writer.leg(at, fields[0], fields[1], fields[2], fields[3]))
        elif kind == "dropoff":
            log.append([int(round(at)), len(EVENT_KINDS), -1, fields[0]])
        elif kind == "accepted":
            log.extend([int(round(at)), EVENT_KINDS.index("accepted"), r % PARTY_ID_STRIDE, fields[0]] for r in fields[1])
        elif kind in EVENT_KINDS:
            log.append(event_row(at, kind, fields))
    log.sort(key=lambda row: row[0])
    return log, plans, legs


def event_row(at: float, kind: str, fields: list) -> list:
    home = int(fields[0]) % PARTY_ID_STRIDE
    extra = int(fields[1]) if len(fields) > 1 else -1
    return [int(round(at)), EVENT_KINDS.index(kind), home, extra]


def homes_shown(world, log: list) -> list:
    """Homes the night touched: any called before it ended, any that need a ride, any in the hazard's path. A city of
    100,000 homes dials far past the end of a short night, and the homes it never reached carry nothing to show."""
    touched = {row[2] for row in log if row[2] >= 0}
    return [h for h in world.households if h.index in touched or h.need is not None or h.at_risk]


def reindexed(log: list, homes: list) -> list:
    position = {h.index: i for i, h in enumerate(homes)}
    return [[t, kind, position[home] if home >= 0 else -1, extra] for t, kind, home, extra in log if home < 0 or home in position]


def build_replay(night, events: list[tuple], roads_raw: dict, meta: dict) -> dict:
    world = night.world
    writer = ReplayWriter(night, PathFinder(world.travel, roads_raw))
    log, plans, legs = split_events(writer, [event for event in events if event[0] <= world.horizon_s])
    boarded = boarded_at(night)
    homes = homes_shown(world, log)
    log = reindexed(log, homes)
    return {
        "version": 1, **meta,
        "clock": "whole seconds after the warning",
        "endS": int(world.horizon_s),
        "kinds": [*EVENT_KINDS, "dropoff"], "outcomes": OUTCOMES, "needs": NEEDS,
        "homes": {
            "lat": [e5(h.lat) for h in homes], "lng": [e5(h.lng) for h in homes],
            "need": [need_code(h) for h in homes], "atRisk": [int(h.at_risk) for h in homes],
            "hazardS": [seconds_or_missing(h.fire_arrival_s) if h.at_risk else -1 for h in homes],
            "deadlineS": [seconds_or_missing(h.deadline_s) if h.at_risk else -1 for h in homes],
            "boardedS": [int(round(boarded[h.index])) if h.index in boarded else -1 for h in homes],
            "outcome": [household_outcome(h, boarded) for h in homes],
        },
        "events": log,
        "plans": plans,
        "vehicles": [{"label": v.spec.label, "kind": vehicle_kind(v.spec.label)} for v in night.vehicles],
        "points": writer.flat_points,
        "legs": legs,
        "legFormat": "[vehicle, start second, point indices, seconds after start at each point]; points are flat [lat, lng] pairs in 1e-5 degrees",
        "eventFormat": "[second, kind index, home index (-1 for a van event), extra: call attempt or vehicle index, -1 when none]",
        "planFormat": "[second, plan version, requests in the window, solve milliseconds]",
        "totals": {name: sum(1 for o in [household_outcome(h, boarded) for h in homes] if o == i) for i, name in enumerate(OUTCOMES)},
    }


def write_replay(replay_id: str, payload: dict) -> None:
    SCENARIOS.mkdir(parents=True, exist_ok=True)
    target = SCENARIOS / f"{replay_id}.json"
    target.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {target} ({target.stat().st_size / 1e6:.2f} MB, {len(payload['events'])} events, {len(payload['legs'])} legs)")


def traced(simulate, *args):
    trace.start()
    try:
        night, stream = simulate(*args)
    finally:
        events = trace.stop()
    return night, stream, events


def city_replay(city_id: str, seed: int, fleet: int, replay_id: str) -> None:
    from .city_night import CITIES, build_city_world, city_inputs, city_metrics, simulate

    inputs = city_inputs(city_id)
    world = build_city_world(seed, fleet, inputs)
    night, stream, events = traced(simulate, world, "ours", inputs.rule.vans_from_s)
    roads_raw = json.loads((CITIES / city_id / "roads.json").read_text())
    meta = {
        "city": city_id, "label": "Simulation on a reconstruction of a past disaster, not a record", "policy": "ours",
        "seed": seed, "fleet": fleet, "warningAt": datetime.fromtimestamp(inputs.warning_at, timezone.utc).isoformat(),
        "onTime": inputs.rule.on_time, "metrics": city_metrics(night, stream),
        "staging": {"name": inputs.city["staging"]["name"], "lat": e5(inputs.city["staging"]["lat"]), "lng": e5(inputs.city["staging"]["lng"])},
        "shelter": {"name": inputs.city["shelter"]["name"], "lat": e5(inputs.city["shelter"]["lat"]), "lng": e5(inputs.city["shelter"]["lng"])},
    }
    write_replay(replay_id, build_replay(night, events, roads_raw, meta))


def altadena_replay(seed: int, fleet: int, scenario: str) -> None:
    from .city_night import simulate
    from .constants import ROADS_FILE, SHELTER
    from .eaton_night import SCENARIOS as EATON_SCENARIOS, STAGING, build_night_world, night_metrics, shared_inputs

    inputs = shared_inputs()
    world = build_night_world(seed, scenario, fleet, {**inputs, "closures": inputs["closures"]})
    timing = EATON_SCENARIOS[scenario]
    vans_from = timing["vansFrom"].timestamp() - timing["callsStart"].timestamp()
    night, stream, events = traced(simulate, world, "ours", vans_from)
    meta = {
        "city": "altadena", "label": "Simulation on the real night's fire record, not a record of what happened", "policy": "ours",
        "seed": seed, "fleet": fleet, "scenario": scenario, "warningAt": timing["callsStart"].astimezone(timezone.utc).isoformat(),
        "onTime": "everyone in the household aboard at least 10 min before fire was reported near the home",
        "metrics": night_metrics(night, stream),
        "staging": {"name": STAGING["name"], "lat": e5(STAGING["lat"]), "lng": e5(STAGING["lng"])},
        "shelter": {"name": SHELTER["name"], "lat": e5(SHELTER["lat"]), "lng": e5(SHELTER["lng"])},
    }
    write_replay("altadena-replay", build_replay(night, events, json.loads(ROADS_FILE.read_text()), meta))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--fleet", type=int, default=25)
    parser.add_argument("--scenario", default="firstFireWest", help="Altadena only")
    parser.add_argument("--named", action="store_true", help="write <city>-replay-<fleet>.json, which the scene opens with &fleet=")
    args = parser.parse_args()
    if args.city == "altadena":
        altadena_replay(args.seed, args.fleet, args.scenario)
    else:
        city_replay(args.city, args.seed, args.fleet, f"{args.city}-replay-{args.fleet}" if args.named else f"{args.city}-replay")


if __name__ == "__main__":
    main()
