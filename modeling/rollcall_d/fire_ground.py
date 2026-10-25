"""The ground the scenario fire burns over, rasterized from the baked OSM map the ink map draws.

Every barrier comes from `public/map/altadena.json` (scripts/map/bake.mjs, OpenStreetMap; buildings as of
December 2024, before the Eaton Fire), so the fire stops at the same washes, parks and streets the
dispatcher sees on screen. Each cell gets a fuel factor: a multiplier on the wind-driven rate of spread,
where 1 is Altadena's ordinary mix of wood-frame homes and dry yards, and 0 never burns.

Every factor below is a stated assumption, not fitted to any fire.
"""

import json
import math
import random
from dataclasses import dataclass

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon

from .geo import to_xy
from .paths import REPO
from .spread import Grid

MAP_FILE = REPO / "public" / "map" / "altadena.json"

# Kinds as baked (lib/ink-map/data.ts AREA_KIND, BUILDING_KIND).
PARK, GRASS, WATER, SCHOOL, PARKING, CEMETERY, GOLF, PITCH, WILD = range(9)
HOUSE, APARTMENTS, OUTBUILDING, COMMERCIAL, CIVIC = range(5)

# Open ground burns slowly or not at all: irrigated turf, asphalt and bare fields carry little fuel.
# Wood and scrub (chaparral) carry the most. Water, reservoirs and the Arroyo Seco channel never burn.
AREA_FUEL = {PARK: 0.2, GRASS: 0.45, WATER: 0.0, SCHOOL: 0.2, PARKING: 0.06, CEMETERY: 0.15, GOLF: 0.12, PITCH: 0.1, WILD: 1.9}

# Pavement is a fuel break whose strength grows with width. Indexed by the baked road class:
# freeway, primary, secondary, tertiary, residential, service. Tracks and footpaths don't count.
ROAD_FUEL = [0.04, 0.08, 0.12, 0.18, 0.32, 0.6]
ROAD_WIDTH_METERS = [20, 15, 13, 11, 8, 4.5]

# Structures: wood-frame homes burn like the yards around them; masonry shops and civic buildings resist.
BUILDING_FUEL = {HOUSE: 1.0, APARTMENTS: 0.9, OUTBUILDING: 1.2, COMMERCIAL: 0.4, CIVIC: 0.35}
# Homes built or rebuilt to California's wildfire code (Chapter 7A, from 2008): Class A roofs, ember-resistant
# vents, noncombustible siding. Most of west Altadena predates it.
HARDENED_SHARE = 0.12
HARDENED_FUEL = 0.25
# The chance a building never catches at all, which is what leaves standing homes inside a burn scar.
NEVER_IGNITES = {HOUSE: 0.03, APARTMENTS: 0.05, OUTBUILDING: 0.0, COMMERCIAL: 0.3, CIVIC: 0.4}
HARDENED_NEVER_IGNITES = 0.5

# Yards vary block to block: irrigated lawns and cleared lots against dry hedges and pine. A smooth seeded
# field scales yard fuel by up to this much either way, and makes surviving homes cluster in the lawns.
PATCH_METERS = 240.0
PATCH_SPREAD = 0.4


@dataclass
class Ground:
    fuel: np.ndarray  # fuel factor per cell, rows are y
    water: np.ndarray  # True on washes and open water
    ember_source: np.ndarray  # cells that throw embers once burning: homes, yards and brush


