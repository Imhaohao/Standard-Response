"""Turn a water-level history and a DEM into fronts: the land the water has reached by each minute.

The rule is the connected bathtub. A dry cell floods at the first minute the water level at its source
is above the ground there and an unbroken path of cells below that level joins it to the source water.
Water that has reached a cell stays counted as reached, so each front contains the one before it.
Permanent water (the bay, the Gulf, canals) is the source, not the hazard, so it is left out of the fronts.
"""

from dataclasses import dataclass, field

import numpy as np
from rasterio import features
from rasterio.transform import from_bounds
from scipy import ndimage
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from water_terrain import Terrain

FOUR_NEIGHBOURS = ndimage.generate_binary_structure(2, 1)


@dataclass
class FloodSetup:
    terrain: Terrain
    source_water: np.ndarray  # True where open water sits before the event
    domain: np.ndarray  # True where the water may go (a polder, or the whole box)
    clip: np.ndarray | None = None  # the published maximum extent, if there is one
    barrier: np.ndarray = field(default=None)  # walls the DEM is too coarse to see

    def __post_init__(self):
        if self.barrier is None:
            self.barrier = np.zeros_like(self.domain)


def transform_of(terrain: Terrain):
    height, width = terrain.shape
    box = terrain.box
    return from_bounds(box.west, box.south, box.east, box.north, width, height)


def rasterize(terrain: Terrain, geometries, line_width_cells: int = 0) -> np.ndarray:
    mask = features.rasterize(
        [(geometry, 1) for geometry in geometries],
        out_shape=terrain.shape,
        transform=transform_of(terrain),
        all_touched=True,
        dtype="uint8",
    ).astype(bool)
    if line_width_cells > 0:
        mask = ndimage.binary_dilation(mask, iterations=line_width_cells)
    return mask


def components_touching(candidates: np.ndarray, seeds: np.ndarray) -> np.ndarray:
    labels, _ = ndimage.label(candidates, structure=FOUR_NEIGHBOURS)
    touched = np.unique(labels[seeds & candidates])
    touched = touched[touched > 0]
    return np.isin(labels, touched)


def open_water(terrain: Terrain, seed_points: list[tuple[float, float]], still_level: float) -> np.ndarray:
    """Cells at or below the everyday water level that join the given open-water points."""
    elevation = terrain.elevation
    wet = np.isnan(elevation) | (elevation <= still_level)
    seeds = np.zeros(terrain.shape, dtype=bool)
    for lat, lng in seed_points:
        seeds[terrain.cell_of(lat, lng)] = True
    return components_touching(wet, seeds)


def flooded_by(setup: FloodSetup, level, already: np.ndarray, gate: np.ndarray | None = None) -> np.ndarray:
    """level is one water surface for the whole box or an array of local surfaces; gate limits where water
    can have travelled by now (None means anywhere)."""
    elevation = setup.terrain.elevation
    below = (np.isnan(elevation) | (elevation < level)) & setup.domain & ~setup.barrier
    if gate is not None:
        below &= gate
    reachable = components_touching(below | setup.source_water | already, setup.source_water | already)
    reached = (reachable | already) & ~setup.source_water
    if setup.clip is not None:
        reached &= setup.clip
    return reached


def drop_small(mask: np.ndarray, min_cells: int) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if count == 0:
        return mask
    sizes = ndimage.sum(mask, labels, index=np.arange(1, count + 1))
    return np.isin(labels, np.flatnonzero(sizes >= min_cells) + 1)


def tidy(mask: np.ndarray, min_cells: int, smoothing: int = 1) -> np.ndarray:
    """Drop specks and fill small holes so the polygons stay small without changing the picture."""
    closed = ndimage.binary_closing(mask, structure=FOUR_NEIGHBOURS, iterations=smoothing) | mask
    keep = drop_small(closed, min_cells)
    holes = ndimage.binary_fill_holes(keep) & ~keep
    return keep | (holes & ~drop_small(holes, min_cells))


def distance_meters(terrain: Terrain, sources: np.ndarray) -> np.ndarray:
    """Straight-line distance from the nearest source cell, in metres."""
    height, width = terrain.shape
    box = terrain.box
    cell_x = (box.east - box.west) * box.meters_per_deg_lng / width
    cell_y = (box.north - box.south) * 110_574.0 / height
    return ndimage.distance_transform_edt(~sources, sampling=(cell_y, cell_x))


def vertex_count(geometry) -> int:
    polygons = geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]
    return sum(len(p.exterior.coords) + sum(len(r.coords) for r in p.interiors) for p in polygons)


def as_multipolygon(geometry) -> MultiPolygon:
    if isinstance(geometry, Polygon):
        return MultiPolygon([geometry])
    if isinstance(geometry, MultiPolygon):
        return geometry
    parts = [g for g in getattr(geometry, "geoms", []) if isinstance(g, Polygon)]
    return MultiPolygon(parts)


def polygonize(terrain: Terrain, mask: np.ndarray, max_vertices: int) -> MultiPolygon | None:
    if not mask.any():
        return None
    pieces = [
        shape(geometry)
        for geometry, value in features.shapes(mask.astype("uint8"), mask=mask, transform=transform_of(terrain))
        if value == 1
    ]
    merged = unary_union(pieces)
    tolerance = 0.00003
    simplified = merged.simplify(tolerance, preserve_topology=True)
    while vertex_count(simplified) > max_vertices and tolerance < 0.002:
        tolerance *= 1.4
        simplified = merged.simplify(tolerance, preserve_topology=True)
    parts = sorted(as_multipolygon(simplified.buffer(0)).geoms, key=lambda part: part.area, reverse=True)
    return MultiPolygon(parts)


def rounded_geojson(geometry: MultiPolygon) -> dict:
    def round_ring(ring):
        return [[round(x, 6), round(y, 6)] for x, y in ring]

    return {
        "type": "MultiPolygon",
        "coordinates": [[round_ring(ring) for ring in polygon] for polygon in mapping(geometry)["coordinates"]],
    }
