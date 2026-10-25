"""The re-planning dispatcher: builds the shared problem, calls heuristic.solve or solver.solve, and
commits each idle vehicle to the first trip of its returned route (accepted runs are frozen)."""

from __future__ import annotations

import math
import time
from typing import Callable

from . import rng, trace
from .constants import DRIVER_CANCEL_PROB, OXYGEN_MAX_RIDE_S, SHELTER, TICK_S, UNLOAD_S
from .fleetstate import Night, Request, Vehicle, arrival_feeder

Solve = Callable[[dict], dict]


def request_entry(request: Request, now: float, allowed: list[int], location: int) -> dict:
    need = request.need
    return {
        "id": request.index,
        "location": location,
        "load": {"seats": need.seats, "wheelchairSpaces": need.wheelchair_spaces, "stretcherSpaces": need.stretcher_spaces},
        "boardingSeconds": need.boarding_s,
        "deadline": request.household.deadline_s - now,
        "weight": need.weight,
        "allowedVehicles": allowed,
        "openOfferVehicle": None,
        "maxRideSeconds": OXYGEN_MAX_RIDE_S if need.oxygen else None,
    }


def vehicle_entry(vehicle: Vehicle, now: float, location: int, shift_end: float) -> dict:
    spec = vehicle.spec
    return {
        "id": spec.index, "location": location, "availableAt": max(vehicle.free_at - now, 0.0),
        "endBy": shift_end - now, "seats": spec.seats,
        "wheelchairSpaces": spec.wheelchair_spaces, "stretcherSpaces": spec.stretcher_spaces,
    }


def build_problem(night: Night, requests: list[Request], time_limit_s: float) -> dict:
    now = night.env.now
    nodes: list[int] = []
    position: dict[int, int] = {}

    def locate(node: int) -> int:
        if node not in position:
            position[node] = len(nodes)
            nodes.append(node)
        return position[node]

    vehicles = [vehicle_entry(v, now, locate(v.end_node), night.world.shift_end_s) for v in night.vehicles]
    entries = [request_entry(r, now, night.compatible_vehicles(r), locate(r.household.node)) for r in requests]
    shelter = {"id": "shelter", "location": locate(night.world.shelter_node), "capacity": SHELTER["capacity"]}
    return {
        "locations": [{"lat": 0, "lng": 0}] * len(nodes),
        "matrix": night.world.travel.matrix(nodes, now),
        "vehicles": vehicles, "requests": entries, "shelters": [shelter], "timeLimitSeconds": time_limit_s,
    }


def first_trip(stops: list[dict]) -> list[dict]:
    """Stops up to and including the drop-offs that empty the vehicle."""
    trip, aboard = [], set()
    for stop in stops:
        trip.append(stop)
        if stop["kind"] == "pickup":
            aboard.add(stop["request"])
            continue
        aboard.discard(stop["request"])
        if not aboard:
            break
    return trip


def driver_cancels(night: Night, request: Request) -> bool:
    draw = rng.chance(night.world.seed, "cancel", request.index, request.attempts)
    return draw < DRIVER_CANCEL_PROB


def trip_load_fits(night: Night, vehicle: Vehicle, trip: list[dict]) -> bool:
    """Peak load along the trip, not the sum of all riders, must fit the vehicle."""
    spec = vehicle.spec
    limits = (spec.seats, spec.wheelchair_spaces, spec.stretcher_spaces)
    onboard = [0, 0, 0]
    for stop in trip:
        need = night.requests[stop["request"]].need
        sign = 1 if stop["kind"] == "pickup" else -1
        amounts = (need.seats, need.wheelchair_spaces, need.stretcher_spaces)
        onboard = [have + sign * amount for have, amount in zip(onboard, amounts)]
        if any(have > limit for have, limit in zip(onboard, limits)):
            return False
    return True


def accepted_stops(night: Night, vehicle: Vehicle, trip: list[dict]) -> list[dict]:
    kept, cancelled = [], set()
    for stop in trip:
        request = night.requests[stop["request"]]
        if stop["kind"] == "pickup" and driver_cancels(night, request):
            trace.note(night.env.now, "cancel", request.index, vehicle.spec.index)
            cancelled.add(request.index)
            night.release(request)
    for stop in trip:
        if stop["request"] not in cancelled:
            kept.append(stop)
    return kept


def drive_trip(night: Night, vehicle: Vehicle, stops: list[dict]):
    env, started, aboard, at_shelter = night.env, night.env.now, set(), False
    for stop in stops:
        request = night.requests[stop["request"]]
        if stop["kind"] == "pickup":
            at_shelter = False
            yield from visit_pickup(night, vehicle, request, aboard)
        elif request.index in aboard and not at_shelter:
            yield from visit_shelter(night, vehicle)
            at_shelter = True
    vehicle.busy = False
    vehicle.free_at = env.now
    vehicle.end_node = vehicle.node
    vehicle.busy_seconds += env.now - started
    night.vehicle_freed = True


