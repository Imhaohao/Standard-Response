"""Forecast danger zones from live NWS wind: data/hazard/danger-zones.geojson.

Runs the spread model as an ensemble (see rollcall_d/ensemble.py) and writes, for each burn probability
and every FRAME_STEP minutes after the warning, the area burned with at least that probability. The map
draws the frame at or before its clock. If the NWS can't be reached, the scenario's own wind is used and the
file says so. A forecast of the model under forecast wind, still not validated against observed fires.

    uv run python scripts/danger_zones.py              # once
    uv run python scripts/danger_zones.py --every 60   # refresh hourly, as the NWS grid updates
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.area import EAST, NORTH, SOUTH, WEST  # noqa: E402
from rollcall_d.ensemble import burn_quantiles, draw_members, run_urban_members, urban_scenario_members  # noqa: E402
from rollcall_d.fire_ground import load_ground  # noqa: E402
from rollcall_d.geo import metric_to_geojson, to_xy  # noqa: E402
from rollcall_d.hazard import Scenario  # noqa: E402
from rollcall_d.paths import HAZARD  # noqa: E402
from rollcall_d.spread import Grid, front_polygon  # noqa: E402
from rollcall_d.weather import fetch_wind  # noqa: E402

PROBABILITIES = [0.1, 0.5, 0.9]
LAST_MINUTE = 270
FRAME_STEP = 10
WINDOW_HOURS = 5
# The forecast starts from the scenario's fire as it stands at the warning (minute 0), on the scenario's 10 m
# grid, so the bands grow from where this fire is rather than from a modelled ignition point.
START_MINUTE = 0.0
MARGIN_METERS = 600.0
UPWIND_MARGIN_METERS = 1500.0  # east and north of the study area, where a Santa Ana fire comes from
CELL_METERS = 10.0
LABEL = "Forecast from live wind, not a prediction of this fire"


def study_grid() -> Grid:
    west, south = to_xy(SOUTH, WEST)
    east, north = to_xy(NORTH, EAST)
    bounds = (west - MARGIN_METERS, south - MARGIN_METERS, east + UPWIND_MARGIN_METERS, north + UPWIND_MARGIN_METERS)
    return Grid(bounds, CELL_METERS)


def burning_at_start(grid: Grid, scenario: Scenario) -> tuple[np.ndarray, float]:
    """Cells the scenario has burned by START_MINUTE (its latest front at or before it), and that front's minute."""
    fronts = [f for f in scenario.fronts if f.minutes <= START_MINUTE]
    if not fronts:
        raise ValueError(f"The scenario has no front at or before minute {START_MINUTE:g} to start the forecast from")
    front = fronts[-1]
    return shapely.contains_xy(front.shape, grid.X, grid.Y), front.minutes


def choose_members(wind: str, count: int, seed: int):
    """Members from live NWS wind, or from the scenario wind when asked or when the NWS fails."""
    if wind == "scenario":
        return urban_scenario_members(count, seed), {"source": "scenario", "note": "Scenario wind by request"}
    lat, lng = (SOUTH + NORTH) / 2, (WEST + EAST) / 2
    try:
        forecast = fetch_wind(lat, lng, WINDOW_HOURS)
    except Exception as error:  # any network or shape failure falls back, and the file says why
        return urban_scenario_members(count, seed), {"source": "scenario", "note": f"NWS unreachable: {error}"}
    first = forecast.hours[0]
    summary = {
        "source": "nws",
        "office": forecast.office,
        "grid": forecast.grid,
        "updated": forecast.updated,
        "fetched": forecast.fetched,
        "now": {"speedKmh": round(first.speed_kmh, 1), "fromDegrees": first.from_degrees, "gustKmh": first.gust_kmh},
        "hours": [{"at": h.at.isoformat(), "speedKmh": round(h.speed_kmh, 1), "fromDegrees": h.from_degrees, "gustKmh": h.gust_kmh} for h in forecast.hours],
    }
    return draw_members(forecast.hours, count, seed), summary


def zone_features(grid: Grid, quantiles: dict[float, np.ndarray]) -> list[dict]:
    features = []
    for probability, arrival in quantiles.items():
        for minute in range(0, LAST_MINUTE + 1, FRAME_STEP):
            polygon = front_polygon(grid, arrival, minute)
            if polygon is None or polygon.is_empty:
                continue
            properties = {"probability": probability, "minutesAfterWarning": minute}
            features.append({"type": "Feature", "properties": properties, "geometry": metric_to_geojson(polygon, decimals=5)})
    return features


def build(members_count: int, wind: str, seed: int, out: Path) -> None:
    started = time.monotonic()
    grid = study_grid()
    ground = load_ground(grid, seed)
    scenario = Scenario.load()
    burning, start_minute = burning_at_start(grid, scenario)
    members, wind_summary = choose_members(wind, members_count, seed)
    arrivals = run_urban_members(grid, ground, None, start_minute, LAST_MINUTE + FRAME_STEP, members, burning=burning)
    quantiles = burn_quantiles(arrivals, PROBABILITIES)
    rates = [m.head_rate for m in members]
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "West Altadena danger zones",
            "label": LABEL,
            "generator": "scripts/danger_zones.py (ensemble of the scenario's ground-aware spread model under NWS wind)",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "members": len(members),
            "probabilities": PROBABILITIES,
            "frameStepMinutes": FRAME_STEP,
            "cellMeters": CELL_METERS,
            "headRateMetersPerMinute": {"p10": round(float(np.percentile(rates, 10)), 1), "p50": round(float(np.median(rates)), 1), "p90": round(float(np.percentile(rates, 90)), 1)},
            "wind": wind_summary,
            "startsFrom": {"scenario": scenario.metadata.get("name"), "minutesAfterWarning": start_minute,
                           "minuteZero": scenario.metadata.get("minuteZero")},
            "assumptions": "Each member is the scenario's spread model (rollcall_d/urban_spread.py over rollcall_d/fire_ground.py: washes never burn, roads and open space slow it, embers cross) with its wind walking around that member's heading and speed, spreading on from the scenario's burned area at the warning. Members scatter around the forecast wind with 20 degrees of direction error and 25% speed error.",
        },
        "features": zone_features(grid, quantiles),
    }
    out.write_text(json.dumps(collection, separators=(",", ":")))
    print(f"wrote {out}: {len(collection['features'])} zones from {len(members)} members, wind {wind_summary['source']}, {time.monotonic() - started:.1f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--members", type=int, default=100)
    parser.add_argument("--wind", choices=["live", "scenario"], default="live")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--every", type=float, default=0, help="minutes between refreshes; 0 runs once")
    parser.add_argument("--out", default=str(HAZARD / "danger-zones.geojson"))
    args = parser.parse_args()
    while True:
        build(args.members, args.wind, args.seed, Path(args.out))
        if args.every <= 0:
            return
        time.sleep(args.every * 60)


if __name__ == "__main__":
    main()
