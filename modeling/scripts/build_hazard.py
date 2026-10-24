"""Write data/hazard/scenario.geojson: fire-front polygons by minutes after the warning.

Scenario input, not a forecast. The shape follows the published progression of the Eaton Fire into
west Altadena (January 2025): the fire crossed into Altadena from the east, and Santa Ana winds out of
the east-northeast pushed it west-southwest through the neighborhoods west of Lake Ave overnight,
reaching the streets near Lincoln Ave in the early morning. Minute zero is the moment a warning covers
west Altadena, the counterfactual the demo asks about.

Each front is a wind-driven ellipse (the standard elliptical fire-shape model): the head runs downwind
at HEAD_RATE, the back burns upwind at BACK_RATE, and the width is the length divided by LENGTH_TO_BREADTH.
Every parameter below is a stated assumption, chosen so the front first reaches homes in the study area
about 40 minutes after the warning and crosses it in about four hours, which matches the overnight
timeline in the reporting. `scripts/spread_model.py` replaces this script with simulated spread later.
"""

import json
import math
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import Point

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.geo import metric_to_geojson, to_xy  # noqa: E402
from rollcall_d.hazard import LABEL, SCENARIO_FILE  # noqa: E402

# Where the front would have started if it were one ellipse: upper Altadena east of Lake Ave.
VIRTUAL_ORIGIN = (34.2085, -118.1205)
HEADING_DEGREES = 245.0  # direction of travel, clockwise from north: toward the west-southwest
HEAD_RATE = 24.0  # meters per minute downwind
BACK_RATE = 2.5  # meters per minute upwind
HEAD_AT_WARNING = 450.0  # meters already burned downwind when the warning goes out
LENGTH_TO_BREADTH = 1.9
MINUTES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270]


def front(minutes: float):
    head = HEAD_AT_WARNING + HEAD_RATE * minutes
    back = HEAD_AT_WARNING * BACK_RATE / HEAD_RATE + BACK_RATE * minutes
    semi_major = (head + back) / 2
    semi_minor = semi_major / LENGTH_TO_BREADTH
    heading = math.radians(HEADING_DEGREES)
    ox, oy = to_xy(*VIRTUAL_ORIGIN)
    offset = (head - back) / 2
    cx, cy = ox + offset * math.sin(heading), oy + offset * math.cos(heading)
    ellipse = affinity.scale(Point(0, 0).buffer(1.0, quad_segs=32), semi_minor, semi_major)
    ellipse = affinity.rotate(ellipse, -HEADING_DEGREES, origin=(0, 0))
    return affinity.translate(ellipse, cx, cy)


def main() -> None:
    features = [
        {
            "type": "Feature",
            "properties": {"minutesAfterWarning": m, "label": LABEL},
            "geometry": metric_to_geojson(front(m)),
        }
        for m in MINUTES
    ]
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "West Altadena wind-driven scenario",
            "label": LABEL,
            "generator": "scripts/build_hazard.py (elliptical fronts)",
            "basis": "Shape and direction follow the published Eaton Fire progression into west Altadena, January 2025. Timing is a stated assumption.",
            "virtualOrigin": {"lat": VIRTUAL_ORIGIN[0], "lng": VIRTUAL_ORIGIN[1]},
            "headingDegrees": HEADING_DEGREES,
            "headSpreadMetersPerMinute": HEAD_RATE,
            "backSpreadMetersPerMinute": BACK_RATE,
            "lengthToBreadth": LENGTH_TO_BREADTH,
            "neverMarksSafe": "Homes outside every front get an extrapolated arrival time, never 'safe'.",
        },
        "features": features,
    }
    SCENARIO_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCENARIO_FILE.write_text(json.dumps(collection, indent=1))
    print(f"wrote {SCENARIO_FILE} with {len(features)} fronts")


if __name__ == "__main__":
    main()
