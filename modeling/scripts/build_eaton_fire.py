"""Write the Eaton Fire as it burned, one building at a time: data/hazard/scenario.geojson for the server
and the model runner, and public/scenarios/altadena.json (scenario file v2) for the map.

Where it burned is CAL FIRE's final heat perimeter (data/eaton/perimeter-eaton.geojson, from
scripts/fetch_perimeter.py). When is fitted to the dated fire reports in the UL FSRI timeline
(data/eaton/fire-sightings.json), starting from the ignition CAL FIRE recorded at 6:18 p.m. The arrival
minute at a point grows with its distance from the ignition, measured along the ground inside the burned
area, at the pace the first report in each neighborhood shows (an isotonic fit, so the fire never arrives
earlier farther out). Near each report the fit is nudged by how much earlier or later that report came.
Reports lag the fire and spot fires ran far ahead of it, so the fit is also capped by every report: fire
was there by the time it was reported and spread outward at an urban pace, so the map never shows fire
arriving well after a nearby report.

Every building on the map burns as one piece. The grid cells nearest a building, out to BUILDING_REACH_M,
take that building's minute, so a front never passes through a house. A building outside the perimeter
never burns, but the ground inside the perimeter next to it still does, so the burn's edge follows the
perimeter rather than the outlines of the lots beside it.

Minute zero is 10:50 p.m. on January 7, the first fire reported west of Lake Avenue: the moment this
system would have warned west Altadena (scripts/eaton_replay.py uses the same trigger). Ground that burned
earlier has negative minutes.

Both files carry the same fronts: everything burned by each half hour, traced from the grid as polygons
with the unburned islands as holes, so every reader of the scenario format reads the real fire. Each
traced front is closed and opened by part of a cell before it is simplified, so its edge runs smoothly
instead of in the grid's stair steps. After
running, bake them for the server: npx tsx scripts/hazard/bake-scenarios.ts
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import skfmm
from shapely import box, contains_xy, transform, unary_union
from shapely.geometry import mapping, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.paths import DATA, HAZARD, REPO  # noqa: E402

EATON = DATA / "eaton"
PERIMETER_FILE = EATON / "perimeter-eaton.geojson"
SIGHTINGS_FILE = EATON / "fire-sightings.json"
FSRI_FILE = EATON / "fsri-timeline-eaton.csv"
MAP_FILE = REPO / "public" / "map" / "altadena.json"
SCENARIO_FILE = HAZARD / "scenario.geojson"
SCENARIO_V2_FILE = REPO / "public" / "scenarios" / "altadena.json"

PACIFIC = timezone(timedelta(hours=-8))
IGNITION = {"lat": 34.19163, "lng": -118.10544, "at": datetime(2025, 1, 7, 18, 18, tzinfo=PACIFIC)}  # NIFC WFIGS incident record
MINUTE_ZERO = datetime(2025, 1, 7, 22, 50, tzinfo=PACIFIC)

# The map's own projection (lib/ink-map/data.ts), so building rings line up with the grid.
MAP_ORIGIN = (34.189, -118.154)
METERS_PER_DEG_LAT = 110_574.0
METERS_PER_DEG_LNG = 111_320.0 * math.cos(math.radians(MAP_ORIGIN[0]))

# The part of the perimeter the map can show: the town and the hills the camera reaches around it.
REGION = {"west": -118.1632, "south": 34.1610, "east": -118.0797, "north": 34.2387}
CELL_M = 15.0
FRONT_STEP_MINUTES = 30
# The night ends at noon on January 8 (13 hours after minute zero); the hills the fire reached later are
# left out rather than guessed at.
LAST_FRONT_MINUTES = 780
HOURLY_AFTER_MINUTES = 540  # 7:50 a.m.
SIMPLIFY_M = 8.0  # under a lot's width, so a front still runs between houses
SMOOTH_M = 0.75 * CELL_M  # rounds off the grid's corners and fills single-cell notches

FIRST_IN_AREA_M = 300.0  # a report counts toward the fit only if no earlier report lies this close
SNAP_M = 200.0  # a report geocoded just outside the perimeter moves to the nearest burned cell
NUDGE_RADIUS_M = 400.0
NUDGE_PRIOR_WEIGHT = 1.0
IGNITION_WEIGHT = 5.0
BUILDING_REACH_M = 30.0
# Fire was at a report's place by the time it was reported, and spreads outward from there at a slow
# urban pace. This caps the fitted minute so the map never shows fire arriving after a nearby report.
# The reach is the dispatch simulator's far radius (sim.eaton_night FIRE_FAR_M): at 1 km, a lone
# pre-midnight report pulled whole blocks hours early (100 W Terrace St at 00:55 where the record first
# places fire within two blocks at 5:26 a.m.); at 500 m the fit's median error is about a minute.
SPREAD_FROM_REPORT_M_PER_MIN = 10.0
REPORT_REACH_M = 500.0

LABEL = "Eaton Fire replay, not a forecast"
BASIS = (
    "Where it burned is CAL FIRE's final perimeter for the Eaton Fire. When is fitted to dated fire reports in "
    "the UL FSRI timeline, from the 6:18 p.m. ignition. Each building burns as one piece. Minute zero is "
    "10:50 p.m., the first fire reported west of Lake Avenue."
)
SOURCES = [
    {"label": "CAL FIRE Eaton Fire heat perimeter (via LA County Public Works)", "url": "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Palisades_and_Eaton_Dissolved_Fire_Perimeters_as_of_20250121/FeatureServer"},
    {"label": "UL FSRI Southern California Fires Timeline Dataset, Eaton sheet", "url": "https://doi.org/10.60752/102376.29905157"},
    {"label": "NIFC WFIGS incident record (ignition point and time)"},
    {"label": "CAL FIRE damage inspections (DINS), for checking", "url": "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/DINS_2025_Eaton_Public_View/FeatureServer"},
]


def to_local(lng, lat):
    return (np.asarray(lng) - MAP_ORIGIN[1]) * METERS_PER_DEG_LNG, (np.asarray(lat) - MAP_ORIGIN[0]) * METERS_PER_DEG_LAT


def minutes_after_zero(moment: datetime) -> float:
    return (moment - MINUTE_ZERO).total_seconds() / 60.0


class Grid:
    """Cells aligned to longitude and latitude, row 0 at the south edge."""

    def __init__(self):
        (x0, x1), (y0, y1) = to_local([REGION["west"], REGION["east"]], [REGION["south"], REGION["north"]])
        self.x0, self.y0 = float(x0[()] if np.ndim(x0) else x0), float(y0)
        self.width = int(round((x1 - x0) / CELL_M))
        self.height = int(round((y1 - y0) / CELL_M))
        self.cell_x = (x1 - x0) / self.width
        self.cell_y = (y1 - y0) / self.height
        cols, rows = np.arange(self.width), np.arange(self.height)
        self.x, self.y = np.meshgrid(self.x0 + (cols + 0.5) * self.cell_x, self.y0 + (rows + 0.5) * self.cell_y)

    def cell_of(self, x, y):
        col = np.floor((np.asarray(x) - self.x0) / self.cell_x).astype(int)
        row = np.floor((np.asarray(y) - self.y0) / self.cell_y).astype(int)
        return row, col

    def holds(self, row, col):
        return (row >= 0) & (row < self.height) & (col >= 0) & (col < self.width)


def load_perimeter():
    feature = json.loads(PERIMETER_FILE.read_text())["features"][0]
    return transform(shape(feature["geometry"]), lambda c: np.column_stack(to_local(c[:, 0], c[:, 1])))


def load_sightings() -> list[dict]:
    """Every fire report the timeline can place, refreshed from the FSRI sheet when it is on disk."""
    if FSRI_FILE.exists():
        from rollcall_d.eaton import load_geocoder, load_records
        from rollcall_d.eaton_replay import fire_sightings

        found = fire_sightings(load_records(FSRI_FILE), load_geocoder())
        rows = [{"at": s.at.strftime("%Y-%m-%dT%H:%M"), "lat": round(s.lat, 5), "lng": round(s.lng, 5), "row": s.row} for s in found]
        rows.sort(key=lambda s: (s["at"], s["row"]))
        SIGHTINGS_FILE.write_text(json.dumps({
            "source": "UL FSRI Southern California Fires Timeline Dataset, Eaton sheet (doi:10.60752/102376.29905157)",
            "method": "rows that report fire at a structure or on the ground, placed by rollcall_d.eaton's geocoder",
            "sightings": rows,
        }, indent=1) + "\n")
    return json.loads(SIGHTINGS_FILE.read_text())["sightings"]


def ground_distance(grid: Grid, burned: np.ndarray) -> np.ndarray:
    """Meters from the ignition along the ground inside the burned area; straight-line where cut off."""
    ix, iy = to_local(IGNITION["lng"], IGNITION["lat"])
    row, col = grid.cell_of(ix, iy)
    phi = np.ones(burned.shape)
    phi[row, col] = -1
    reached = skfmm.distance(np.ma.MaskedArray(phi, ~burned), dx=[grid.cell_y, grid.cell_x])
    straight = np.hypot(grid.x - ix, grid.y - iy)
    return np.where(np.ma.getmaskarray(reached), straight, np.ma.filled(reached, 0.0))


def place_reports(grid: Grid, burned: np.ndarray, distance: np.ndarray, sightings: list[dict]):
    """Each report's position, minute and ground distance, snapped onto the burned area."""
    rows_b, cols_b = np.nonzero(burned)
    placed = []
    for s in sightings:
        x, y = to_local(s["lng"], s["lat"])
        row, col = grid.cell_of(x, y)
        if not (grid.holds(row, col) and burned[row, col]):
            gap = np.hypot(grid.x[rows_b, cols_b] - x, grid.y[rows_b, cols_b] - y)
            if gap.min() > SNAP_M:
                continue
            row, col = rows_b[gap.argmin()], cols_b[gap.argmin()]
        at = datetime.fromisoformat(s["at"]).replace(tzinfo=PACIFIC)
        placed.append((float(x), float(y), minutes_after_zero(at), float(distance[row, col])))
    return np.array(placed)


