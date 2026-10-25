"""Camp Fire fronts over Paradise, 8 November 2018, built from NIST's fire observations.

Input: data/cities/paradise/nist-observations.json (paradise_observations.py), every dated and
geolocated observation of fire in NIST TN 2135 Appendix F.

Method. Each observation says fire was at a point by a time. The area reached by clock time t is the
union of discs around every observation made at or before t, each disc growing at a constant speed
from its observation time:

    reached(t) = union over observations i with t_i <= t of disc(p_i, SPEED * (t - t_i))

which is the same as arrival(x) = min_i (t_i + |x - p_i| / SPEED). That union is clipped to CAL FIRE's
final Camp Fire perimeter and to the Paradise frame. Minute 0 is 07:46 PST, when the incident commander
requested the first evacuation order inside Paradise (NIST TN 2252, Table 10).

    cd modeling && uv run python scripts/cities/paradise_fronts.py
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

import numpy as np
import requests
from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.ops import transform, unary_union

REPO = Path(__file__).resolve().parents[3]
OBSERVATIONS = REPO / "data" / "cities" / "paradise" / "nist-observations.json"
BURNOVERS = REPO / "data" / "cities" / "paradise" / "nist-burnovers.json"
OUTPUT = REPO / "data" / "cities" / "paradise" / "fronts.geojson"
PERIMETER_URL = (
    "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/"
    "InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0/query"
)
CALFIRE_FINAL_PERIMETER_OBJECTID = 50567

WARNING_CLOCK = "07:46"
FRONT_CLOCKS = (
    "07:50", "08:00", "08:15", "08:30", "08:45", "09:00", "09:30", "10:00",
    "10:30", "11:00", "12:00", "13:00", "14:00", "15:00", "17:00",
)
SPEED_M_PER_MIN = 12.0
MAX_WINDOW_MIN = 60
FRAME = {"west": -121.668, "south": 39.716, "east": -121.552, "north": 39.811}
MAX_VERTICES = 300
LAT0 = 39.76
M_PER_DEG_LNG = 111_320 * math.cos(math.radians(LAT0))
M_PER_DEG_LAT = 110_540


def clock_minutes(clock: str) -> int:
    hour, minute = clock.split(":")
    return int(hour) * 60 + int(minute)


def to_meters(lng: float, lat: float, z=None):
    return (lng + 121.6) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT


def to_degrees(x: float, y: float, z=None):
    return x / M_PER_DEG_LNG - 121.6, y / M_PER_DEG_LAT + LAT0


def usable_observations() -> list[dict]:
    rows = json.loads(OBSERVATIONS.read_text())["observations"]
    return [r for r in rows if r["date"] == "2018-11-08" and (r["windowMinutes"] or 0) <= MAX_WINDOW_MIN]


def fetch_perimeter():
    params = {
        "where": f"OBJECTID={CALFIRE_FINAL_PERIMETER_OBJECTID}",
        "outFields": "INCIDENT,GIS_ACRES,SOURCE,UNIT_ID,DATE_CUR",
        "outSR": "4326",
        "geometryPrecision": "6",
        "f": "geojson",
    }
    response = requests.get(PERIMETER_URL, params=params, timeout=120)
    response.raise_for_status()
    feature = response.json()["features"][0]
    return shape(feature["geometry"]), feature["properties"]


def reached_by(observations: list[dict], minute: int):
    discs = [
        Point(to_meters(r["lng"], r["lat"])).buffer(max(SPEED_M_PER_MIN * (minute - r["minutesAfterMidnight8Nov"]), 15.0), 24)
        for r in observations
        if r["minutesAfterMidnight8Nov"] <= minute
    ]
    return unary_union(discs)


def vertex_count(geometry) -> int:
    polygons = geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]
    return sum(len(p.exterior.coords) + sum(len(i.coords) for i in p.interiors) for p in polygons)


def simplified(geometry):
    tolerance = 10.0
    result = geometry.simplify(tolerance, preserve_topology=True)
    while vertex_count(result) > MAX_VERTICES:
        tolerance *= 1.5
        result = geometry.simplify(tolerance, preserve_topology=True)
    return result


def without_specks(geometry, min_area_m2: float = 2_000.0):
    polygons = geometry.geoms if isinstance(geometry, MultiPolygon) else [geometry]
    kept = [Polygon(p.exterior, [i for i in p.interiors if Polygon(i).area >= min_area_m2]) for p in polygons if p.area >= min_area_m2]
    return unary_union(kept)


def leave_one_out_lateness(observations: list[dict]) -> dict:
    """How often fire was seen at a first-sighting point more than 30 minutes before the fronts say it arrived."""
    xy = np.array([to_meters(r["lng"], r["lat"]) for r in observations])
    t = np.array([r["minutesAfterMidnight8Nov"] for r in observations], float)
    in_frame = np.array([FRAME["west"] < r["lng"] < FRAME["east"] and FRAME["south"] < r["lat"] < FRAME["north"] for r in observations])
    distance = np.hypot(xy[:, None, 0] - xy[None, :, 0], xy[:, None, 1] - xy[None, :, 1])
    np.fill_diagonal(distance, np.inf)
    first = np.array([not np.any((distance[j] < 200) & (t < t[j])) for j in range(len(t))]) & in_frame
    predicted = np.min(t[None, :] + distance / SPEED_M_PER_MIN, axis=1)
    error = (predicted - t)[first]
    return {
        "firstSightingsInFrame": int(first.sum()),
        "shareSeenOver30MinBeforeModel": round(float(np.mean(error > 30)), 3),
        "shareSeenOver15MinBeforeModel": round(float(np.mean(error > 15)), 3),
        "medianModelMinusObservedMinutes": round(float(np.median(error)), 1),
    }


def front_features(observations, clip_m) -> list[dict]:
    features, previous = [], None
    warning = clock_minutes(WARNING_CLOCK)
    for clock in FRONT_CLOCKS:
        minute = clock_minutes(clock)
        area = without_specks(reached_by(observations, minute).intersection(clip_m))
        area = simplified(area)
        if previous is not None:
            area = area.union(previous)
        previous = area
        geometry = transform(to_degrees, area)
        features.append({
            "type": "Feature",
            "properties": {
                "minutesAfterWarning": minute - warning,
                "clockTime": f"2018-11-08T{clock}:00-08:00",
                "observationsSoFar": sum(1 for r in observations if r["minutesAfterMidnight8Nov"] <= minute),
                "areaKm2": round(area.area / 1e6, 2),
                "vertices": vertex_count(area),
                "label": "Scenario input, not a forecast",
            },
            "geometry": rounded(mapping(geometry)),
        })
    return features


def rounded(geometry: dict) -> dict:
    def walk(value):
        if isinstance(value, (list, tuple)):
            if value and isinstance(value[0], float):
                return [round(value[0], 6), round(value[1], 6)]
            return [walk(v) for v in value]
        return value

    return {"type": geometry["type"], "coordinates": walk(geometry["coordinates"])}


def burnover_minutes(when: str) -> tuple[int, int | None]:
    """'November 8, 08:45–11:15' -> minutes after minute 0 for the start and end (None when not determined)."""
    day = int(re.search(r"November (\d+)", when)[1])
    clocks = re.findall(r"(\d{1,2}):(\d\d)", when)
    offsets = [(day - 8) * 1440 + int(h) * 60 + int(m) - clock_minutes(WARNING_CLOCK) for h, m in clocks]
    return offsets[0], offsets[1] if len(offsets) > 1 else None


def road_burnovers() -> list[dict]:
    rows = json.loads(BURNOVERS.read_text())["burnovers"]
    in_frame = [r for r in rows if FRAME["west"] <= r["lng"] <= FRAME["east"] and FRAME["south"] <= r["lat"] <= FRAME["north"]]
    return [
        {**r, "startMinutesAfterWarning": burnover_minutes(r["when"])[0], "endMinutesAfterWarning": burnover_minutes(r["when"])[1]}
        for r in in_frame
    ]


def main() -> None:
    observations = usable_observations()
    perimeter, perimeter_properties = fetch_perimeter()
    frame = box(FRAME["west"], FRAME["south"], FRAME["east"], FRAME["north"])
    clip_m = transform(to_meters, perimeter.intersection(frame).buffer(0))
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "Camp Fire reaching Paradise, 8 November 2018",
            "label": "Reconstruction of a past fire, not a forecast",
            "generator": "modeling/scripts/cities/paradise_fronts.py",
            "warningClock": f"2018-11-08T{WARNING_CLOCK}:00-08:00",
            "speedMetersPerMinute": SPEED_M_PER_MIN,
            "observationsUsed": len(observations),
            "maxObservationWindowMinutes": MAX_WINDOW_MIN,
            "frame": FRAME,
            "clippedTo": {"perimeter": perimeter_properties, "source": PERIMETER_URL},
            "check": leave_one_out_lateness(observations),
            "roadBurnovers": road_burnovers(),
        },
        "features": front_features(observations, clip_m),
    }
    OUTPUT.write_text(json.dumps(collection, separators=(",", ":")) + "\n")
    for feature in collection["features"]:
        p = feature["properties"]
        print(p["clockTime"][11:16], p["minutesAfterWarning"], p["areaKm2"], "km2", p["vertices"], "vertices", feature["geometry"]["type"])
    print(collection["metadata"]["check"])


if __name__ == "__main__":
    main()
