"""Hilo, 23 May 1960: the tsunami from the Chile earthquake.

Minute 0 is the first sounding of the Hilo sirens, 20:35 on 22 May. Waves 1 and 2 flood the land joined to Hilo
Bay below their measured heights at the Wailuku River bridge. The third wave, the bore, runs inland from the bay
at the speed reported for it and floods to the 1960 runup heights Loomis (1976) compiled at points around the
bay. A runup height is the ground height where the water stopped, so the bathtub at the local runup height
reproduces the inundation limit; between the points the height is interpolated by inverse distance.
Provenance for every number is data/cities/hilo/sources.md.
"""

import numpy as np

from water_flood import FloodSetup, distance_meters, open_water
from water_inputs import city_data, minutes_between, warning_time
from water_terrain import Box, Terrain

ID = "hilo"
KIND = "tsunami"
BOX = Box(south=19.695, west=-155.115, north=19.745, east=-155.05)
CELL_METERS = 5.0
MIN_PART_CELLS = 60
# Each front is Hilo Bay plus the land the water has reached, so the shoreline itself is never left out.
FRONTS_INCLUDE_OPEN_WATER = True
FEET = 0.3048
BAY_POINTS = [(19.74, -155.075), (19.735, -155.08), (19.733, -155.06)]
BORE_STEP_MINUTES = [1, 2, 3]
RISE_FRACTIONS = [0.5, 0.75, 1.0]
EPICENTRE = {"lat": -38.143, "lng": -73.407}
# Hilo Bay opens to the north-east, so every wave enters it from that side. Read off the map, not a published direction.
BAY_MOUTH_FACES_DEGREES = 45


def inputs() -> tuple[dict, dict, dict]:
    return city_data(ID, "timeline.json"), city_data(ID, "series.json"), city_data(ID, "runup-loomis-1976.json")


def flood_setup(terrain: Terrain) -> FloodSetup:
    water = open_water(terrain, BAY_POINTS, still_level=0.05)
    return FloodSetup(terrain=terrain, source_water=water, domain=np.ones(terrain.shape, dtype=bool))


def runup_surface(terrain: Terrain, runup: dict, msl_above_mllw: float) -> np.ndarray:
    points = [p for p in runup["points"] if p["runup1960Ft"] > 0]
    lat = np.array([p["lat"] for p in points])
    lng = np.array([p["lng"] for p in points])
    height_m = np.array([p["runup1960Ft"] for p in points]) * FEET - msl_above_mllw
    rows, cols = np.indices(terrain.shape)
    box = terrain.box
    cell_lat = box.north - (rows + 0.5) / terrain.shape[0] * (box.north - box.south)
    cell_lng = box.west + (cols + 0.5) / terrain.shape[1] * (box.east - box.west)
    dy = (cell_lat[..., None] - lat) * 110_574.0
    dx = (cell_lng[..., None] - lng) * box.meters_per_deg_lng
    weight = 1.0 / np.maximum(dx * dx + dy * dy, 25.0)
    return (weight * height_m).sum(axis=-1) / weight.sum(axis=-1)


def wave_level_m(wave: dict, series: dict) -> float:
    """Eaton measured heights above the normal water of the moment, which was the tide."""
    return wave["heightFt"] * FEET + series["tide"]["tideAboveMslM"]


def bore_steps(terrain: Terrain, wave: dict, minute: float, surface: np.ndarray, setup: FloodSetup) -> list[dict]:
    from_bay = distance_meters(terrain, setup.source_water)
    steps = []
    for after in BORE_STEP_MINUTES:
        reach = wave["boreMetersPerMinute"] * after
        steps.append({
            "minute": round(minute + after), "level": surface, "gate": from_bay <= reach if after < BORE_STEP_MINUTES[-1] else None,
            "note": f"Bore {after} min after reaching the bridge: up to {reach:.0f} m inland, flooding to the 1960 runup line",
        })
    return steps