def first_in_area(reports: np.ndarray) -> np.ndarray:
    keep = []
    for i, (x, y, t, _) in enumerate(reports):
        earlier = (reports[:, 2] < t) & (np.hypot(reports[:, 0] - x, reports[:, 1] - y) < FIRST_IN_AREA_M)
        if not earlier.any():
            keep.append(i)
    return reports[keep]


def isotonic(x: np.ndarray, y: np.ndarray, w: np.ndarray):
    """Pool-adjacent-violators: the closest non-decreasing fit of y over x. Returns block centers and values."""
    order = np.argsort(x)
    blocks = [[x[i] * w[i], y[i] * w[i], w[i]] for i in order]
    merged: list[list[float]] = []
    for block in blocks:
        merged.append(block)
        while len(merged) > 1 and merged[-2][1] / merged[-2][2] > merged[-1][1] / merged[-1][2]:
            last = merged.pop()
            merged[-1] = [a + b for a, b in zip(merged[-1], last)]
    return np.array([b[0] / b[2] for b in merged]), np.array([b[1] / b[2] for b in merged])


class ArrivalFit:
    """The pace the reports show, by ground distance from the ignition, plus a local nudge near each report."""

    def __init__(self, reports: np.ndarray):
        start = minutes_after_zero(IGNITION["at"])
        distances = np.concatenate([[0.0], reports[:, 3]])
        minutes = np.concatenate([[start], reports[:, 2]])
        weights = np.concatenate([[IGNITION_WEIGHT], np.ones(len(reports))])
        self.knots, self.values = isotonic(distances, minutes, weights)
        self.start = start
        self.pace = (self.values[-1] - self.values[0]) / max(self.knots[-1] - self.knots[0], 1.0)
        self.reports = reports
        self.residuals = reports[:, 2] - self.pace_at(reports[:, 3])

    def pace_at(self, distance):
        inside = np.interp(distance, self.knots, self.values)
        beyond = self.values[-1] + (np.asarray(distance) - self.knots[-1]) * self.pace
        return np.where(np.asarray(distance) > self.knots[-1], beyond, inside)

    def nudge_at(self, x, y):
        total = np.zeros(np.shape(x))
        weight = np.full(np.shape(x), float(NUDGE_PRIOR_WEIGHT))
        for (rx, ry, _, _), residual in zip(self.reports, self.residuals):
            w = np.exp(-((np.asarray(x) - rx) ** 2 + (np.asarray(y) - ry) ** 2) / NUDGE_RADIUS_M**2)
            total += w * residual
            weight += w
        return total / weight

    def minutes_at(self, x, y, distance):
        return np.maximum(self.pace_at(distance) + self.nudge_at(x, y), self.start)


