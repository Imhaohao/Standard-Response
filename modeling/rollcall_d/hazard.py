"""The hazard scenario: labeled fire-front polygons by minutes after the warning.

Scenario input, not a forecast. The scenario only ever moves arrival times earlier or later; it never
marks a household safe. A home outside every polygon still gets a finite arrival time, extrapolated
from the last front's spread rate, so an unanswered household is always treated as unknown and at risk.
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path

from shapely.geometry import Point
from shapely.geometry.base import BaseGeometry

from .geo import geojson_to_metric, to_xy
from .paths import HAZARD

SCENARIO_FILE = HAZARD / "scenario.geojson"
LABEL = "Scenario input, not a forecast"


@dataclass(frozen=True)
class Front:
    minutes: float
    shape: BaseGeometry  # metric frame


class Scenario:
    def __init__(self, fronts: list[Front], metadata: dict | None = None):
        if not fronts:
            raise ValueError("A scenario needs at least one front")
        self.fronts = sorted(fronts, key=lambda f: f.minutes)
        self.metadata = metadata or {}
        self._tail_rate = self._spread_rate_at_end()

    @classmethod
    def load(cls, path: Path = SCENARIO_FILE) -> "Scenario":
        collection = json.loads(Path(path).read_text())
        fronts = [
            Front(float(f["properties"]["minutesAfterWarning"]), geojson_to_metric(f["geometry"]))
            for f in collection["features"]
        ]
        return cls(fronts, collection.get("metadata"))

    def _spread_rate_at_end(self) -> float:
        """Meters per minute the front was growing over the last interval, by equivalent radius."""
        if len(self.fronts) < 2:
            return float(self.metadata.get("headSpreadMetersPerMinute", 20.0))
        a, b = self.fronts[-2], self.fronts[-1]
        radius = lambda f: math.sqrt(f.shape.area / math.pi)  # noqa: E731
        return max((radius(b) - radius(a)) / max(b.minutes - a.minutes, 1e-6), 1.0)

    def arrival_minutes_xy(self, x: float, y: float) -> float:
        """Minutes after the warning when the front reaches a point, interpolated between fronts."""
        point = Point(x, y)
        previous: Front | None = None
        for front in self.fronts:
            if front.shape.covers(point):
                if previous is None:
                    return front.minutes
                to_previous = previous.shape.distance(point)
                to_boundary = front.shape.exterior.distance(point) if hasattr(front.shape, "exterior") else front.shape.boundary.distance(point)
                share = to_previous / max(to_previous + to_boundary, 1e-9)
                return previous.minutes + share * (front.minutes - previous.minutes)
            previous = front
        last = self.fronts[-1]
        return last.minutes + last.shape.distance(point) / self._tail_rate

    def arrival_minutes(self, lat: float, lng: float) -> float:
        return self.arrival_minutes_xy(*to_xy(lat, lng))

    def buffered(self, meters: float) -> "Scenario":
        """The same scenario with every front grown by a safety margin."""
        return Scenario([Front(f.minutes, f.shape.buffer(meters)) for f in self.fronts], self.metadata)
