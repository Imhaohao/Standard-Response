"""Fort Myers Beach, 28 September 2022: Hurricane Ian's storm surge over Estero Island.

Minute 0 is Lee County's mandatory evacuation order for Zone A, 07:00 on 27 September. The water level comes
from the five USGS storm-tide sensors around the map (the pier, Matanzas Pass, Big Carlos Pass, Punta Rassa and
Mullock Creek), wave-filtered: at each front's minute every cell takes the inverse-distance mix of the sensors'
levels at that minute, so San Carlos Island, Iona and the south end of the island get their own nearby timing
and height. A cell floods when its local level is above its ground and it joins the Gulf or Estero Bay through
lower cells. Provenance for every number is data/cities/fort-myers-beach/sources.md.
"""

import numpy as np
from shapely.geometry import box

from water_flood import FloodSetup, open_water, rasterize
from water_inputs import city_data, minutes_between, warning_time
from water_terrain import Box, Terrain

ID = "fort-myers-beach"
KIND = "surge"
BOX = Box(south=26.39, west=-82.01, north=26.505, east=-81.865)
CELL_METERS = 6.0
MIN_PART_CELLS = 20
# Each front is the Gulf and the bays plus the land they have reached, so the beach and the keys sit inside one
# body of water instead of along a simplified shoreline that could shave them off.
FRONTS_INCLUDE_OPEN_WATER = True
MAX_VERTICES_PER_FRONT = 1500
OPEN_WATER_POINTS = [(26.42, -81.97), (26.44, -81.99), (26.45, -81.92), (26.457, -81.952), (26.41, -81.89)]
FRONT_CLOCK_TIMES = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:20",
    "14:40", "15:00", "15:20", "15:40",
]
DRY_READING_M = 0.45
IDW_MIN_DISTANCE_M = 50.0
# lib/cities.ts: the extent the map bakes for this city (detail 26.405-26.49, -81.995 to -81.88, grown by 0.012
# degrees). Water beyond it isn't drawn.
MAP_EXTENT = {"minx": -82.007, "miny": 26.393, "maxx": -81.868, "maxy": 26.502}


def inputs() -> tuple[dict, dict]:
    return city_data(ID, "timeline.json"), city_data(ID, "gauges.json")


def sensor(gauges: dict, site: str) -> dict:
    return next(s for s in gauges["sensors"] if s["site"] == site)


def wet_samples(samples: list[dict]) -> list[dict]:
    """The record from the last dry reading before the surge to the first dry reading after it."""
    wet = [i for i, s in enumerate(samples) if s["meters"] > DRY_READING_M]
    return samples[max(wet[0] - 1, 0): wet[-1] + 2]


def flood_setup(terrain: Terrain) -> FloodSetup:
    water = open_water(terrain, OPEN_WATER_POINTS, still_level=0.1)
    return FloodSetup(terrain=terrain, source_water=water, domain=rasterize(terrain, [box(**MAP_EXTENT)]))


def level_at(points: list[tuple[float, float]], minute: float) -> float:
    if minute <= points[0][0]:
        return points[0][1]
    for (m0, z0), (m1, z1) in zip(points, points[1:]):
        if m0 <= minute <= m1:
            return z0 + (z1 - z0) * (minute - m0) / (m1 - m0)
    return points[-1][1]


def idw_weights(terrain: Terrain, sensors: list[dict]) -> np.ndarray:
    rows, cols = np.indices(terrain.shape)
    box = terrain.box
    cell_lat = box.north - (rows + 0.5) / terrain.shape[0] * (box.north - box.south)
    cell_lng = box.west + (cols + 0.5) / terrain.shape[1] * (box.east - box.west)
    weights = []
    for s in sensors:
        dy = (cell_lat - s["lat"]) * 110_574.0
        dx = (cell_lng - s["lng"]) * box.meters_per_deg_lng
        weights.append(1.0 / np.maximum(dx * dx + dy * dy, IDW_MIN_DISTANCE_M**2))
    stacked = np.stack(weights)
    return (stacked / stacked.sum(axis=0)).astype(np.float32)


