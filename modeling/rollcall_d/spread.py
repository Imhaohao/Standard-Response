"""A simple wind-driven spread model, used only to generate hazard scenarios.

Fast marching (scikit-fmm) solves for fire arrival time on a uniform fuel grid. Wind makes spread
anisotropic: the rate of spread from a source in direction theta (from the downwind heading) follows the
standard elliptical fire shape with the source at the rear focus,

    ROS(theta) = R_head * (1 - e) / (1 - e cos theta),   e = sqrt(1 - 1 / LB^2)

so a lone ignition on uniform fuel burns the familiar ellipse, and non-burnable cells (if given) make the
front route around them. Spot fires: embers land up to SPOT_DISTANCE downwind of burning cells and start
new fires after a delay, which is how wind-driven urban fires jump ahead.

Conservative within our assumptions, never validated against satellite data: MODIS and VIIRS detections are
about 1 km and 375 m, intermittent, and blocked by smoke, so they can't confirm arrival at a single home.
"""

import math
import random
from dataclasses import dataclass

import numpy as np
import skfmm
from shapely.geometry import box
from shapely.ops import unary_union

from .geo import to_xy


@dataclass
class SpreadConfig:
    origin: tuple[float, float]  # (lat, lng) of the ignition, or where the front enters
    heading_degrees: float = 245.0  # downwind direction of travel, clockwise from north
    head_rate: float = 24.0  # meters per minute
    length_to_breadth: float = 2.0
    head_at_start: float = 450.0  # meters already burned downwind when minute 0 begins
    cell: float = 25.0  # meters
    spot_fires: int = 6  # embers that land and catch during the run
    spot_distance: tuple[float, float] = (300.0, 900.0)  # meters downwind of the front
    spot_delay: tuple[float, float] = (5.0, 20.0)  # minutes from landing to a spreading fire
    seed: int = 7


class Grid:
    def __init__(self, bounds_xy: tuple[float, float, float, float], cell: float):
        self.x0, self.y0, x1, y1 = bounds_xy
        self.cell = cell
        self.nx = int(math.ceil((x1 - self.x0) / cell))
        self.ny = int(math.ceil((y1 - self.y0) / cell))
        xs = self.x0 + (np.arange(self.nx) + 0.5) * cell
        ys = self.y0 + (np.arange(self.ny) + 0.5) * cell
        self.X, self.Y = np.meshgrid(xs, ys)

    def index(self, x: float, y: float) -> tuple[int, int]:
        return int((y - self.y0) / self.cell), int((x - self.x0) / self.cell)


def directional_speed(grid: Grid, source_xy: tuple[float, float], config: SpreadConfig) -> np.ndarray:
    """ROS toward each cell from the source, by the elliptical shape about the rear focus."""
    heading = math.radians(config.heading_degrees)
    hx, hy = math.sin(heading), math.cos(heading)
    dx, dy = grid.X - source_xy[0], grid.Y - source_xy[1]
    distance = np.hypot(dx, dy) + 1e-9
    cos_theta = (dx * hx + dy * hy) / distance
    e = math.sqrt(1 - 1 / config.length_to_breadth**2)
    return config.head_rate * (1 - e) / (1 - e * cos_theta)


def arrival_from(grid: Grid, source_xy: tuple[float, float], config: SpreadConfig, burnable: np.ndarray | None) -> np.ndarray:
    """Minutes for fire to reach every cell from one source. Unburnable cells (if given) never burn."""
    radius = 1.5 * grid.cell  # the source must span a few cells for the level set to exist
    phi = np.hypot(grid.X - source_xy[0], grid.Y - source_xy[1]) - radius
    speed = directional_speed(grid, source_xy, config)
    field = np.ma.MaskedArray(phi, ~burnable) if burnable is not None else phi
    minutes = np.ma.filled(skfmm.travel_time(field, speed, dx=grid.cell), np.inf).astype(float)
    minutes[phi < 0] = 0.0
    return minutes


def simulate(grid: Grid, config: SpreadConfig, burnable: np.ndarray | None = None) -> np.ndarray:
    """Arrival minutes after the warning at every cell. Minute 0 already has head_at_start burned."""
    origin = to_xy(*config.origin)
    head_offset = config.head_at_start / config.head_rate
    arrival = arrival_from(grid, origin, config, burnable) - head_offset
    rng = random.Random(config.seed)
    heading = math.radians(config.heading_degrees)
    for _ in range(config.spot_fires):
        landed = _spot(rng, grid, arrival, heading, config)
        if landed is None:
            continue
        (sx, sy), start = landed
        spot = arrival_from(grid, (sx, sy), config, burnable) + start
        arrival = np.minimum(arrival, spot)
    return arrival


def _spot(rng: random.Random, grid: Grid, arrival: np.ndarray, heading: float, config: SpreadConfig):
    """An ember from a random burning cell at a random time lands downwind, if that spot isn't burning yet."""
    launch_time = rng.uniform(0.0, float(np.nanpercentile(arrival[np.isfinite(arrival)], 60)))
    burning = np.argwhere(np.abs(arrival - launch_time) < grid.cell / config.head_rate)
    if len(burning) == 0:
        return None
    row, col = burning[rng.randrange(len(burning))]
    distance = rng.uniform(*config.spot_distance)
    sway = math.radians(rng.uniform(-20, 20))
    sx = grid.X[row, col] + distance * math.sin(heading + sway)
    sy = grid.Y[row, col] + distance * math.cos(heading + sway)
    r, c = grid.index(sx, sy)
    if not (0 <= r < grid.ny and 0 <= c < grid.nx):
        return None
    start = launch_time + rng.uniform(*config.spot_delay)
    return ((sx, sy), start) if arrival[r, c] > start else None


def front_polygon(grid: Grid, arrival: np.ndarray, minute: float, simplify: float = 12.0):
    """The burned area by `minute`, as one shapely geometry in the metric frame. Rows are merged into runs
    before the union so it stays fast."""
    mask = arrival <= minute
    boxes = []
    for row in range(grid.ny):
        cols = np.flatnonzero(mask[row])
        if len(cols) == 0:
            continue
        runs = np.split(cols, np.flatnonzero(np.diff(cols) > 1) + 1)
        y = grid.y0 + row * grid.cell
        for run in runs:
            boxes.append(box(grid.x0 + run[0] * grid.cell, y, grid.x0 + (run[-1] + 1) * grid.cell, y + grid.cell))
    if not boxes:
        return None
    return unary_union(boxes).simplify(simplify)