def _map_to_xy(origin: dict, flat: list[int], start: int) -> np.ndarray:
    """Baked decimetres east and north of the map's origin, to this package's metric frame."""
    points = np.array(flat[start:start + (len(flat) - start) // 2 * 2], dtype=float).reshape(-1, 2) / 10.0
    lat = origin["lat"] + points[:, 1] / 110_574.0
    lng = origin["lng"] + points[:, 0] / (111_320.0 * math.cos(math.radians(origin["lat"])))
    x, y = to_xy(lat, lng)
    return np.column_stack([x, y])


def _cells_inside(grid: Grid, geometry) -> tuple[np.ndarray, np.ndarray]:
    """Row and column indices of the cells whose centres lie inside a shape."""
    x0, y0, x1, y1 = geometry.bounds
    c0, c1 = max(0, int((x0 - grid.x0) / grid.cell)), min(grid.nx, int((x1 - grid.x0) / grid.cell) + 1)
    r0, r1 = max(0, int((y0 - grid.y0) / grid.cell)), min(grid.ny, int((y1 - grid.y0) / grid.cell) + 1)
    if c0 >= c1 or r0 >= r1:
        return np.array([], dtype=int), np.array([], dtype=int)
    inside = shapely.contains_xy(geometry, grid.X[r0:r1, c0:c1], grid.Y[r0:r1, c0:c1])
    rows, cols = np.nonzero(inside)
    return rows + r0, cols + c0


def _polygon(origin: dict, flat: list[int], start: int) -> Polygon | None:
    ring = _map_to_xy(origin, flat, start)
    if len(ring) < 3:
        return None
    polygon = Polygon(ring)
    return polygon if polygon.is_valid else polygon.buffer(0)


def _patches(grid: Grid, seed: int) -> np.ndarray:
    """Smooth noise in [-1, 1]: a coarse seeded lattice, bilinearly interpolated onto the grid."""
    rng = np.random.default_rng(seed)
    step = max(1, int(PATCH_METERS / grid.cell))
    lattice = rng.uniform(-1, 1, size=(grid.ny // step + 2, grid.nx // step + 2))
    fy, fx = np.arange(grid.ny) / step, np.arange(grid.nx) / step
    r, c = fy.astype(int), fx.astype(int)
    ty, tx = (fy - r)[:, None], (fx - c)[None, :]
    top = lattice[r][:, c] * (1 - tx) + lattice[r][:, c + 1] * tx
    bottom = lattice[r + 1][:, c] * (1 - tx) + lattice[r + 1][:, c + 1] * tx
    return top * (1 - ty) + bottom * ty


def _paint_areas(grid: Grid, ground: Ground, raw: dict) -> None:
    # Baked largest first, so a school inside a park paints over the park.
    for flat in raw["areas"]:
        kind = flat[0]
        polygon = _polygon(raw["origin"], flat, 1)
        if polygon is None or kind not in AREA_FUEL:
            continue
        rows, cols = _cells_inside(grid, polygon)
        ground.fuel[rows, cols] = AREA_FUEL[kind]
        ground.ember_source[rows, cols] = kind == WILD
        if kind == WATER:
            ground.water[rows, cols] = True


def _paint_roads(grid: Grid, ground: Ground, raw: dict) -> None:
    # A strip at least one cell wide, so a street drawn diagonally across the grid never leaves gaps.
    for flat in raw["roads"]:
        road_class, tunnel = flat[0], flat[2] == 1
        if road_class >= len(ROAD_FUEL) or tunnel:
            continue
        path = _map_to_xy(raw["origin"], flat, 3)
        if len(path) < 2:
            continue
        half_width = max(ROAD_WIDTH_METERS[road_class] / 2, 0.75 * grid.cell)
        rows, cols = _cells_inside(grid, LineString(path).buffer(half_width, cap_style="flat"))
        ground.fuel[rows, cols] = np.minimum(ground.fuel[rows, cols], ROAD_FUEL[road_class])
        ground.ember_source[rows, cols] = False


def _building_fuel(kind: int, rng: random.Random) -> float:
    hardened = kind in (HOUSE, APARTMENTS) and rng.random() < HARDENED_SHARE
    never = HARDENED_NEVER_IGNITES if hardened else NEVER_IGNITES.get(kind, 0.0)
    if rng.random() < never:
        return 0.0
    return HARDENED_FUEL if hardened else BUILDING_FUEL.get(kind, 1.0)


def _paint_buildings(grid: Grid, ground: Ground, raw: dict, patches: np.ndarray, seed: int) -> None:
    rng = random.Random(seed)
    x0, y0 = grid.x0, grid.y0
    x1, y1 = x0 + grid.nx * grid.cell, y0 + grid.ny * grid.cell
    for flat in raw["buildings"]:
        polygon = _polygon(raw["origin"], flat, 4)
        if polygon is None or polygon.is_empty:
            continue
        cx, cy = polygon.centroid.x, polygon.centroid.y
        if not (x0 <= cx < x1 and y0 <= cy < y1):
            continue
        rows, cols = _cells_inside(grid, polygon)
        if len(rows) == 0:
            rows, cols = np.array([int((cy - y0) / grid.cell)]), np.array([int((cx - x0) / grid.cell)])
        # Lawns protect: in a well-watered patch a home is likelier to come through untouched.
        lawn = float(-patches[rows[0], cols[0]])
        fuel = _building_fuel(flat[0], rng)
        if fuel > 0 and lawn > 0.5 and rng.random() < 0.25 * lawn:
            fuel = 0.0
        ground.fuel[rows, cols] = fuel
        ground.ember_source[rows, cols] = fuel >= 0.9


def load_ground(grid: Grid, seed: int) -> Ground:
    raw = json.loads(MAP_FILE.read_text())
    patches = _patches(grid, seed)
    ground = Ground(
        fuel=1.0 + PATCH_SPREAD * patches,
        water=np.zeros((grid.ny, grid.nx), dtype=bool),
        ember_source=np.ones((grid.ny, grid.nx), dtype=bool),
    )
    _paint_areas(grid, ground, raw)
    _paint_roads(grid, ground, raw)
    _paint_buildings(grid, ground, raw, patches, seed)
    # Bridges don't carry fire across a wash: water wins over the road drawn on top of it.
    ground.fuel[ground.water] = 0.0
    ground.ember_source[ground.water] = False
    return ground