def report_envelope(x: np.ndarray, y: np.ndarray, reports: np.ndarray) -> np.ndarray:
    """The latest the fire can arrive and still have reached every nearby report in time."""
    latest = np.full(np.shape(x), np.inf)
    for rx, ry, t, _ in reports:
        gap = np.hypot(x - rx, y - ry)
        latest = np.where(gap <= REPORT_REACH_M, np.minimum(latest, t + gap / SPREAD_FROM_REPORT_M_PER_MIN), latest)
    return latest


def arrival_minutes(fit: ArrivalFit, reports: np.ndarray, x, y, distance):
    return np.minimum(fit.minutes_at(x, y, distance), report_envelope(x, y, reports))


def leave_one_out(firsts: np.ndarray, reports: np.ndarray) -> np.ndarray:
    """Each first report predicted from everything else, leaving out every report in its neighborhood."""
    errors = []
    for i, (x, y, t, distance) in enumerate(firsts):
        fit = ArrivalFit(np.delete(firsts, i, axis=0))
        others = reports[np.hypot(reports[:, 0] - x, reports[:, 1] - y) >= FIRST_IN_AREA_M]
        predicted = arrival_minutes(fit, others, np.array([x]), np.array([y]), np.array([distance]))
        errors.append(float(predicted[0]) - t)
    return np.array(errors)


