"""Fort Myers Beach, 28 September 2022: Hurricane Ian's storm surge over Estero Island.

Minute 0 is Lee County's mandatory evacuation order for Zone A, 07:00 on 27 September. The water level is the
wave-filtered record of the USGS storm-tide sensor on the Fort Myers Beach pier (FLLEE03382), applied across
the box: the surge high-water marks on the island sit within about a foot of the pier's peak. A cell floods
when that level is above its ground and it joins the Gulf or Estero Bay through lower cells. Provenance for
every number is data/cities/fort-myers-beach/sources.md.
"""

from shapely.geometry import box

from water_flood import FloodSetup, open_water, rasterize
from water_inputs import city_data, minutes_between, rising_steps, warning_time
from water_terrain import Box, Terrain

ID = "fort-myers-beach"
KIND = "surge"
BOX = Box(south=26.395, west=-81.995, north=26.49, east=-81.86)
CELL_METERS = 6.0
MIN_PART_CELLS = 150
OPEN_WATER_POINTS = [(26.42, -81.97), (26.44, -81.99), (26.45, -81.92), (26.457, -81.952), (26.41, -81.89)]
FRONT_LEVELS_M = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3]
DRY_READING_M = 0.45
# lib/cities.ts: the extent the map bakes for this city (detail grown by 0.015 degrees). Water beyond it isn't drawn.
MAP_EXTENT = {"minx": -81.991, "miny": 26.412, "maxx": -81.909, "maxy": 26.488}


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


def pier_points(gauges: dict, start: str) -> list[tuple[float, float]]:
    return [(minutes_between(start, s["local"]), s["meters"]) for s in sensor(gauges, "FLLEE03382")["samples"]]


def front_steps(terrain: Terrain) -> list[dict]:
    timeline, gauges = inputs()
    start = warning_time(timeline)
    sampled_peak = max(meters for _, meters in pier_points(gauges, start))
    levels = FRONT_LEVELS_M + [sampled_peak]
    return rising_steps(pier_points(gauges, start), levels, "Pier sensor reaches {level:.2f} m NAVD88")


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
        "basis": "The water level is the USGS storm-tide sensor on the Fort Myers Beach pier during Hurricane Ian (peak 13.23 ft "
        "NAVD88 at 14:39), spread over today's USGS 3DEP ground and joined to the Gulf and Estero Bay. Minute 0 is Lee County's "
        "07:00 Zone A order on 27 September. Wind is the NOAA Fort Myers gauge, 22 km inland.",
        "clock": {"warningAt": start, "minutesShown": fronts[-1]["minutesAfterWarning"] + 240},
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
    {"label": "USGS Short-Term Network, Hurricane Ian (event 325): storm-tide sensors FLLEE03382, FLLEE03284, FLLEE03288 and high-water marks", "url": "https://api.waterdata.usgs.gov/stnservices/sites/3382/peaksummaryview/"},
    {"label": "Lee County, Hurricane Ian After-Action Report (2023): evacuation order times", "url": "https://www.leegov.com/hurricane/Documents/AAR/Lee%20County%20Hurricane%20Ian%20AAR.pdf"},
    {"label": "NOAA CO-OPS Fort Myers 8725520: water level and wind", "url": "https://tidesandcurrents.noaa.gov/stationhome.html?id=8725520"},
    {"label": "USGS 3DEP 1/3 arc-second DEM", "url": "https://www.usgs.gov/3d-elevation-program"},
    {"label": "Every source and assumption: data/cities/fort-myers-beach/sources.md"},
]
