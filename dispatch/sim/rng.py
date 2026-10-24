"""Keyed random draws. Every random number is a pure function of (seed, stream, keys), so two
policies that touch the same household draw the same numbers and comparisons are paired."""

from __future__ import annotations

import numpy as np

STREAMS = {name: i for i, name in enumerate([
    "population", "fleet", "answer", "callLength", "textReply", "doorVisit", "doorTeams",
    "call911", "lead911", "service911", "radio", "cancel", "exploration", "departure",
])}


def generator(seed: int, stream: str, *keys: int) -> np.random.Generator:
    return np.random.default_rng([seed, STREAMS[stream], *keys])


def uniform(seed: int, stream: str, low: float, high: float, *keys: int) -> float:
    return float(generator(seed, stream, *keys).uniform(low, high))


def chance(seed: int, stream: str, *keys: int) -> float:
    return float(generator(seed, stream, *keys).random())
