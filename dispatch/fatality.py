"""Assumed fatality-risk model. It prices the solver's objective and scores simulated nights.
convex/fatalityRisk.ts mirrors it for the rescue map; change both together.

This is an assumption, not a prediction about real people. A rider's chance of dying grows with
their need weight (convex/model.ts weightFor: 1 can walk, 3 needs an accessible vehicle, +1 on
oxygen). It is zero when they board by their deadline and rises linearly to its maximum at fire
arrival, 10 minutes after the deadline (DEADLINE_MARGIN_MINUTES). Nobody coming at all is the maximum.
"""

from __future__ import annotations

DEATH_SHARE_PER_WEIGHT = 0.2
MAX_DEATH_SHARE = 0.9
RAMP_SECONDS = 10 * 60


def party_size(load: dict) -> int:
    return int(load["seats"]) + int(load["wheelchairSpaces"]) + int(load["stretcherSpaces"])


def deaths_if_unserved(weight: float, people: int) -> float:
    return people * min(MAX_DEATH_SHARE, DEATH_SHARE_PER_WEIGHT * weight)


def expected_deaths(weight: float, people: int, seconds_late: float | None) -> float:
    """seconds_late is boarding time minus deadline; None means nobody picked them up."""
    worst = deaths_if_unserved(weight, people)
    if seconds_late is None:
        return worst
    return worst * min(1.0, max(0.0, seconds_late / RAMP_SECONDS))
