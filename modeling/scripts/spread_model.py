"""Generate the wildfire scenario from the spread model: data/hazard/scenario.geojson, and the same fronts in
public/scenarios/altadena.json (the v2 scenario file the scene lab reads).

Fronts by minutesAfterWarning, as before, so every reader takes it unchanged. The fire now burns over the
real ground (rollcall_d/fire_ground.py: washes, roads, open space, homes that resist or never catch) under a
wind that shifts and gusts (rollcall_d/urban_spread.py), so fronts can come in pieces and hold unburned
islands. Seeded: the same seed draws the same fire every time. Scenario input, not a forecast.

    uv run python scripts/spread_model.py            # seed 7, the rehearsed demo fire
    uv run python scripts/spread_model.py --seed 8 --out /tmp/variant.geojson
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import MultiPolygon, Polygon

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.area import EAST, NORTH, SOUTH, WEST  # noqa: E402
from rollcall_d.fire_ground import MAP_FILE, load_ground  # noqa: E402
from rollcall_d.geo import metric_to_geojson, to_xy  # noqa: E402
from rollcall_d.hazard import LABEL, SCENARIO_FILE  # noqa: E402
from rollcall_d.paths import REPO  # noqa: E402
from rollcall_d.spread import Grid, front_polygon  # noqa: E402
from rollcall_d import urban_spread  # noqa: E402

MINUTES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
VIRTUAL_ORIGIN = (34.2085, -118.1205)  # where the front enters: upper Altadena east of Lake Ave
IGNITION_MINUTE = -18.0  # the fire is already burning when the warning goes out
CELL_METERS = 10.0
MARGIN_METERS = 600.0
UPWIND_MARGIN_METERS = 1500.0  # room east and north for the fire to back into the wind
SIMPLIFY_METERS = 8.0
# Holes and pieces smaller than this are dropped: below what the map's fire field can show.
SMALLEST_ISLAND_M2 = 500.0
SMALLEST_PIECE_M2 = 800.0
SCENE_FILE = REPO / "public" / "scenarios" / "altadena.json"


def grid_bounds() -> tuple[float, float, float, float]:
    west, south = to_xy(SOUTH, WEST)
    east, north = to_xy(NORTH, EAST)
    ox, oy = to_xy(*VIRTUAL_ORIGIN)
    return (min(west, ox) - MARGIN_METERS, min(south, oy) - MARGIN_METERS, max(east, ox) + UPWIND_MARGIN_METERS, max(north, oy) + UPWIND_MARGIN_METERS)


def cleaned(shape) -> Polygon | MultiPolygon | None:
    """Drops specks: islands and spot fires too small to draw."""
    pieces = [shape] if isinstance(shape, Polygon) else list(shape.geoms)
    kept = []
    for piece in pieces:
        if piece.area < SMALLEST_PIECE_M2:
            continue
        holes = [ring for ring in piece.interiors if Polygon(ring).area >= SMALLEST_ISLAND_M2]
        kept.append(Polygon(piece.exterior, holes))
    if not kept:
        return None
    return kept[0] if len(kept) == 1 else MultiPolygon(kept)


def fronts(grid: Grid, arrival: np.ndarray) -> list[dict]:
    features = []
    for minute in MINUTES:
        shape = front_polygon(grid, arrival, minute, simplify=SIMPLIFY_METERS)
        shape = cleaned(shape) if shape is not None else None
        if shape is not None:
            features.append({"type": "Feature", "properties": {"minutesAfterWarning": minute, "label": LABEL}, "geometry": metric_to_geojson(shape)})
    return features


def wind_series(walk: urban_spread.WindWalk) -> list[dict]:
    return [
        {"minute": round(walk.start + i * urban_spread.WIND_STEP_MINUTES, 1), "headingDegrees": round(float(np.degrees(h)) % 360, 1), "kmh": round(s, 1)}
        for i, (h, s) in enumerate(zip(walk.headings, walk.speeds))
    ]


def metadata(seed: int, walk: urban_spread.WindWalk) -> dict:
    return {
        "name": "West Altadena spread-model scenario",
        "label": LABEL,
        "generator": "modeling/scripts/spread_model.py (wind-walk spread over OSM ground, spot fires)",
        "basis": "Shape and direction follow the published Eaton Fire progression into west Altadena, January 2025. Barriers come from OpenStreetMap. Timing and every rate are stated assumptions.",
        "claim": "Conservative within our assumptions. Not validated against satellite data.",
        "ground": f"{MAP_FILE.relative_to(REPO)}: washes and water never burn; roads, parks, schools, parking, golf, pitches and cemeteries slow it; brush speeds it; some homes never catch",
        "virtualOrigin": {"lat": VIRTUAL_ORIGIN[0], "lng": VIRTUAL_ORIGIN[1]},
        "headingDegrees": urban_spread.MEAN_HEADING_DEGREES,
        "headSpreadMetersPerMinute": urban_spread.HEAD_RATE_AT_MEAN,
        "meanWindKmh": urban_spread.MEAN_WIND_KMH,
        "seed": seed,
        "cellMeters": CELL_METERS,
        "wind": wind_series(walk),
        "neverMarksSafe": "Homes outside every front get an extrapolated arrival time, never 'safe'.",
    }


def write_scene(features: list[dict], seed: int) -> None:
    """The v2 scenario keeps its clock and sources; only its fronts and wind follow the new run."""
    scene = json.loads(SCENE_FILE.read_text())
    scene["fronts"] = {"type": "FeatureCollection", "features": [{**f, "properties": {"minutesAfterWarning": f["properties"]["minutesAfterWarning"]}} for f in features]}
    scene["series"] = {"headingDegrees": urban_spread.MEAN_HEADING_DEGREES, "headSpreadMetersPerMinute": urban_spread.HEAD_RATE_AT_MEAN}
    scene["sources"] = [s for s in scene["sources"] if not s["label"].startswith("Fronts from")] + [
        {"label": f"Fronts from data/hazard/scenario.geojson (modeling/scripts/spread_model.py, seed {seed})"},
        {"label": "Buildings, roads, parks and water from OpenStreetMap", "url": "https://www.openstreetmap.org/copyright"},
    ]
    SCENE_FILE.write_text(json.dumps(scene, separators=(",", ":")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seed", type=int, default=7)
    # The live scenario is the real Eaton Fire (scripts/build_eaton_fire.py). Pass --out with
    # data/hazard/scenario.geojson only to replace it with this model on purpose.
    parser.add_argument("--out", default=str(SCENARIO_FILE.with_name("scenario-spread.geojson")))
    parser.add_argument("--arrival-npy", help="also save the arrival grid, for plots")
    args = parser.parse_args()

    grid = Grid(grid_bounds(), CELL_METERS)
    ground = load_ground(grid, args.seed)
    arrival, walk = urban_spread.simulate_urban(grid, ground, VIRTUAL_ORIGIN, IGNITION_MINUTE, MINUTES[-1] + 30, args.seed)
    features = fronts(grid, arrival)
    collection = {"type": "FeatureCollection", "metadata": metadata(args.seed, walk), "features": features}
    Path(args.out).write_text(json.dumps(collection, indent=1))
    if Path(args.out).resolve() == SCENARIO_FILE.resolve():
        write_scene(features, args.seed)
    if args.arrival_npy:
        np.savez_compressed(args.arrival_npy, arrival=arrival, fuel=ground.fuel, bounds=np.array(grid_bounds()), cell=CELL_METERS)
    burned = [round(float(np.mean(arrival <= m)), 3) for m in MINUTES]
    print(f"wrote {args.out}: {len(features)} fronts; burned share of grid by front: {burned}")


if __name__ == "__main__":
    main()
