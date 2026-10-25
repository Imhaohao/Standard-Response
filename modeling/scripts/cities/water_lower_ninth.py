"""Lower Ninth Ward, 29 August 2005: the Industrial Canal (IHNC) east floodwall breaches during Katrina.

Minute 0 is the city's mandatory evacuation order, 11:00 on 28 August. The water may go anywhere inside the
Lower Ninth Ward and Holy Cross neighbourhood outlines, and comes in only through the two breaches. A cell
floods once the ward's water surface (series.json, from IPET's stopped clocks and Jackson Barracks photos) is
above its ground, it joins a breach through cells below that surface, and the water front from an open breach
has had time to travel there. Provenance for every number is data/cities/lower-ninth/sources.md.
"""

import numpy as np
from scipy import ndimage
from shapely.geometry import Point, shape

from water_flood import FloodSetup, distance_meters, open_water, rasterize
from water_inputs import city_data, first_minute_at, minutes_between, warning_time
from water_terrain import Box, Terrain

ID = "lower-ninth"
KIND = "flood"
BOX = Box(south=29.935, west=-90.045, north=29.99, east=-89.96)
CELL_METERS = 5.0
MIN_PART_CELLS = 40
FEET = 0.3048
CANAL_POINT = (29.972, -90.0245)
LEVEE_CROSSING_METERS = 40
RIVER_POINT = (29.952, -90.02)
FRONT_CLOCK_TIMES = [
    "04:45", "05:00", "05:15", "05:30", "06:00", "06:30", "07:00", "07:30", "07:40", "07:50", "08:00",
    "08:15", "08:30", "09:00", "09:20", "10:00", "10:30", "12:30", "13:42",
]


def inputs() -> tuple[dict, dict]:
    return city_data(ID, "timeline.json"), city_data(ID, "series.json")


def ward_level_points(series: dict, start: str) -> list[tuple[float, float]]:
    return [(minutes_between(start, at), feet * FEET) for at, feet, _ in series["ward"]["samplesFt"]]


def ward_and_canal(terrain: Terrain) -> tuple[np.ndarray, np.ndarray]:
    """The Lower Ninth Ward and Holy Cross, plus St. Bernard Parish south of the 40 Arpent Canal out to the map's extent."""
    outlines = city_data(ID, "neighborhoods.geojson")["features"] + city_data(ID, "st-bernard-polder.geojson")["features"]
    ward = rasterize(terrain, [shape(feature["geometry"]) for feature in outlines])
    canal = open_water(terrain, [CANAL_POINT], still_level=0.0)
    river = open_water(terrain, [RIVER_POINT], still_level=0.5)
    return ward & ~canal & ~river, canal


def flood_setup(terrain: Terrain) -> FloodSetup:
    ward, _ = ward_and_canal(terrain)
    _, series = inputs()
    breach_cells = np.zeros(terrain.shape, dtype=bool)
    for breach in series["breaches"]:
        breach_cells |= breach_mask(terrain, breach)
    return FloodSetup(terrain=terrain, source_water=breach_cells, domain=ward | breach_cells)


def on_east_bank(terrain: Terrain, at: dict) -> dict:
    """The point on the ward's canal bank nearest the assumed position: the floodwall sits on that bank."""
    ward, canal = ward_and_canal(terrain)
    bank = ward & ndimage.binary_dilation(canal, iterations=2)
    row, col = terrain.cell_of(at["lat"], at["lng"])
    _, (rows, cols) = ndimage.distance_transform_edt(~bank, return_indices=True)
    bank_row, bank_col = rows[row, col], cols[row, col]
    box = terrain.box
    height, width = terrain.shape
    return {
        "lat": round(box.north - (bank_row + 0.5) / height * (box.north - box.south), 5),
        "lng": round(box.west + (bank_col + 0.5) / width * (box.east - box.west), 5),
    }


def breach_mask(terrain: Terrain, breach: dict) -> np.ndarray:
    """The opening: as wide as the breach, reaching across the levee from the canal to the ward's streets."""
    at = on_east_bank(terrain, breach["at"])
    radius_degrees = (breach["widthFt"] * FEET / 2 + LEVEE_CROSSING_METERS) / 111_000
    return rasterize(terrain, [Point(at["lng"], at["lat"]).buffer(radius_degrees)])


def inflow_mask(terrain: Terrain, inflow: dict) -> np.ndarray:
    """Water arriving across the domain's east edge, where the map's extent stops short of Paris Road."""
    ward, _ = ward_and_canal(terrain)
    columns = np.flatnonzero(ward.any(axis=0))
    edge = np.zeros(terrain.shape, dtype=bool)
    edge[:, columns[-2:]] = True
    return edge & ward


def entry_masks(terrain: Terrain, series: dict) -> list[tuple[dict, np.ndarray]]:
    return [(b, breach_mask(terrain, b)) for b in series["breaches"]] + [(i, inflow_mask(terrain, i)) for i in series.get("inflows", [])]


def travel_gate(terrain: Terrain, entries: list[tuple[dict, np.ndarray]], start: str, minute: float) -> np.ndarray:
    gate = np.zeros(terrain.shape, dtype=bool)
    for entry, mask in entries:
        open_for = minute - minutes_between(start, entry["opens"])
        if open_for > 0:
            gate |= distance_meters(terrain, mask) <= entry["frontMetersPerMinute"] * open_for
    return gate