def front_steps(terrain: Terrain) -> list[dict]:
    timeline, gauges = inputs()
    start = warning_time(timeline)
    sensors = gauges["sensors"]
    weights = idw_weights(terrain, sensors)
    series = [[(minutes_between(start, x["local"]), x["meters"]) for x in s["samples"]] for s in sensors]
    steps = []
    for clock in FRONT_CLOCK_TIMES:
        minute = minutes_between(start, f"2022-09-28T{clock}-04:00")
        levels = np.array([level_at(points, minute) for points in series], dtype=np.float32)
        surface = np.tensordot(levels, weights, axes=1)
        pier = levels[0]
        steps.append({"minute": round(minute), "level": surface, "note": f"{clock} EDT 28 Sep: pier {pier:.2f} m NAVD88, local levels {levels.min():.2f}-{levels.max():.2f} m"})
    return steps


def level_samples(gauges: dict, site: str, start: str) -> list[dict]:
    return [{"minutes": round(minutes_between(start, s["local"])), "meters": s["meters"]} for s in wet_samples(sensor(gauges, site)["samples"])]


def wind_samples(gauges: dict, start: str) -> list[dict]:
    return [
        {"minutes": round(minutes_between(start, w["local"])), "fromDegrees": w["fromDegrees"], "metersPerSecond": w["metersPerSecond"], "gustMetersPerSecond": w["gustMetersPerSecond"]}
        for w in gauges["wind"]["samples"]
        if minutes_between(start, w["local"]) >= 0
    ]


def scenario_parts(fronts: list[dict], terrain: Terrain) -> dict:
    timeline, gauges = inputs()
    start = warning_time(timeline)
    others = [s for s in gauges["sensors"] if s["site"] != "FLLEE03382"]
    return {
        "kind": KIND,
        "label": "Scenario input from the 2022 record, not a forecast",
        "basis": "Water levels are the five USGS storm-tide sensors around Fort Myers Beach during Hurricane Ian (the pier peaked at "
        "13.23 ft NAVD88 at 14:39), blended by distance over today's USGS 3DEP ground and joined to the Gulf and Estero Bay. "
        "Minute 0 is Lee County's 07:00 Zone A order on 27 September. Wind is the NOAA Fort Myers gauge, 22 km inland.",
        "clock": {"warningAt": start, "minutesShown": fronts[-1]["minutesAfterWarning"] + 120},
        "series": {
            "water": {
                "datum": "NAVD88",
                "level": level_samples(gauges, "FLLEE03382", start),
                "gauges": [
                    {"id": s["site"], "name": f"USGS {s['site']}, {s['name']}", "at": {"lat": s["lat"], "lng": s["lng"]}, "level": level_samples(gauges, s["site"], start)}
                    for s in others
                ],
            },
            "wind": wind_samples(gauges, start),
        },
    }


SOURCES = [
    {"label": "Bucci et al., NHC Tropical Cyclone Report: Hurricane Ian (AL092022), revised 2026", "url": "https://www.nhc.noaa.gov/data/tcr/AL092022_Ian.pdf"},
    {"label": "USGS Short-Term Network, Hurricane Ian (event 325): storm-tide sensors FLLEE03382, 03284, 03288, 03246, 03287 and high-water marks", "url": "https://api.waterdata.usgs.gov/stnservices/sites/3382/peaksummaryview/"},
    {"label": "Lee County, Hurricane Ian After-Action Report (2023): evacuation order times", "url": "https://www.leegov.com/hurricane/Documents/AAR/Lee%20County%20Hurricane%20Ian%20AAR.pdf"},
    {"label": "NOAA CO-OPS Fort Myers 8725520: water level and wind", "url": "https://tidesandcurrents.noaa.gov/stationhome.html?id=8725520"},
    {"label": "USGS 3DEP 1/3 arc-second DEM", "url": "https://www.usgs.gov/3d-elevation-program"},
    {"label": "Every source and assumption: data/cities/fort-myers-beach/sources.md"},
]
