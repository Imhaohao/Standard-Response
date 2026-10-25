"""Today's process, for context only: first come first served, nearest idle unit, a radio delay before
the unit moves, one rider per trip and no matching by need. An incompatible unit arrives, cannot load
the rider, and the request goes back in line without that unit."""

from __future__ import annotations

import math

from . import rng
from .constants import RADIO_DELAY_S, UNLOAD_S
from .fleetstate import Night, Request, Vehicle, arrival_feeder
from .population import vehicle_can_serve


class TodayPolicy:
    def __init__(self, night: Night, stream):
        self.night = night
        night.env.process(arrival_feeder(night, stream, self.dispatch))

    def nearest_untried_idle(self, request: Request) -> Vehicle | None:
        best, best_seconds = None, math.inf
        for vehicle in self.night.vehicles:
            if vehicle.busy or vehicle.spec.index in request.tried_vehicles:
                continue
            seconds = self.night.travel(vehicle.node, request.household.node)
            if seconds < best_seconds:
                best, best_seconds = vehicle, seconds
        return best

    def dispatch(self):
        while True:
            assignment = self.next_assignment()
            if assignment is None:
                return
            request, vehicle = assignment
            request.status = "committed"
            vehicle.busy = True
            self.night.env.process(self.run_unit(vehicle, request))

    def next_assignment(self):
        for request in sorted(self.night.pending(), key=lambda r: (r.surfaced_at, r.index)):
            vehicle = self.nearest_untried_idle(request)
            if vehicle is not None:
                return request, vehicle
        return None

    def run_unit(self, vehicle: Vehicle, request: Request):
        night, started = self.night, self.night.env.now
        yield night.env.timeout(rng.uniform(night.world.seed, "radio", *RADIO_DELAY_S, request.index, request.attempts))
        yield from self.drive_and_load(vehicle, request)
        vehicle.busy = False
        vehicle.free_at = night.env.now
        vehicle.busy_seconds += night.env.now - started
        self.dispatch()

    def drive_and_load(self, vehicle: Vehicle, request: Request):
        night, household = self.night, request.household
        seconds = night.travel(vehicle.node, household.node)
        if not math.isfinite(seconds):
            request.tried_vehicles.add(vehicle.spec.index)
            night.release(request)
            return
        yield night.env.timeout(seconds)
        vehicle.node = household.node
        if not vehicle_can_serve(vehicle.spec, request.need) or night.env.now >= household.fire_arrival_s:
            request.tried_vehicles.add(vehicle.spec.index)
            night.release(request)
            return
        yield from self.load_and_deliver(vehicle, request)

    def load_and_deliver(self, vehicle: Vehicle, request: Request):
        night = self.night
        yield night.env.timeout(request.need.boarding_s)
        if night.env.now > request.household.fire_arrival_s:
            request.status = "expired"
            return
        night.finish_pickup(request, vehicle)
        shelter = night.world.shelter_node
        seconds = night.travel(vehicle.node, shelter)
        yield night.env.timeout(seconds if math.isfinite(seconds) else night.unreachable_fallback(vehicle.node, shelter))
        vehicle.node = shelter
        yield night.env.timeout(UNLOAD_S)
