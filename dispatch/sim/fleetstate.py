"""Shared mutable state for one night: requests, vehicles and the run log."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import simpy

from . import trace
from .population import Household, RideNeed, VehicleSpec, parties_for, vehicle_can_serve
from .world import World

# A household's second party (everyone the patient's vehicle cannot seat) gets its own request id.
PARTY_ID_STRIDE = 1_000_000


@dataclass
class Request:
    household: Household
    need: RideNeed
    surfaced_at: float
    party: int = 0
    status: str = "pending"  # pending | committed | picked | expired | unservable
    picked_at: float | None = None
    attempts: int = 0
    picked_by: int | None = None
    tried_vehicles: set = field(default_factory=set)

    @property
    def index(self) -> int:
        return self.household.index + self.party * PARTY_ID_STRIDE


@dataclass
class Vehicle:
    spec: VehicleSpec
    node: int
    free_at: float = 0.0
    end_node: int = -1
    busy: bool = False
    busy_seconds: float = 0.0

    def __post_init__(self):
        self.end_node = self.node


@dataclass
class Night:
    """What the dispatcher and the vehicles share during one simulated night."""

    env: simpy.Environment
    world: World
    requests: dict[int, Request] = field(default_factory=dict)
    vehicles: list[Vehicle] = field(default_factory=list)
    pickup_log: list[dict] = field(default_factory=list)
    capacity_violations: int = 0
    vehicle_freed: bool = False
    new_request_since: float | None = None

    def __post_init__(self):
        for spec, node in zip(self.world.fleet, self.world.vehicle_nodes):
            self.vehicles.append(Vehicle(spec, node))

    def surface(self, household: Household):
        for party, need in enumerate(parties_for(household.need, self.world.fleet)):
            request = Request(household, need, self.env.now, party)
            self.requests[request.index] = request
        if self.new_request_since is None:
            self.new_request_since = self.env.now

    def expire_overdue(self):
        for request in self.requests.values():
            if request.status == "pending" and self.env.now >= request.household.fire_arrival_s:
                request.status = "expired"

    def pending(self) -> list[Request]:
        self.expire_overdue()
        return sorted((r for r in self.requests.values() if r.status == "pending"), key=lambda r: r.index)

    def compatible_vehicles(self, request: Request) -> list[int]:
        return [v.spec.index for v in self.vehicles if vehicle_can_serve(v.spec, request.need)]

    def travel(self, a: int, b: int) -> float:
        return self.world.travel.seconds(a, b, self.env.now)

    def finish_pickup(self, request: Request, vehicle: Vehicle):
        request.status = "picked"
        request.picked_at = self.env.now
        request.picked_by = vehicle.spec.index
        self.pickup_log.append({"request": request.index, "vehicle": vehicle.spec.index, "at": self.env.now})
        trace.note(self.env.now, "pickup", request.index, vehicle.spec.index)

    def release(self, request: Request):
        request.status = "pending"
        request.attempts += 1

    def unreachable_fallback(self, a: int, b: int) -> float:
        """Riders already aboard are never stranded: use the no-closure time."""
        seconds = self.world.travel.seconds(a, b, 0.0)
        return seconds if math.isfinite(seconds) else 0.0


def arrival_feeder(night: Night, stream, on_arrival):
    for at, index in stream:
        yield night.env.timeout(max(at - night.env.now, 0.0))
        night.surface(night.world.households[index])
        on_arrival()