def open_inflows(terrain: Terrain, series: dict, start: str, minute: float) -> np.ndarray:
    sources = np.zeros(terrain.shape, dtype=bool)
    for inflow in series.get("inflows", []):
        if minute >= minutes_between(start, inflow["opens"]):
            sources |= inflow_mask(terrain, inflow)
    return sources


def front_steps(terrain: Terrain) -> list[dict]:
    timeline, series = inputs()
    start = warning_time(timeline)
    points = ward_level_points(series, start)
    entries = entry_masks(terrain, series)
    steps = []
    for clock in FRONT_CLOCK_TIMES:
        minute = minutes_between(start, f"2005-08-29T{clock}-05:00")
        if minute < points[0][0]:
            continue
        level = interpolated(points, minute)
        steps.append({
            "minute": round(minute), "level": level, "gate": travel_gate(terrain, entries, start, minute),
            "sources": open_inflows(terrain, series, start, minute),
            "note": f"{clock} CDT 29 Aug: ward water surface {level / FEET:.1f} ft NAVD88",
        })
    return steps


def interpolated(points: list[tuple[float, float]], minute: float) -> float:
    for (m0, z0), (m1, z1) in zip(points, points[1:]):
        if m0 <= minute <= m1:
            return z0 + (z1 - z0) * (minute - m0) / (m1 - m0)
    return points[-1][1]


def level_samples(points: list[tuple[float, float]]) -> list[dict]:
    return [{"minutes": round(m), "meters": round(z, 2)} for m, z in points]


def scenario_parts(fronts: list[dict], terrain: Terrain) -> dict:
    timeline, series = inputs()
    start = warning_time(timeline)
    lock = [(minutes_between(start, at), feet * FEET) for at, feet in series["ihncLock"]["samplesFt"]]
    breaches = [
        {"at": on_east_bank(terrain, b["at"]), "opensAtMinutes": round(minutes_between(start, b["opens"])), "widthMeters": round(b["widthFt"] * FEET), "label": b["label"]}
        for b in series["breaches"]
    ]
    first_water = first_minute_at(ward_level_points(series, start), -6.0 * FEET + 0.01)
    return {
        "kind": KIND,
        "label": "Scenario input from the 2005 record, not a forecast",
        "basis": "Water enters through the two Industrial Canal floodwall breaches IPET, ILIT and Team Louisiana describe, runs east "
        "across the parish line into Arabi as IPET found, and rises to the levels IPET's stopped clocks and Jackson Barracks photographs "
        "show, peaking near 10.5 ft NAVD88; depths come from today's USGS 3DEP ground. Breach positions and how fast the water "
        "spread are stated assumptions.",
        "clock": {"warningAt": start, "minutesShown": fronts[-1]["minutesAfterWarning"]},
        "series": {
            "water": {
                "datum": "NAVD88 (IPET's 2004.65 epoch; the ground model is today's 3DEP)",
                "level": level_samples(ward_level_points(series, start)),
                "gauges": [{"id": "ihnc-lock", "name": "Industrial Canal at the lock (IPET staff gauge)", "at": {"lat": series["ihncLock"]["at"]["lat"], "lng": series["ihncLock"]["at"]["lng"]}, "level": level_samples(lock)}],
            },
            "breaches": breaches,
        },
        "firstWaterMinute": round(first_water) if first_water is not None else None,
    }


SOURCES = [
    {"label": "USACE IPET final report, Vol. IV The Storm (2007-2009): IHNC lock hydrograph, Lower Ninth eyewitnesses, stopped clocks, Fig. 136", "url": "https://biotech.law.lsu.edu/katrina/ipet/ipet.html"},
    {"label": "USACE IPET Vol. V The Performance, App. 14: breach positions and widths", "url": "https://biotech.law.lsu.edu/katrina/ipet/ipet.html"},
    {"label": "Seed et al., ILIT final report (2006), Ch. 6: IHNC breaches", "url": "https://biotech.law.lsu.edu/katrina/ILIT/report/CH_6.pdf"},
    {"label": "Team Louisiana, The Failure of the New Orleans Levee System during Hurricane Katrina (2007)", "url": "https://levees.org/2/wp-content/uploads/2019/05/Team-LA-F26-FINAL-REPORT.pdf"},
    {"label": "In re Katrina Canal Breaches (Barge), Findings of Fact, Doc. 20149 (2011)", "url": "https://biotech.law.lsu.edu/katrina/CanalCases/Orders/20149.pdf"},
    {"label": "Knabb, Rhome & Brown, NHC Tropical Cyclone Report: Hurricane Katrina (AL122005)", "url": "https://www.nhc.noaa.gov/data/tcr/AL122005_Katrina.pdf"},
    {"label": "US House Select Bipartisan Committee, A Failure of Initiative (2006), p. 108: the 11:00 evacuation order", "url": "https://www.govinfo.gov/content/pkg/CRPT-109hrpt377/pdf/CRPT-109hrpt377.pdf"},
    {"label": "City of New Orleans neighbourhood statistical areas (Lower Ninth Ward, Holy Cross)", "url": "https://maps.nola.gov/server/rest/services/Reference/Reference_Layers/MapServer/0"},
    {"label": "OpenStreetMap St. Bernard Parish boundary and Forty Arpent Canal (ODbL)", "url": "https://www.openstreetmap.org/relation/1836430"},
    {"label": "USGS 3DEP 1/3 arc-second DEM", "url": "https://www.usgs.gov/3d-elevation-program"},
    {"label": "Every source and assumption: data/cities/lower-ninth/sources.md"},
]