def load_buildings():
    """Each map building's centre in the map's meters (the baked map stores decimeters)."""
    data = json.loads(MAP_FILE.read_text())
    if tuple(data["origin"].values()) != MAP_ORIGIN:
        raise ValueError(f"map origin {data['origin']} is not {MAP_ORIGIN}")
    centres = []
    for b in data["buildings"]:
        ring = np.array(b[4:], dtype=float).reshape(-1, 2) / 10.0
        centres.append(ring.mean(axis=0))
    return np.array(centres)


def nearest_building(grid: Grid, centres: np.ndarray):
    """For every cell, the index of the nearest building within reach, or -1."""
    reach = int(math.ceil(BUILDING_REACH_M / min(grid.cell_x, grid.cell_y)))
    offsets = np.array([(dr, dc) for dr in range(-reach, reach + 1) for dc in range(-reach, reach + 1)])
    row, col = grid.cell_of(centres[:, 0], centres[:, 1])
    rows = (row[:, None] + offsets[None, :, 0]).ravel()
    cols = (col[:, None] + offsets[None, :, 1]).ravel()
    owner = np.repeat(np.arange(len(centres)), len(offsets))
    ok = grid.holds(rows, cols)
    rows, cols, owner = rows[ok], cols[ok], owner[ok]
    gap = np.hypot(grid.x[rows, cols] - centres[owner, 0], grid.y[rows, cols] - centres[owner, 1])
    near = gap <= BUILDING_REACH_M
    rows, cols, owner, gap = rows[near], cols[near], owner[near], gap[near]
    order = np.argsort(-gap)  # nearest written last
    nearest = np.full((grid.height, grid.width), -1)
    nearest[rows[order], cols[order]] = owner[order]
    return nearest