def visit_pickup(night: Night, vehicle: Vehicle, request: Request, aboard: set):
    seconds = night.travel(vehicle.node, request.household.node)
    if not math.isfinite(seconds):
        trace.note(night.env.now, "noRoad", request.index, vehicle.spec.index)
        night.release(request)
        return
    trace.note(night.env.now, "leg", vehicle.spec.index, vehicle.node, request.household.node, seconds)
    yield night.env.timeout(seconds)
    vehicle.node = request.household.node
    trace.note(night.env.now, "arrive", request.index, vehicle.spec.index)
    yield night.env.timeout(request.need.boarding_s)
    if night.env.now > request.household.fire_arrival_s:
        trace.note(night.env.now, "expired", request.index, vehicle.spec.index)
        request.status = "expired"
        return
    night.finish_pickup(request, vehicle)
    aboard.add(request.index)


def visit_shelter(night: Night, vehicle: Vehicle):
    shelter = night.world.shelter_node
    seconds = night.travel(vehicle.node, shelter)
    seconds = seconds if math.isfinite(seconds) else night.unreachable_fallback(vehicle.node, shelter)
    trace.note(night.env.now, "leg", vehicle.spec.index, vehicle.node, shelter, seconds)
    yield night.env.timeout(seconds)
    vehicle.node = shelter
    yield night.env.timeout(UNLOAD_S)
    trace.note(night.env.now, "dropoff", vehicle.spec.index)


def estimate_run_seconds(night: Night, vehicle: Vehicle, stops: list[dict]) -> float:
    total, node, at_shelter = 0.0, vehicle.node, False
    for stop in stops:
        if stop["kind"] == "dropoff" and at_shelter:
            continue
        pickup = stop["kind"] == "pickup"
        target = night.requests[stop["request"]].household.node if pickup else night.world.shelter_node
        seconds = night.travel(node, target)
        total += seconds if math.isfinite(seconds) else 0.0
        total += night.requests[stop["request"]].need.boarding_s if pickup else UNLOAD_S
        node, at_shelter = target, not pickup
    return total


def commit_trip(night: Night, vehicle: Vehicle, trip: list[dict]):
    if not trip_load_fits(night, vehicle, trip):
        night.capacity_violations += 1
        return
    stops = accepted_stops(night, vehicle, trip)
    if not any(s["kind"] == "pickup" for s in stops):
        return
    for stop in stops:
        if stop["kind"] == "pickup":
            night.requests[stop["request"]].status = "committed"
    trace.note(night.env.now, "accepted", vehicle.spec.index, [s["request"] for s in stops if s["kind"] == "pickup"])
    vehicle.busy = True
    vehicle.free_at = night.env.now + estimate_run_seconds(night, vehicle, stops)
    vehicle.end_node = night.world.shelter_node
    night.env.process(drive_trip(night, vehicle, stops))


class OptimizerPolicy:
    def __init__(self, night: Night, stream, solve: Solve):
        self.night, self.solve, self.last_plan = night, solve, -math.inf
        self.config = night.world.config
        self.solve_count = 0
        night.env.process(arrival_feeder(night, stream, lambda: None))
        night.env.process(self.planner())

    def plan_due(self) -> bool:
        night, now = self.night, self.night.env.now
        if night.new_request_since is not None and now - night.new_request_since >= self.config.debounce_s:
            return True
        if night.vehicle_freed and any(not v.busy for v in night.vehicles):
            return True
        return now - self.last_plan >= self.config.replan_every_s

    def planner(self):
        night = self.night
        while True:
            yield night.env.timeout(TICK_S)
            if self.plan_due():
                self.replan()

    def replan(self):
        night = self.night
        night.new_request_since = None
        night.vehicle_freed = False
        self.last_plan = night.env.now
        servable = self.servable_window()
        if not servable or all(v.busy for v in night.vehicles):
            return
        problem = build_problem(night, servable, self.config.solver_time_limit_s)
        started = time.perf_counter()
        result = self.solve(problem)
        self.solve_count += 1
        trace.note(night.env.now, "plan", self.solve_count, len(servable), round((time.perf_counter() - started) * 1000))
        self.commit_idle_vehicles(result)

    def servable_window(self) -> list[Request]:
        """Pending requests some vehicle can carry and that can still reach the shelter; the planning
        window keeps the earliest deadlines. (heuristic.solve crashes on a pickup with no road to a shelter.)"""
        night = self.night
        pending = night.pending()
        for request in pending:
            if not night.compatible_vehicles(request):
                request.status = "unservable"
        shelter = night.world.shelter_node
        servable = [r for r in pending if r.status == "pending" and math.isfinite(night.travel(r.household.node, shelter))]
        servable.sort(key=lambda r: (r.household.deadline_s, r.index))
        return servable[: self.config.plan_window]

    def commit_idle_vehicles(self, result: dict):
        for route in result["routes"]:
            vehicle = self.night.vehicles[route["vehicle"]]
            if vehicle.busy or not route["stops"]:
                continue
            commit_trip(self.night, vehicle, first_trip(route["stops"]))
