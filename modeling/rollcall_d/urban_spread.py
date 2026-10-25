"""Wind-driven spread over real ground, with a wind that shifts and gusts. Used to generate the wildfire scenario.

The fire's arrival time at every cell comes from a shortest-time search over a 10 m grid (16 neighbours, so
fronts don't square off). Each step's rate of spread is the standard elliptical fire shape about the rear
focus, aimed along the wind blowing at the moment the cell caught,

    ROS(theta) = R_head(U) * (1 - e) / (1 - e cos theta),   e = sqrt(1 - 1 / LB(U)^2)

times the fuel factor of the ground it crosses (fire_ground.py): washes stop it, wide roads and open space
hold it, brush speeds it up. The wind is a seeded random walk around a Santa Ana mean, so the head swings
and the spread ellipse narrows in gusts. Burning homes and brush throw embers downwind of the wind of the
moment, which is the only way the fire crosses a wash, and only when the wind is strong.

Scenario input, not a forecast. Every constant is a stated assumption.
"""

import heapq
import math
import random
from dataclasses import dataclass, field

import numpy as np

from .fire_ground import Ground
from .geo import to_xy
from .spread import Grid

# Santa Ana wind out of the east-northeast, as on the night of the Eaton Fire: the fire travels west-southwest.
MEAN_HEADING_DEGREES = 242.0  # direction the fire is pushed, clockwise from north
MEAN_WIND_KMH = 45.0
WIND_STEP_MINUTES = 5.0
HEADING_PULL = 0.2  # share of a heading deviation the mean pulls back each step
HEADING_JITTER_DEGREES = 11.0  # random swing each step; the walk settles near +-25 degrees
SHIFT_CHANCE = 0.1  # chance per step of an abrupt shift, the kind a gust front brings
SHIFT_DEGREES = (25.0, 45.0)
SPEED_PULL = 0.25
SPEED_JITTER_KMH = 7.0
SPEED_RANGE_KMH = (12.0, 90.0)

HEAD_RATE_AT_MEAN = 30.0  # metres a minute through ordinary fuel at the mean wind
WIND_EXPONENT = 1.2  # head rate grows a little faster than the wind
LENGTH_TO_BREADTH_AT_MEAN = 2.2
LENGTH_TO_BREADTH_RANGE = (1.3, 3.5)

# Embers: thrown by a burning home or brush cell, carried downwind, landing after a delay.
SPOT_MIN_WIND_KMH = 30.0
SPOT_CHANCE_AT_MEAN = 0.0012  # per burning ember-source cell
SPOT_MEDIAN_METERS = 130.0  # at the mean wind, scaled with the wind
SPOT_LOG_SPREAD = 0.55
SPOT_MAX_METERS = 900.0
SPOT_SWAY_DEGREES = 12.0
SPOT_DELAY_MINUTES = (4.0, 14.0)
SPOT_CATCH_SCALE = 0.6  # landing catches with this times the landing cell's fuel factor


@dataclass
class WindWalk:
    """Heading and speed every WIND_STEP_MINUTES from `start`, seeded."""

    start: float
    headings: list[float] = field(default_factory=list)  # radians, direction of travel
    speeds: list[float] = field(default_factory=list)  # km/h

    def at(self, minutes: float) -> tuple[float, float]:
        step = int((minutes - self.start) / WIND_STEP_MINUTES)
        step = min(max(step, 0), len(self.headings) - 1)
        return self.headings[step], self.speeds[step]


def wind_walk(seed: int, start: float, end: float) -> WindWalk:
    rng = random.Random(seed)
    walk = WindWalk(math.floor(start / WIND_STEP_MINUTES) * WIND_STEP_MINUTES)
    deviation, speed = 0.0, MEAN_WIND_KMH
    for _ in range(int((end - walk.start) / WIND_STEP_MINUTES) + 2):
        deviation += -HEADING_PULL * deviation + rng.gauss(0, HEADING_JITTER_DEGREES)
        if rng.random() < SHIFT_CHANCE:
            deviation += rng.choice((-1, 1)) * rng.uniform(*SHIFT_DEGREES)
        speed += SPEED_PULL * (MEAN_WIND_KMH - speed) + rng.gauss(0, SPEED_JITTER_KMH)
        speed = min(max(speed, SPEED_RANGE_KMH[0]), SPEED_RANGE_KMH[1])
        walk.headings.append(math.radians(MEAN_HEADING_DEGREES + deviation))
        walk.speeds.append(speed)
    return walk


def head_rate(speed: float) -> float:
    return HEAD_RATE_AT_MEAN * (speed / MEAN_WIND_KMH) ** WIND_EXPONENT


def eccentricity(speed: float) -> float:
    ratio = 1 + (LENGTH_TO_BREADTH_AT_MEAN - 1) * speed / MEAN_WIND_KMH
    ratio = min(max(ratio, LENGTH_TO_BREADTH_RANGE[0]), LENGTH_TO_BREADTH_RANGE[1])
    return math.sqrt(1 - 1 / ratio**2)