def arrival_grid(grid, burned, ground, centres, perimeter):
    """Ground minutes everywhere in the perimeter, overwritten near each building by that building's minute."""
    row, col = grid.cell_of(centres[:, 0], centres[:, 1])
    on_grid = grid.holds(row, col)
    inside = contains_xy(perimeter, centres[:, 0], centres[:, 1]) & on_grid
    building_minutes = np.full(len(centres), np.inf)
    building_minutes[inside] = ground[row[inside], col[inside]]
    minutes = np.where(burned, ground, np.inf)
    owner = nearest_building(grid, centres)
    owned_by_burning = owner >= 0
    owned_by_burning[owned_by_burning] = inside[owner[owned_by_burning]]
    minutes[owned_by_burning] = building_minutes[owner[owned_by_burning]]
    return minutes, building_minutes, inside


def to_lnglat(coords):
    return np.column_stack([coords[:, 0] / METERS_PER_DEG_LNG + MAP_ORIGIN[1], coords[:, 1] / METERS_PER_DEG_LAT + MAP_ORIGIN[0]])


def burned_by(grid: Grid, minutes: np.ndarray, minute: float):
    """Everything burned by a minute as polygons: each row's runs of burned cells, merged."""
    burned = minutes <= minute
    pieces = []
    for row in range(grid.height):
        line = np.concatenate([[False], burned[row], [False]])
        edges = np.flatnonzero(line[1:] != line[:-1])
        y0 = grid.y0 + row * grid.cell_y
        for start, end in zip(edges[::2], edges[1::2]):
            pieces.append(box(grid.x0 + start * grid.cell_x, y0, grid.x0 + end * grid.cell_x, y0 + grid.cell_y))
    closed = unary_union(pieces).buffer(SMOOTH_M).buffer(-SMOOTH_M)
    return closed.buffer(-SMOOTH_M / 2).buffer(SMOOTH_M / 2).simplify(SIMPLIFY_M)


# Half-hourly through the hours west Altadena burned. Before the warning the night only needs to show
# what had burned by then, and after 8 a.m. hourly fronts carry the slower spread into the hills.
def front_minutes(minutes: np.ndarray) -> list[int]:
    first = math.floor(np.min(minutes[np.isfinite(minutes)]) / FRONT_STEP_MINUTES) * FRONT_STEP_MINUTES + FRONT_STEP_MINUTES
    return [first, *range(0, HOURLY_AFTER_MINUTES, FRONT_STEP_MINUTES), *range(HOURLY_AFTER_MINUTES, LAST_FRONT_MINUTES + 1, 60)]


def fronts(grid: Grid, minutes: np.ndarray) -> list[dict]:
    """Everything burned by each half hour, islands as holes, nested because arrival only grows."""
    features = []
    for minute in front_minutes(minutes):
        geometry = transform(burned_by(grid, minutes, minute), to_lnglat)
        features.append({"type": "Feature", "properties": {"minutesAfterWarning": minute}, "geometry": rounded(mapping(geometry))})
    return features


def rounded(value):
    if isinstance(value, float):
        return round(value, 5)
    if isinstance(value, (list, tuple)):
        return [rounded(v) for v in value]
    if isinstance(value, dict):
        return {k: rounded(v) for k, v in value.items()}
    return value


