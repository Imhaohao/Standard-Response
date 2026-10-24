"""The competent heuristic: earliest deadline first, type and crew matched, greedy insertion after
each vehicle's accepted run. The baseline OR-Tools must beat, and the simulator's copy of the
fallback dispatcher in convex/heuristic.ts. Keep the two in step.

Each vehicle carries riders in trips (pickups, then the nearest shelter). A rider joins the open
trip when it fits and keeps everyone's ride time legal; otherwise the vehicle drops off first.
The rider goes to the compatible vehicle that reaches them soonest.
"""

from __future__ import annotations

import time

from solver import CAPACITY_FIELDS, UNLOAD_SECONDS


def _nearest_shelter(problem, location):
    best = None
    for s, shelter in enumerate(problem["shelters"]):
        seconds = problem["matrix"][location][shelter["location"]]
        if seconds is not None and (best is None or seconds < best[1]):
            best = (s, seconds)
    return best


class VehicleState:
    def __init__(self, vehicle):
        self.vehicle = vehicle
        self.location = vehicle["location"]
        self.time = vehicle["availableAt"]
        self.trip: list[tuple[dict, float]] = []  # (request, pickup time)
        self.stops: list[dict] = []

    def onboard(self, field):
        return sum(r["load"][field] for r, _ in self.trip)

    def fits(self, request):
        return all(self.onboard(f) + request["load"][f] <= self.vehicle[f] for f in CAPACITY_FIELDS)


def _ride_ok(problem, state, request, arrival):
    pickup_done = arrival + request["boardingSeconds"]
    shelter = _nearest_shelter(problem, request["location"])
    if shelter is None:
        return False
    drop_time = pickup_done + shelter[1]
    riders = [*state.trip, (request, arrival)]
    return all(r.get("maxRideSeconds") is None or drop_time - t <= r["maxRideSeconds"] for r, t in riders)


def _close_trip(problem, state):
    """Drive to the nearest shelter and drop everyone off. Returns (location, time) after unloading."""
    if not state.trip:
        return state.location, state.time
    shelter = _nearest_shelter(problem, state.location)
    if shelter is None:
        return None
    s, seconds = shelter
    return problem["shelters"][s]["location"], state.time + seconds + UNLOAD_SECONDS


def _option(problem, state, request):
    """Earliest pickup this vehicle can offer, and whether it joins the open trip."""
    matrix = problem["matrix"]
    if state.trip and state.fits(request):
        seconds = matrix[state.location][request["location"]]
        if seconds is not None and _ride_ok(problem, state, request, state.time + seconds):
            return state.time + seconds, True
    closed = _close_trip(problem, state)
    if closed is None:
        return None
    location, ready = closed
    seconds = matrix[location][request["location"]]
    if seconds is None or not _fits_empty(state.vehicle, request):
        return None
    return ready + seconds, False


def _fits_empty(vehicle, request):
    return all(request["load"][f] <= vehicle[f] for f in CAPACITY_FIELDS)


def _drop_off(problem, state):
    if not state.trip:
        return
    s, seconds = _nearest_shelter(problem, state.location)
    state.time += seconds
    for rider, _ in state.trip:
        state.stops.append({"request": rider["id"], "kind": "dropoff", "shelter": problem["shelters"][s]["id"],
                            "arrival": state.time})
    state.time += UNLOAD_SECONDS
    state.location = problem["shelters"][s]["location"]
    state.trip = []


def _assign(problem, state, request, arrival, joins_trip):
    if not joins_trip:
        _drop_off(problem, state)
    state.stops.append({"request": request["id"], "kind": "pickup", "shelter": None, "arrival": arrival})
    state.trip.append((request, arrival))
    state.location = request["location"]
    state.time = arrival + request["boardingSeconds"]


def solve(problem: dict) -> dict:
    started = time.perf_counter()
    states = [VehicleState(v) for v in problem["vehicles"]]
    dropped = []
    for request in sorted(problem["requests"], key=lambda r: r["deadline"]):
        best = None
        for k in request["allowedVehicles"]:
            option = _option(problem, states[k], request)
            if option is None or option[0] > states[k].vehicle["endBy"]:
                continue
            if best is None or option[0] < best[1]:
                best = (k, option[0], option[1])
        if best is None:
            dropped.append(request["id"])
            continue
        _assign(problem, states[best[0]], request, best[1], best[2])
    for state in states:
        _drop_off(problem, state)
    return {
        "routes": [{"vehicle": s.vehicle["id"], "stops": s.stops} for s in states],
        "dropped": dropped,
        "solver": "heuristic",
        "solveMs": round((time.perf_counter() - started) * 1000),
    }
