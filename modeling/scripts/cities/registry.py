"""The five replay cities: where each one's households are drawn from, which census files cover it, and where
the vans stage and riders are taken. `write_city_file` saves data/cities/<id>/city.json, which the road builder
and the dispatch simulator read, so this module is the one place these numbers live on the Python side.

`detail` is read from lib/cities.ts, the box the map bakes and frames, so the households simulated are the ones the
map can show. The road box is the detail box grown to take in the staging
point and the shelter, plus a margin, so every van leg stays on the graph.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CITIES_DIR = REPO / "data" / "cities"
ROAD_MARGIN_DEG = 0.01

CITIES: dict[str, dict] = {
    "paradise": {
        "name": "Paradise, California",
        "event": "Camp Fire, November 8, 2018",
        "hazard": "wildfire",
        "detail": {"south": 39.72, "north": 39.82, "west": -121.67, "east": -121.55},
        "state": {"fips": "06", "abbr": "ca"},
        "timezone": "America/Los_Angeles",
        "censusYear": "pre-fire housing from CAL FIRE's Camp Fire damage inspections; household mix from ACS 2019-2023",
    },
    "lower-ninth": {
        "name": "Lower Ninth Ward, New Orleans",
        "event": "Hurricane Katrina levee breach, August 29, 2005",
        "hazard": "flood",
        "detail": {"south": 29.952, "north": 29.978, "west": -90.027, "east": -89.997},
        "state": {"fips": "22", "abbr": "la"},
        "timezone": "America/Chicago",
        "censusYear": "ACS 2019-2023 (today's ward, not 2005's)",
    },
    "fort-myers-beach": {
        "name": "Fort Myers Beach, Florida",
        "event": "Hurricane Ian storm surge, September 28, 2022",
        "hazard": "surge",
        "detail": {"south": 26.400, "north": 26.466, "west": -81.968, "east": -81.880},
        "state": {"fips": "12", "abbr": "fl"},
        "timezone": "America/New_York",
        "censusYear": "ACS 2019-2023",
    },
    "buffalo": {
        "name": "East Side, Buffalo, New York",
        "event": "Blizzard, December 23 to 25, 2022",
        "hazard": "blizzard",
        "detail": {"south": 42.880, "north": 42.925, "west": -78.860, "east": -78.810},
        "state": {"fips": "36", "abbr": "ny"},
        "timezone": "America/New_York",
        "censusYear": "ACS 2019-2023",
    },
    "hilo": {
        "name": "Hilo, Hawaii",
        "event": "Chile tsunami, May 23, 1960",
        "hazard": "tsunami",
        "detail": {"south": 19.700, "north": 19.735, "west": -155.100, "east": -155.050},
        "state": {"fips": "15", "abbr": "hi"},
        "timezone": "Pacific/Honolulu",
        "censusYear": "ACS 2019-2023 (today's town, not 1960's)",
    },
}

# Coordinates from OpenStreetMap Nominatim or the Census geocoder. "record" says whether a source ties the place
# to the event itself or whether it is a plausible permanent facility.
STAGING: dict[str, dict] = {
    "paradise": {"name": "Silver Dollar Fairgrounds, Chico", "lat": 39.7177, "lng": -121.8117, "record": "event shelter; staging role assumed",
                 "source": "https://www.capradio.org/articles/2018/11/20/some-camp-wildfire-evacuees-plan-to-stay-outside-even-if-it-rains/"},
    "lower-ninth": {"name": "RTA A. Philip Randolph bus facility, Canal Street", "lat": 29.9668, "lng": -90.0889, "record": "the city's main bus yard; RTA ran pickups to the Superdome on August 28",
                    "source": "https://en.wikipedia.org/wiki/New_Orleans_Regional_Transit_Authority"},
    "fort-myers-beach": {"name": "LeeTran headquarters, Metro Parkway, Fort Myers", "lat": 26.6176, "lng": -81.8597, "record": "LeeTran carried barrier-island evacuees to shelters; depot as staging assumed",
                         "source": "https://www.fox4now.com/news/local-news/lee-county/leetran-full-bus-service-returns-on-sunday"},
    "buffalo": {"name": "NFTA Metro Cold Spring garage, Michigan Avenue", "lat": 42.9159, "lng": -78.8622, "record": "permanent bus garage; no blizzard-specific record",
                "source": "https://www.cptdb.ca/wiki/index.php/Niagara_Frontier_Transportation_Authority_Cold_Spring_Division"},
    "hilo": {"name": "Hawaii County Civil Defense, Ululani Street", "lat": 19.7158, "lng": -155.0848, "record": "today's civil defense office; civil defense ran the 1960 response",
             "source": "https://dod.hawaii.gov/blog/1960-hilo-tsunami-response/"},
}
SHELTERS: dict[str, dict] = {
    "paradise": {"name": "Neighborhood Church, Chico", "lat": 39.7085, "lng": -121.7932, "capacity": 1200, "record": "named Camp Fire evacuation center",
                 "source": "https://www.mynspr.org/news/2018-11-10/evacuation-shelter-and-information-resources-for-the-camp-wildfire"},
    "lower-ninth": {"name": "Louisiana Superdome", "lat": 29.9515, "lng": -90.0785, "capacity": 30000, "record": "the city's shelter of last resort",
                    "source": "https://www.webharvest.gov/congress109th/20061114010640/http:/www.house.gov/transportation/highway/10-27-05/deville.pdf"},
    "fort-myers-beach": {"name": "Hertz Arena, Estero", "lat": 26.4405, "lng": -81.7788, "capacity": 3000, "record": "open Lee County shelter during Ian",
                         "source": "https://estero-fl.gov/sheltering-operations-hurricane-ian-update-from-lee-county/"},
    "buffalo": {"name": "Delavan-Grider Community Center", "lat": 42.9225, "lng": -78.8242, "capacity": 1200, "record": "on the city's warming-shelter list for the storm",
                "source": "https://btpm.org/2022-12-26/where-code-blue-and-emergency-warming-shelters-are-operating"},
    "hilo": {"name": "Hilo High School, Waianuenue Avenue", "lat": 19.7218, "lng": -155.0963, "capacity": 1200, "record": "high-ground school; no 1960 record names it",
             "source": "none for 1960; a plausible high-ground facility"},
}


CITIES_TS = REPO / "lib" / "cities.ts"
DETAIL_PATTERN = r'id: "{id}".*?detail: \{{ south: ([-\d.]+), north: ([-\d.]+), west: ([-\d.]+), east: ([-\d.]+) \}}'


PAD_PATTERN = r'id: "{id}".*?pad: \{{ extent: ([-\d.]+),'
# Cities whose households fill the whole baked extent, not just the detail box the camera keeps to, so the red on
# the map doesn't stop at a hard rectangle inside the picture.
POPULATION_ON_EXTENT = {"buffalo"}


def detail_from_cities_ts(city_id: str) -> dict | None:
    text = CITIES_TS.read_text()
    match = re.search(DETAIL_PATTERN.format(id=re.escape(city_id)), text, re.S)
    if not match:
        return None
    south, north, west, east = (float(value) for value in match.groups())
    pad = re.search(PAD_PATTERN.format(id=re.escape(city_id)), text, re.S) if city_id in POPULATION_ON_EXTENT else None
    grow = float(pad.group(1)) if pad else 0.0
    return {"south": round(south - grow, 4), "north": round(north + grow, 4), "west": round(west - grow, 4), "east": round(east + grow, 4)}


def city(city_id: str) -> dict:
    if city_id not in CITIES:
        raise SystemExit(f"unknown city {city_id!r}; one of {', '.join(CITIES)}")
    entry = dict(CITIES[city_id])
    entry["detail"] = detail_from_cities_ts(city_id) or entry["detail"]
    return entry


def city_dir(city_id: str) -> Path:
    path = CITIES_DIR / city_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def road_box(city_id: str) -> dict:
    box = dict(city(city_id)["detail"])
    for point in (STAGING.get(city_id), SHELTERS.get(city_id)):
        if point:
            box = {"south": min(box["south"], point["lat"]), "north": max(box["north"], point["lat"]),
                   "west": min(box["west"], point["lng"]), "east": max(box["east"], point["lng"])}
    return {"south": box["south"] - ROAD_MARGIN_DEG, "north": box["north"] + ROAD_MARGIN_DEG,
            "west": box["west"] - ROAD_MARGIN_DEG, "east": box["east"] + ROAD_MARGIN_DEG}


def write_city_file(city_id: str) -> Path:
    entry = city(city_id)
    payload = {"id": city_id, **entry, "roadBox": road_box(city_id),
               "staging": STAGING.get(city_id), "shelter": SHELTERS.get(city_id)}
    path = city_dir(city_id) / "city.json"
    path.write_text(json.dumps(payload, indent=1) + "\n")
    return path
