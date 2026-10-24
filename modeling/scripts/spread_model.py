"""Generate a hazard scenario from the spread model: data/hazard/scenario-spread.geojson.

Same format as scenario.geojson (fronts by minutesAfterWarning), so the model runner and the map read it
unchanged: `run_models.py --scenario data/hazard/scenario-spread.geojson`. Uniform fuel, constant wind,
random spot fires with a fixed seed. Scenario input, not a forecast.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.area import EAST, NORTH, SOUTH, WEST  # noqa: E402
from rollcall_d.geo import metric_to_geojson, to_xy  # noqa: E402
from rollcall_d.hazard import LABEL  # noqa: E402
from rollcall_d.paths import HAZARD  # noqa: E402
from rollcall_d.spread import Grid, SpreadConfig, front_polygon, simulate  # noqa: E402

MINUTES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
VIRTUAL_ORIGIN = (34.2085, -118.1205)  # where the front enters: upper Altadena east of Lake Ave, as in build_hazard.py
MARGIN_METERS = 600.0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--spot-fires", type=int, default=6)
    parser.add_argument("--head-rate", type=float, default=24.0)
    parser.add_argument("--heading", type=float, default=245.0)
    parser.add_argument("--length-to-breadth", type=float, default=2.0)
    parser.add_argument("--out", default=str(HAZARD / "scenario-spread.geojson"))
    args = parser.parse_args()

    config = SpreadConfig(VIRTUAL_ORIGIN, heading_degrees=args.heading, head_rate=args.head_rate,
                          length_to_breadth=args.length_to_breadth, spot_fires=args.spot_fires, seed=args.seed)
    west, south = to_xy(SOUTH, WEST)
    east, north = to_xy(NORTH, EAST)
    ox, oy = to_xy(*VIRTUAL_ORIGIN)
    bounds = (min(west, ox) - MARGIN_METERS, min(south, oy) - MARGIN_METERS, max(east, ox) + MARGIN_METERS, max(north, oy) + MARGIN_METERS)
    grid = Grid(bounds, config.cell)
    arrival = simulate(grid, config)
    features = []
    for minute in MINUTES:
        polygon = front_polygon(grid, arrival, minute)
        if polygon is not None and not polygon.is_empty:
            features.append({"type": "Feature", "properties": {"minutesAfterWarning": minute, "label": LABEL}, "geometry": metric_to_geojson(polygon)})
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "West Altadena spread-model scenario",
            "label": LABEL,
            "generator": "scripts/spread_model.py (fast marching, elliptical wind-driven spread, spot fires)",
            "claim": "Conservative within our assumptions. Not validated against satellite data: MODIS and VIIRS fire detections are about 1 km and 375 m, intermittent, and blocked by smoke.",
            "fuel": "uniform", "headingDegrees": config.heading_degrees, "headSpreadMetersPerMinute": config.head_rate,
            "lengthToBreadth": config.length_to_breadth, "spotFires": config.spot_fires, "seed": config.seed, "cellMeters": config.cell,
            "neverMarksSafe": "Homes outside every front get an extrapolated arrival time, never 'safe'.",
        },
        "features": features,
    }
    Path(args.out).write_text(json.dumps(collection, indent=1))
    burned = [float(np.mean(arrival <= m)) for m in MINUTES]
    print(f"wrote {args.out}: {len(features)} fronts; burned share of grid by front: {[round(b, 3) for b in burned]}")


if __name__ == "__main__":
    main()
