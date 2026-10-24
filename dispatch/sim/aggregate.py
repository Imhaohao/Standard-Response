"""Medians, 5th-95th percentile ranges and paired differences, plus the plain-language headlines."""

from __future__ import annotations

import math

import numpy as np

from .metrics import LOWER_IS_BETTER

REPORTED_METRICS = [
    "expectedDeaths", "pickupsOnTime", "pickupsLate", "ridersNeverPickedUp", "requests",
    "worstWaitMinutes", "accessibleWaitMinutes", "vehicleMinutes", "needers",
]


def summarize(values) -> dict:
    clean = np.array([v for v in values if v is not None and math.isfinite(v)], dtype=float)
    if clean.size == 0:
        return {"median": None, "p5": None, "p95": None, "n": 0}
    p5, median, p95 = np.percentile(clean, [5, 50, 95])
    return {"median": round(float(median), 2), "p5": round(float(p5), 2), "p95": round(float(p95), 2), "n": int(clean.size)}


def paired_difference(first: list[dict], second: list[dict], metric: str) -> dict:
    """second minus first, seed by seed; seeds where either side has no value are skipped."""
    pairs = [(a[metric], b[metric]) for a, b in zip(first, second)]
    return summarize([b - a for a, b in pairs if math.isfinite(a) and math.isfinite(b)])


def policy_block(runs: list[dict]) -> dict:
    return {metric: summarize([r[metric] for r in runs]) for metric in REPORTED_METRICS}


def difference_block(first: list[dict], second: list[dict]) -> dict:
    return {metric: paired_difference(first, second, metric) for metric in REPORTED_METRICS}


def comparison(first: list[dict], second: list[dict], first_name: str, second_name: str) -> dict:
    return {
        "difference": difference_block(first, second),
        "differenceMeaning": f"{second_name} minus {first_name}, per seed",
        "policies": {first_name: policy_block(first), second_name: policy_block(second)},
    }


def span(summary: dict, digits: int = 1) -> str:
    return f"{summary['median']:.{digits}f} (5th to 95th percentile {summary['p5']:.{digits}f} to {summary['p95']:.{digits}f})"


def signed_span(summary: dict, digits: int = 1) -> str:
    return f"{summary['median']:+.{digits}f} (5th to 95th percentile {summary['p5']:+.{digits}f} to {summary['p95']:+.{digits}f})"


def headline(block: dict, first_name: str, second_name: str, seeds: int, subject: str) -> str:
    diff = block["difference"]["pickupsOnTime"]
    first = block["policies"][first_name]["pickupsOnTime"]
    second = block["policies"][second_name]["pickupsOnTime"]
    return (
        f"{subject}: change in on-time pickups, {second_name} minus {first_name}, median {signed_span(diff)} "
        f"across {seeds} paired seeds. On-time pickups, median: {first_name} {span(first)}, {second_name} {span(second)}."
    )


def todays_headline(block: dict, seeds: int) -> str:
    pickups = block["pickupsOnTime"]
    never = block["ridersNeverPickedUp"]
    needers = block["needers"]
    return (
        f"Today's process alone (911, first come first served, nearest unit) finished {span(pickups)} on-time pickups "
        f"and left {span(never)} riders unpicked, out of {span(needers, 0)} riders who needed a ride, across {seeds} seeds."
    )


def is_better(metric: str, difference: float) -> bool:
    return difference < 0 if metric in LOWER_IS_BETTER else difference > 0
