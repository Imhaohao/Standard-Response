"""Small geometry helpers. Shapely work happens in a local metric frame (meters east and north of
the study area's center), which is accurate to well under 1% across a few kilometers."""

import math
from typing import Iterable

from shapely.geometry import Polygon, mapping, shape
from shapely.ops import transform

from .area import EAST, NORTH, SOUTH, WEST

LAT0 = (SOUTH + NORTH) / 2
LNG0 = (WEST + EAST) / 2
METERS_PER_DEG_LAT = 111_320.0
METERS_PER_DEG_LNG = METERS_PER_DEG_LAT * math.cos(math.radians(LAT0))


def to_xy(lat: float, lng: float) -> tuple[float, float]:
    return (lng - LNG0) * METERS_PER_DEG_LNG, (lat - LAT0) * METERS_PER_DEG_LAT


def to_latlng(x: float, y: float) -> tuple[float, float]:
    return LAT0 + y / METERS_PER_DEG_LAT, LNG0 + x / METERS_PER_DEG_LNG


def meters_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Distance between two (lat, lng) points."""
    ax, ay = to_xy(*a)
    bx, by = to_xy(*b)
    return math.hypot(ax - bx, ay - by)


def _lnglat_to_xy(lng, lat, z=None):
    return (lng - LNG0) * METERS_PER_DEG_LNG, (lat - LAT0) * METERS_PER_DEG_LAT


def _xy_to_lnglat(x, y, z=None):
    return LNG0 + x / METERS_PER_DEG_LNG, LAT0 + y / METERS_PER_DEG_LAT


def geojson_to_metric(geometry: dict):
    return transform(_lnglat_to_xy, shape(geometry))


def metric_to_geojson(geometry, decimals: int = 6) -> dict:
    lnglat = transform(_xy_to_lnglat, geometry)
    return _round(mapping(lnglat), decimals)


def _round(value, decimals: int):
    if isinstance(value, float):
        return round(value, decimals)
    if isinstance(value, (list, tuple)):
        return [_round(v, decimals) for v in value]
    if isinstance(value, dict):
        return {k: _round(v, decimals) for k, v in value.items()}
    return value


def polygon_from_latlng(points: Iterable[dict]) -> Polygon:
    """A Convex polygon (list of {lat, lng}) as a metric shapely polygon."""
    return Polygon([to_xy(p["lat"], p["lng"]) for p in points])
