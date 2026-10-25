"""Per-run metrics, computed from the finished night."""

from __future__ import annotations

import math

import fatality

from .constants import MINUTE
from .fleetstate import Night, Request
from .population import vehicle_can_serve

METRIC_DEFINITIONS = {
    "pickupsOnTime": "Riders who needed a ride and finished boarding by their deadline (fire arrival minus 10 min). Primary metric. Higher is better.",
    "pickupsLate": "Boarded after the deadline but before the fire arrived. Higher is better.",
    "ridersNeverPickedUp": "Riders who needed a ride and were not aboard before the fire arrived, including ones no policy ever surfaced. Lower is better.",
    "requests": "Riders that reached the dispatcher before the fire arrived.",
    "worstWaitMinutes": "Longest time from a request surfacing to that rider finishing boarding, among riders picked up. Lower is better.",
    "accessibleWaitMinutes": "Mean wait for wheelchair and bedbound riders who were picked up (missing when none were). Lower is better.",
    "vehicleMinutes": "Total minutes vehicles spent on committed runs. Lower is better for the same pickups.",
    "needers": "Households in the night that truly needed a ride.",
    "expectedDeaths": "Deaths the assumed risk model in dispatch/fatality.py expects among riders who needed a ride, from how late each boarded or whether anyone came. An assumption, not a prediction. Lower is better.",
}
LOWER_IS_BETTER = {"expectedDeaths", "ridersNeverPickedUp", "worstWaitMinutes", "accessibleWaitMinutes", "vehicleMinutes"}


def waits(night: Night, picked: list[Request]) -> list[tuple[Request, float]]:
    return [(r, (r.picked_at - r.surfaced_at) / MINUTE) for r in picked]


def mean_or_nan(values: list[float]) -> float:
    return sum(values) / len(values) if values else math.nan


def boarded_at(night: Night) -> dict[int, float]:
    """When each household's last party finished boarding, for households whose every party boarded."""
    parties: dict[int, list[Request]] = {}
    for request in night.requests.values():
        parties.setdefault(request.household.index, []).append(request)
    return {
        index: max(r.picked_at for r in requests)
        for index, requests in parties.items()
        if all(r.status == "picked" for r in requests)
    }


def expected_deaths(night: Night, boarded: dict[int, float]) -> float:
    total = 0.0
    for household in night.world.needers:
        need = household.need
        people = need.seats + need.wheelchair_spaces + need.stretcher_spaces
        at = boarded.get(household.index)
        late = None if at is None else at - household.deadline_s
        total += fatality.expected_deaths(need.weight, people, late)
    return total


def run_metrics(night: Night) -> dict:
    needers = night.world.needers
    boarded = boarded_at(night)
    on_time = [h for h in needers if h.index in boarded and boarded[h.index] <= h.deadline_s]
    picked = [r for r in night.requests.values() if r.status == "picked"]
    wait_list = waits(night, picked)
    accessible = [w for r, w in wait_list if r.need.accessible]
    return {
        "needers": len(needers),
        "requests": len({r.household.index for r in night.requests.values()}),
        "pickupsOnTime": len(on_time),
        "pickupsLate": len(boarded) - len(on_time),
        "ridersNeverPickedUp": len(needers) - len(boarded),
        "worstWaitMinutes": max((w for _, w in wait_list), default=0.0),
        "accessibleWaitMinutes": mean_or_nan(accessible),
        "vehicleMinutes": sum(v.busy_seconds for v in night.vehicles) / MINUTE,
        "expectedDeaths": expected_deaths(night, boarded),
    }


def compatibility_violations(night: Night) -> int:
    vehicles = {v.spec.index: v.spec for v in night.vehicles}
    return sum(
        1 for entry in night.pickup_log
        if not vehicle_can_serve(vehicles[entry["vehicle"]], night.requests[entry["request"]].need)
    )
