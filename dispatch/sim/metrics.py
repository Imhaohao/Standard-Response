"""Per-run metrics, computed from the finished night."""

from __future__ import annotations

import math

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
}
LOWER_IS_BETTER = {"ridersNeverPickedUp", "worstWaitMinutes", "accessibleWaitMinutes", "vehicleMinutes"}


def waits(night: Night, picked: list[Request]) -> list[tuple[Request, float]]:
    return [(r, (r.picked_at - r.surfaced_at) / MINUTE) for r in picked]


def mean_or_nan(values: list[float]) -> float:
    return sum(values) / len(values) if values else math.nan


def run_metrics(night: Night) -> dict:
    needers = night.world.needers
    picked = [r for r in night.requests.values() if r.status == "picked"]
    on_time = [r for r in picked if r.picked_at <= r.household.deadline_s]
    wait_list = waits(night, picked)
    accessible = [w for r, w in wait_list if r.household.need.accessible]
    return {
        "needers": len(needers),
        "requests": len(night.requests),
        "pickupsOnTime": len(on_time),
        "pickupsLate": len(picked) - len(on_time),
        "ridersNeverPickedUp": len(needers) - len(picked),
        "worstWaitMinutes": max((w for _, w in wait_list), default=0.0),
        "accessibleWaitMinutes": mean_or_nan(accessible),
        "vehicleMinutes": sum(v.busy_seconds for v in night.vehicles) / MINUTE,
    }


def compatibility_violations(night: Night) -> int:
    vehicles = {v.spec.index: v.spec for v in night.vehicles}
    return sum(
        1 for entry in night.pickup_log
        if not vehicle_can_serve(vehicles[entry["vehicle"]], night.world.households[entry["household"]].need)
    )
