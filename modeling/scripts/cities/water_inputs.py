"""Shared pieces for the city modules: reading the sourced inputs and turning a hydrograph into front steps."""

import json
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]


def city_data(city_id: str, name: str) -> dict:
    return json.loads((REPO / "data" / "cities" / city_id / name).read_text())


def parse_local(stamp: str) -> datetime:
    return datetime.fromisoformat(stamp)


def minutes_between(start: str, end: str) -> float:
    return (parse_local(end) - parse_local(start)).total_seconds() / 60


def warning_time(timeline: dict) -> str:
    return timeline["minuteZero"]["at"]


def first_minute_at(points: list[tuple[float, float]], level: float) -> float | None:
    """The first minute the hydrograph reaches level, interpolating between samples."""
    for (m0, z0), (m1, z1) in zip(points, points[1:]):
        if z0 >= level:
            return m0
        if z1 >= level:
            return m0 + (m1 - m0) * (level - z0) / (z1 - z0)
    return None


def rising_steps(points: list[tuple[float, float]], levels: list[float], note: str) -> list[dict]:
    steps = []
    for level in levels:
        minute = first_minute_at(points, level)
        if minute is not None:
            steps.append({"minute": round(minute), "level": level, "note": note.format(level=level)})
    return steps


def series_points(samples: list[dict], start: str, value_key: str = "meters") -> list[tuple[float, float]]:
    return [(minutes_between(start, sample["local"]), sample[value_key]) for sample in samples]