def _neighbours() -> list[tuple[int, int, float, float, float, list[tuple[int, int]]]]:
    """(dr, dc, length in cells, unit east, unit north, cells crossed on the way). A diagonal step crosses the
    two cells beside it, so a one-cell street drawn diagonally still has to be crossed."""
    out = []
    for dr in (-2, -1, 0, 1, 2):
        for dc in (-2, -1, 0, 1, 2):
            if (dr, dc) == (0, 0) or math.gcd(abs(dr), abs(dc)) != 1:
                continue
            length = math.hypot(dr, dc)
            crossed = _crossed_cells(dr, dc)
            out.append((dr, dc, length, dc / length, dr / length, crossed))
    return out


def _crossed_cells(dr: int, dc: int) -> list[tuple[int, int]]:
    if abs(dr) + abs(dc) == 1:
        return []
    if abs(dr) == 1 and abs(dc) == 1:
        return [(dr, 0), (0, dc)]
    # Knight's move: the two cells the straight line passes through.
    return [(round(dr / 2 + 0.01 * dr), round(dc / 2 + 0.01 * dc)), (int(dr / 2), int(dc / 2))]


@dataclass
class Search:
    grid: Grid
    slowness: list[float]  # minutes per metre of ordinary-rate travel, divided by fuel; inf never burns
    arrival: list[float]
    rng: random.Random
    walk: WindWalk
    ember_source: list[bool]
    fuel: list[float]
    heap: list = field(default_factory=list)


def _step_slowness(search: Search, row: int, col: int, crossed: list[tuple[int, int]], target: int) -> float:
    """Mean of 1/fuel along a step: half weight on each end cell, full weight on each cell crossed."""
    nx = search.grid.nx
    total = 0.5 * (search.slowness[row * nx + col] + search.slowness[target])
    for dr, dc in crossed:
        total += search.slowness[(row + dr) * nx + col + dc]
    return total / (1 + len(crossed))


def _relax(search: Search, index: int, now: float, neighbours) -> None:
    grid = search.grid
    row, col = divmod(index, grid.nx)
    heading, speed = search.walk.at(now)
    hx, hy, rate, e = math.sin(heading), math.cos(heading), head_rate(speed), eccentricity(speed)
    for dr, dc, length, ux, uy, crossed in neighbours:
        r, c = row + dr, col + dc
        if not (0 <= r < grid.ny and 0 <= c < grid.nx):
            continue
        target = r * grid.nx + c
        if search.arrival[target] <= now:
            continue
        slowness = _step_slowness(search, row, col, crossed, target)
        if slowness == math.inf:
            continue
        ros = rate * (1 - e) / (1 - e * (ux * hx + uy * hy))
        arrival = now + length * grid.cell * slowness / ros
        if arrival < search.arrival[target]:
            search.arrival[target] = arrival
            heapq.heappush(search.heap, (arrival, target))


def _throw_ember(search: Search, index: int, now: float) -> None:
    heading, speed = search.walk.at(now)
    if speed < SPOT_MIN_WIND_KMH or not search.ember_source[index]:
        return
    if search.rng.random() >= SPOT_CHANCE_AT_MEAN * (speed / MEAN_WIND_KMH) ** 2:
        return
    grid = search.grid
    distance = min(SPOT_MAX_METERS, SPOT_MEDIAN_METERS * speed / MEAN_WIND_KMH * math.exp(search.rng.gauss(0, SPOT_LOG_SPREAD)))
    sway = heading + math.radians(search.rng.gauss(0, SPOT_SWAY_DEGREES))
    row, col = divmod(index, grid.nx)
    r = row + int(round(distance * math.cos(sway) / grid.cell))
    c = col + int(round(distance * math.sin(sway) / grid.cell))
    if not (0 <= r < grid.ny and 0 <= c < grid.nx):
        return
    landing = r * grid.nx + c
    catches = search.rng.random() < SPOT_CATCH_SCALE * min(1.0, search.fuel[landing])
    start = now + search.rng.uniform(*SPOT_DELAY_MINUTES)
    if catches and start < search.arrival[landing]:
        search.arrival[landing] = start
        heapq.heappush(search.heap, (start, landing))


def simulate_urban(grid: Grid, ground: Ground, origin: tuple[float, float], ignition_minute: float, until: float, seed: int) -> tuple[np.ndarray, WindWalk]:
    """Arrival minutes at every cell (inf where it never burns by `until`), and the wind that drove it."""
    walk = wind_walk(seed, ignition_minute, until)
    fuel = ground.fuel.ravel()
    slowness = np.where(fuel > 0, 1.0 / np.maximum(fuel, 1e-6), np.inf)
    search = Search(grid, slowness.tolist(), [math.inf] * fuel.size, random.Random(seed + 1), walk, ground.ember_source.ravel().tolist(), fuel.tolist())
    row, col = grid.index(*to_xy(*origin))
    start = row * grid.nx + col
    search.arrival[start] = ignition_minute
    search.heap.append((ignition_minute, start))
    neighbours = _neighbours()
    done = bytearray(fuel.size)
    while search.heap:
        now, index = heapq.heappop(search.heap)
        if done[index] or now > until:
            continue
        done[index] = 1
        _throw_ember(search, index, now)
        _relax(search, index, now, neighbours)
    arrival = np.array(search.arrival).reshape(grid.ny, grid.nx)
    arrival[arrival > until] = np.inf
    return arrival, walk
