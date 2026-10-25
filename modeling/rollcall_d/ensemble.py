"""Ensemble spread: run the spread model many times under plausible winds and report burn probability.

Each member draws one forecast hour, then nudges its direction and speed by typical forecast error, turns
that wind into spread parameters, and runs `spread.simulate` with its own spot-fire seed. For a probability
p, the p-quantile of arrival time across members at a cell is the minute by which at least a share p of
members have burned it, so "q_p <= t" is exactly "P(burned by minute t) >= p".

Wind to spread, both stated assumptions rather than calibrated fits:
- Head rate: the 10% rule of thumb (Cruz & Alexander 2019): forward spread in shrubland is about 10% of
  the 10 m open wind speed. Below a floor the rule breaks down, so spread never drops under FLOOR_RATE.
- Shape: Anderson (1983) length-to-breadth from midflame wind, with midflame taken as 0.4 of the 10 m wind.
"""

import math
import random
from dataclasses import dataclass, replace

import numpy as np

from . import urban_spread
from .fire_ground import Ground
from .spread import Grid, SpreadConfig, simulate
from .weather import WindHour

TEN_PERCENT_RULE = 0.10
FLOOR_RATE = 3.0  # meters per minute
MIDFLAME_FACTOR = 0.4
LENGTH_TO_BREADTH_RANGE = (1.0, 5.0)
DIRECTION_SD = 20.0  # degrees, typical error of a few-hour wind direction forecast
SPEED_SD = 0.25  # log-normal, about +/-25%
NEVER = 1e4
KMH_TO_M_PER_MIN = 1000.0 / 60.0
KMH_TO_MPH = 0.621371


@dataclass(frozen=True)
class Member:
    heading_degrees: float
    speed_kmh: float
    head_rate: float
    length_to_breadth: float
    seed: int


def head_rate_for(speed_kmh: float) -> float:
    return max(FLOOR_RATE, TEN_PERCENT_RULE * speed_kmh * KMH_TO_M_PER_MIN)


def length_to_breadth_for(speed_kmh: float) -> float:
    midflame_mph = MIDFLAME_FACTOR * speed_kmh * KMH_TO_MPH
    ratio = 0.936 * math.exp(0.2566 * midflame_mph) + 0.461 * math.exp(-0.1548 * midflame_mph) - 0.397
    low, high = LENGTH_TO_BREADTH_RANGE
    return min(high, max(low, ratio))


def draw_members(hours: list[WindHour], count: int, seed: int) -> list[Member]:
    rng = random.Random(seed)
    members = []
    for index in range(count):
        hour = rng.choice(hours)
        speed = hour.speed_kmh * math.exp(rng.gauss(0.0, SPEED_SD))
        heading = (hour.heading_degrees + rng.gauss(0.0, DIRECTION_SD)) % 360.0
        members.append(Member(heading, speed, head_rate_for(speed), length_to_breadth_for(speed), seed * 1000 + index))
    return members


def scenario_members(base: SpreadConfig, count: int, seed: int) -> list[Member]:
    """Fallback when no live wind: the scenario's own heading and head rate, with the same forecast-error spread."""
    rng = random.Random(seed)
    members = []
    for index in range(count):
        rate = base.head_rate * math.exp(rng.gauss(0.0, SPEED_SD))
        heading = (base.heading_degrees + rng.gauss(0.0, DIRECTION_SD)) % 360.0
        members.append(Member(heading, rate / (TEN_PERCENT_RULE * KMH_TO_M_PER_MIN), rate, base.length_to_breadth, seed * 1000 + index))
    return members


def run_members(grid: Grid, base: SpreadConfig, members: list[Member]) -> np.ndarray:
    """Arrival minutes per member, shape (members, ny, nx). Cells a member never burns hold NEVER."""
    runs = []
    for member in members:
        config = replace(base, heading_degrees=member.heading_degrees, head_rate=member.head_rate,
                         length_to_breadth=member.length_to_breadth, seed=member.seed)
        runs.append(np.nan_to_num(simulate(grid, config), nan=NEVER, posinf=NEVER))
    return np.minimum(np.stack(runs), NEVER)


def urban_scenario_members(count: int, seed: int) -> list[Member]:
    """Fallback when no live wind, for the ground-aware model: the scenario's Santa Ana mean with the forecast-error spread."""
    rng = random.Random(seed)
    members = []
    for index in range(count):
        speed = urban_spread.MEAN_WIND_KMH * math.exp(rng.gauss(0.0, SPEED_SD))
        heading = (urban_spread.MEAN_HEADING_DEGREES + rng.gauss(0.0, DIRECTION_SD)) % 360.0
        members.append(Member(heading, speed, urban_spread.head_rate(speed), length_to_breadth_for(speed), seed * 1000 + index))
    return members


def run_urban_members(grid: Grid, ground: Ground, origin: tuple[float, float] | None, ignition_minute: float, until: float,
                      members: list[Member], burning: np.ndarray | None = None) -> np.ndarray:
    """As run_members, over real ground (urban_spread): each member's wind walks around its own heading and speed,
    so the forecast bands respect the same washes, roads and open ground as the scenario fire. Given `burning`,
    every member spreads on from that burned area instead of igniting at `origin`."""
    runs = []
    for member in members:
        arrival, _ = urban_spread.simulate_urban(grid, ground, origin, ignition_minute, until, member.seed,
                                                 mean_heading=member.heading_degrees, mean_kmh=member.speed_kmh, burning=burning)
        runs.append(np.minimum(np.nan_to_num(arrival, nan=NEVER, posinf=NEVER), NEVER).astype(np.float32))
    return np.stack(runs)


def burn_quantiles(arrivals: np.ndarray, probabilities: list[float]) -> dict[float, np.ndarray]:
    """For each p, the minute by which at least a share p of members have burned each cell."""
    return {p: np.quantile(arrivals, p, axis=0, method="inverted_cdf") for p in probabilities}