def fit_summary(reports, firsts, errors) -> dict:
    return {
        "reportsPlaced": len(reports),
        "firstInArea": len(firsts),
        "leaveOneOutMedianMinutes": round(float(np.median(errors)), 1),
        "leaveOneOutMeanAbsoluteMinutes": round(float(np.mean(np.abs(errors))), 1),
        "leaveOneOutWithinHour": round(float(np.mean(np.abs(errors) <= 60)), 2),
        "leaveOneOutLaterThanReportByHour": round(float(np.mean(errors > 60)), 2),
    }


def write_scenarios(features: list[dict], fit: dict, buildings_burned: int) -> None:
    metadata = {
        "name": "Eaton Fire, January 7 and 8, 2025",
        "label": LABEL,
        "basis": BASIS,
        "generator": "modeling/scripts/build_eaton_fire.py",
        "perimeter": "data/eaton/perimeter-eaton.geojson (CAL FIRE heat perimeter, 14,056 GIS acres, January 21, 2025)",
        "sightings": "data/eaton/fire-sightings.json (UL FSRI Southern California Fires Timeline Dataset)",
        "ignition": {"lat": IGNITION["lat"], "lng": IGNITION["lng"], "at": IGNITION["at"].isoformat()},
        "minuteZero": MINUTE_ZERO.isoformat(),
        "fit": fit,
        "buildingsBurned": buildings_burned,
        "headSpreadMetersPerMinute": SPREAD_FROM_REPORT_M_PER_MIN,
        "neverMarksSafe": "Homes outside every front get an extrapolated arrival time, never 'safe'.",
    }
    legacy = {"type": "FeatureCollection", "metadata": metadata, "features": [{**f, "properties": {**f["properties"], "label": LABEL}} for f in features]}
    SCENARIO_FILE.write_text(json.dumps(legacy, separators=(",", ":")) + "\n")
    v2 = {
        "version": 2,
        "city": "altadena",
        "kind": "wildfire",
        "label": LABEL,
        "basis": BASIS,
        "sources": SOURCES,
        "clock": {"warningAt": MINUTE_ZERO.isoformat(), "minutesShown": features[-1]["properties"]["minutesAfterWarning"]},
        "fronts": {"type": "FeatureCollection", "features": features},
        "series": {"headSpreadMetersPerMinute": SPREAD_FROM_REPORT_M_PER_MIN},
    }
    SCENARIO_V2_FILE.write_text(json.dumps(v2, separators=(",", ":")) + "\n")


def main() -> None:
    grid = Grid()
    perimeter = load_perimeter()
    burned = contains_xy(perimeter, grid.x, grid.y)
    distance = ground_distance(grid, burned)
    reports = place_reports(grid, burned, distance, load_sightings())
    firsts = first_in_area(reports)
    fit = ArrivalFit(firsts)
    errors = leave_one_out(firsts, reports)
    ground = arrival_minutes(fit, reports, grid.x, grid.y, distance)
    centres = load_buildings()
    minutes, _, inside = arrival_grid(grid, burned, ground, centres, perimeter)
    features = fronts(grid, minutes)
    write_scenarios(features, fit_summary(reports, firsts, errors), int(inside.sum()))
    vertices = sum(len(json.dumps(f["geometry"])) for f in features)
    print(f"grid {grid.width}x{grid.height}, {len(reports)} reports placed, {len(firsts)} first in their area")
    print(f"leave-one-out error: median {np.median(errors):.0f} min, mean absolute {np.mean(np.abs(errors)):.0f} min, "
          f"within an hour {np.mean(np.abs(errors) <= 60):.0%}, over an hour later than the report {np.mean(errors > 60):.0%}")
    print(f"buildings burned {inside.sum()} of {len(centres)}; {len(features)} fronts, "
          f"{features[0]['properties']['minutesAfterWarning']} to {features[-1]['properties']['minutesAfterWarning']} min, {vertices / 1e6:.2f} MB of geometry")
    for path in (SCENARIO_FILE, SCENARIO_V2_FILE):
        print(f"wrote {path} ({path.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