def front_steps(terrain: Terrain) -> list[dict]:
    timeline, series, runup = inputs()
    start = warning_time(timeline)
    setup = flood_setup(terrain)
    steps = []
    for wave in series["waves"]:
        minute = minutes_between(start, wave["arrivalLocal"])
        if wave.get("usesRunupSurface"):
            surface = runup_surface(terrain, runup, series["datum"]["mslAboveMllwM"])
            steps += bore_steps(terrain, wave, minute, surface, setup)
        else:
            steps += rising_limb_steps(start, wave, series)
    return steps


def rising_limb_steps(start: str, wave: dict, series: dict) -> list[dict]:
    begin = minutes_between(start, wave["riseFrom"]["local"])
    crest = minutes_between(start, wave["arrivalLocal"])
    steps = []
    for fraction in RISE_FRACTIONS:
        feet = wave["riseFrom"]["heightFt"] + (wave["heightFt"] - wave["riseFrom"]["heightFt"]) * fraction
        note = wave["note"] if fraction == 1.0 else f"{wave['label']} rising, about {feet:.0f} ft above normal at the bridge"
        steps.append({"minute": round(begin + (crest - begin) * fraction), "level": wave_level_m({**wave, "heightFt": feet}, series), "note": note})
    return steps


def wave_runup_m(wave: dict, series: dict) -> float:
    return round(wave["heightFt"] * FEET if wave.get("usesRunupSurface") else wave_level_m(wave, series), 2)


def scenario_parts(fronts: list[dict], terrain: Terrain) -> dict:
    timeline, series, _ = inputs()
    start = warning_time(timeline)
    waves = [
        {"arrivalMinutes": round(minutes_between(start, w["arrivalLocal"])), "runupMeters": wave_runup_m(w, series), "periodMinutes": w["periodMinutes"], "label": w["label"]}
        for w in series["waves"]
    ]
    return {
        "kind": KIND,
        "label": "Scenario input from the 1960 record, not a forecast",
        "basis": "Wave times and heights are Eaton, Richter and Ault's (1961) measurements at the Wailuku River bridge; the third "
        "wave's bore floods to Loomis's (1976) 1960 runup heights over today's USGS 3DEP ground. Minute 0 is the first siren, "
        "20:35 on 22 May 1960. Today's town is not 1960's: Waiakea and Shinmachi were never rebuilt.",
        "clock": {"warningAt": start, "minutesShown": fronts[-1]["minutesAfterWarning"] + 60},
        "series": {
            "source": {"name": "Mw 9.5 earthquake off south-central Chile, 19:11 UTC 22 May 1960", "at": EPICENTRE},
            "approachFromDegrees": BAY_MOUTH_FACES_DEGREES,
            "waves": waves,
        },
    }


SOURCES = [
    {"label": "Eaton, Richter & Ault (1961), The tsunami of May 23, 1960, on the island of Hawaii, BSSA 51(2):135-157", "url": "https://doi.org/10.1785/BSSA0510020135"},
    {"label": "Atwater et al., Surviving a Tsunami: Lessons from Chile, Hawaii, and Japan, USGS Circular 1187", "url": "https://pubs.usgs.gov/circ/c1187/"},
    {"label": "Johnston (2003), survivors' accounts and the 1960 Civil Defense, Police and Fire logs, University of Hawaii MA thesis", "url": "https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/8f4f80b7-7013-4310-a60e-020dfecacb65/content"},
    {"label": "Lander & Lockridge (1989), United States Tsunamis 1690-1988, NGDC Pub. 41-2", "url": "https://www.ngdc.noaa.gov/hazard/data/publications/pub41-2.pdf"},
    {"label": "Loomis (1976) tsunami runup heights, via Hawaii Statewide GIS Program", "url": "https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer/1"},
    {"label": "NOAA NCEI Global Historical Tsunami Database, event 1902", "url": "https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/tsunamis/runups/3922"},
    {"label": "Hawaii County tsunami evacuation zones (2025), via Hawaii Statewide GIS Program", "url": "https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer/2"},
    {"label": "USGS 3DEP 1/3 arc-second DEM", "url": "https://www.usgs.gov/3d-elevation-program"},
    {"label": "Every source and assumption: data/cities/hilo/sources.md"},
]
