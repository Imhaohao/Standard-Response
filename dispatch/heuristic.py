"""The competent heuristic: earliest deadline first, type and crew matched, greedy insertion after
each vehicle's accepted run. The baseline OR-Tools must beat, and the simulator's copy of the
fallback dispatcher in convex/heuristic.ts. Keep the two in step.

Each vehicle carries riders in trips: pickups, then one shelter. A rider reserves space for their
whole party at the nearest shelter with room, and joins the open trip only when it fits, the trip's
shelter still has room, and everyone's ride time stays legal; otherwise the vehicle drops off first.
The rider goes to the compatible vehicle that reaches them soonest. Riders no vehicle can reach
before their deadline wait until everyone reachable in time is placed, like a dispatcher's triage.
A rider with no road to a shelter that has room can't be served and is dropped.
"""

from __future__ import annotations

import time

from solver import CAPACITY_FIELDS, UNLOAD_SECONDS


def people(request) -> int:
    return sum(int(request["load"][f]) for f in CAPACITY_FIELDS)


class Shelters:
    """Room left at each shelter, reserved as riders are assigned."""

    def __init__(self, problem):
        self.problem = problem
        self.room = [int(s["capacity"]) for s in problem["shelters"]]

    def seconds(self, location, s):
        return self.problem["matrix"][location][self.problem["shelters"][s]["location"]]

    def nearest_with_room(self, location, party):
        best = None
        for s in range(len(self.room)):
            seconds = self.seconds(location, s)
            if seconds is not None and self.room[s] >= party and (best is None or seconds < best[1]):
                best = (s, seconds)
        return best


class VehicleState:
    def __init__(self, vehicle):
        self.vehicle = vehicle
        self.location = vehicle["location"]
        self.time = vehicle["availableAt"]
        self.trip: list[tuple[dict, float]] = []  # (request, pickup time)
        self.trip_shelter: int | None = None
        self.stops: list[dict] = []

    def onboard(self, field):
        return sum(r["load"][field] for r, _ in self.trip)

    def fits(self, request):
        return all(self.onboard(f) + request["load"][f] <= self.vehicle[f] for f in CAPACITY_FIELDS)


def _fits_empty(vehicle, request):
    return all(request["load"][f] <= vehicle[f] for f in CAPACITY_FIELDS)


def _ride_ok(shelters, state, request, arrival, s):
    to_shelter = shelters.seconds(request["location"], s)
    if to_shelter is None:
        return False
    drop_time = arrival + request["boardingSeconds"] + to_shelter
    riders = [*state.trip, (request, arrival)]
    return all(r.get("maxRideSeconds") is None or drop_time - t <= r["maxRideSeconds"] for r, t in riders)


def _join_open_trip(problem, shelters, state, request):
    if not state.trip or not state.fits(request) or shelters.room[state.trip_shelter] < people(request):
        return None
    seconds = problem["matrix"][state.location][request["location"]]
    if seconds is None or not _ride_ok(shelters, state, request, state.time + seconds, state.trip_shelter):
        return None
    return state.time + seconds, True, state.trip_shelter


def _after_drop_off(shelters, state):
    """Where and when the vehicle is free after delivering its open trip."""
    if not state.trip:
        return state.location, state.time
    seconds = shelters.seconds(state.location, state.trip_shelter)
    if seconds is None:
        return None
    return shelters.problem["shelters"][state.trip_shelter]["location"], state.time + seconds + UNLOAD_SECONDS


def _start_new_trip(problem, shelters, state, request):
    ready = _after_drop_off(shelters, state)
    shelter = shelters.nearest_with_room(request["location"], people(request))
    if ready is None or shelter is None or not _fits_empty(state.vehicle, request):
        return None
    seconds = problem["matrix"][ready[0]][request["location"]]
    return None if seconds is None else (ready[1] + seconds, False, shelter[0])


def _option(problem, shelters, state, request):
    """Earliest pickup this vehicle can offer: (arrival, joins open trip, shelter)."""
    return _join_open_trip(problem, shelters, state, request) or _start_new_trip(problem, shelters, state, request)


def _drop_off(shelters, state):
    if not state.trip:
        return
    s = state.trip_shelter
    state.time += shelters.seconds(state.location, s)
    shelter_id = shelters.problem["shelters"][s]["id"]
    for rider, _ in state.trip:
        state.stops.append({"request": rider["id"], "kind": "dropoff", "shelter": shelter_id, "arrival": state.time})
    state.time += UNLOAD_SECONDS
    state.location = shelters.problem["shelters"][s]["location"]
    state.trip, state.trip_shelter = [], None


def _assign(shelters, state, request, option):
    arrival, joins_trip, s = option
    if not joins_trip:
        _drop_off(shelters, state)
        state.trip_shelter = s
    shelters.room[s] -= people(request)
    state.stops.append({"request": request["id"], "kind": "pickup", "shelter": None, "arrival": arrival})
    state.trip.append((request, arrival))
    state.location = request["location"]
    state.time = arrival + request["boardingSeconds"]


def _best_option(problem, shelters, states, request):
    best = None
    for k in request["allowedVehicles"]:
        option = _option(problem, shelters, states[k], request)
        if option is None or option[0] > states[k].vehicle["endBy"]:
            continue
        if best is None or option[0] < best[1][0]:
            best = (k, option)
    return best


def _place(problem, shelters, states, requests, dropped, late=None):
    for request in requests:
        best = _best_option(problem, shelters, states, request)
        if best is None:
            dropped.append(request["id"])
        elif late is not None and best[1][0] > request["deadline"]:
            late.append(request)
        else:
            _assign(shelters, states[best[0]], request, best[1])


def solve(problem: dict) -> dict:
    started = time.perf_counter()
    shelters = Shelters(problem)
    states = [VehicleState(v) for v in problem["vehicles"]]
    dropped, late = [], []
    _place(problem, shelters, states, sorted(problem["requests"], key=lambda r: r["deadline"]), dropped, late)
    _place(problem, shelters, states, late, dropped)
    for state in states:
        _drop_off(shelters, state)
    return {
        "routes": [{"vehicle": s.vehicle["id"], "stops": s.stops} for s in states],
        "dropped": dropped,
        "solver": "heuristic",
        "solveMs": round((time.perf_counter() - started) * 1000),
    }
