"""Write data/cities/<id>/population.json, the same synthetic population as data/population.json for another town.

The method is build_population.py's, unchanged: real ACS PUMS households from the city's PUMAs, reweighted by
IPF to each block group's household controls and each tract's count of people 65+ with a disability, drawn
whole, placed on residential buildings, and mapped to the evacuation record by rollcall_d.population.

What differs per city is where the inputs come from:
  - Census: the ACS 2019-2023 table-based summary files and state PUMS CSVs on www2.census.gov (the Census
    Data API now refuses requests without a key). Downloads are cached in modeling/cache/census.
  - Buildings: OpenStreetMap residential buildings inside the city's detail box, from Overpass.
  - Paradise: most of the town burned, so today's census and today's buildings describe a different town.
    Buildings come from CAL FIRE's Camp Fire damage inspections, which list every structure standing in the
    burn area on November 8, 2018. Each block group's households are its inspected housing units times the
    2010 census occupancy rate for the Town of Paradise. The household mix (age, living alone, no car,
    disability) still comes from today's ACS shares.

    uv run python scripts/cities/build_population.py --city hilo
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import random
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import shapely
from shapely.geometry import shape

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(SCRIPTS.parent))

import build_population as eaton_population  # noqa: E402
import fetch_census  # noqa: E402
import fetch_osm  # noqa: E402
from cities.registry import CITIES, city, city_dir, write_city_file  # noqa: E402
from rollcall_d.population import Record, evacuation_record, ipf, needs_help  # noqa: E402

SEED = eaton_population.SEED
CACHE = SCRIPTS.parent / "cache" / "cities"
TIGER = fetch_census.TIGER
PUMS = "https://www2.census.gov/programs-surveys/acs/data/pums/2023/5-Year/csv_{kind}{state}.zip"
BLOCK_GROUP_LAYER, PUMA_LAYER = 10, 0
FACILITY_KINDS = ("nursing_home", "assisted_living", "group_home")
METERS_PER_DEGREE = 111_320.0

DINS_LAYER = "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/POSTFIRE_MASTER_DATA_SHARE/FeatureServer/0"
DINS_RESIDENTIAL = ("Single Residence", "Multiple Residence", "Mixed Commercial/Residential")
MULTI_UNIT_DEFAULT = 2
# 2010 census, Town of Paradise: 11,893 occupied of 12,981 housing units (BCAG, 2020 census H3 housing table).
PARADISE_OCCUPANCY_2010 = 11_893 / 12_981
PARADISE_OCCUPANCY_SOURCE = "https://www.bcag.org/documents/demographics/2020_census/2020Census_H3_Housing_2020-2010_RedistrictingFile_BC.pdf"


def cache_dir(city_id: str) -> Path:
    """Downloads depend on the detail box, so each box gets its own cache folder."""
    box = city(city_id)["detail"]
    return CACHE / city_id / "_".join(f"{box[k]:.3f}" for k in ("south", "west", "north", "east"))


def envelope(box: dict) -> str:
    return (f"geometry={box['west']},{box['south']},{box['east']},{box['north']}&geometryType=esriGeometryEnvelope"
            "&inSR=4326&spatialRel=esriSpatialRelIntersects")


def tiger_geojson(layer: int, box: dict, fields: str) -> dict:
    url = f"{TIGER}/{layer}/query?{envelope(box)}&outFields={fields}&returnGeometry=true&outSR=4326&f=geojson"
    with urllib.request.urlopen(url, timeout=180) as response:
        return json.loads(response.read())


def pums_rows(kind: str, state: str, pumas: set[str], columns: list[str]):
    with zipfile.ZipFile(fetch_census.cached(PUMS.format(kind=kind, state=state))) as archive:
        name = next(n for n in archive.namelist() if n.endswith(".csv"))
        with archive.open(name) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8")):
                if row["PUMA"].zfill(5) in pumas:
                    yield {c: row[c] for c in columns}


def block_group_controls(features: list[dict]) -> None:
    bg_ids = {f"1500000US{f['properties']['GEOID']}": f for f in features}
    values: dict[str, dict] = {g: {} for g in bg_ids}
    for table in ("b11001", "b11007", "b25044"):
        for geo, row in fetch_census.summary_rows(table, set(bg_ids)).items():
            for key, column in fetch_census.BG_COLUMNS.items():
                if column in row:
                    values[geo][key] = fetch_census.number(row[column])
    for geo, feature in bg_ids.items():
        v = values[geo]
        feature["properties"].update({
            "households": v.get("households", 0), "hasMember65": v.get("hasMember65", 0), "alone65": v.get("alone65", 0),
            "noVehicle": v.get("noVehicleOwner", 0) + v.get("noVehicleRenter", 0), "tract": geo[9:20],
        })


def tract_controls(features: list[dict]) -> dict:
    tract_ids = {f"1400000US{f['properties']['GEOID'][:11]}" for f in features}
    tracts = {}
    for geo, row in fetch_census.summary_rows("b18101", tract_ids).items():
        tracts[geo[9:]] = {"disabled65": sum(fetch_census.number(row[c]) for c in fetch_census.TRACT_DISABLED_65),
                           "people65": sum(fetch_census.number(row[c]) for c in fetch_census.TRACT_ALL_65), "hasMember65": 0}
    with fetch_census.cached(fetch_census.SUMMARY.format(table="b11007")).open() as handle:
        for row in csv.DictReader(handle, delimiter="|"):
            geo = row["GEO_ID"]
            if geo.startswith("1500000US") and geo[9:20] in tracts:
                tracts[geo[9:20]]["hasMember65"] += fetch_census.number(row["B11007_E002"])
    return tracts


def pums_households(state: str, pumas: set[str]) -> list[dict]:
    households = {}
    for row in pums_rows("h", state, pumas, ["SERIALNO", "PUMA", "WGTP", "NP", "VEH", "HHL", "TYPEHUGQ"]):
        if row["TYPEHUGQ"] == "1" and fetch_census.number(row["NP"]) > 0:
            households[row["SERIALNO"]] = {"serial": row["SERIALNO"], "puma": row["PUMA"].zfill(5), "weight": fetch_census.number(row["WGTP"]),
                                           "people": fetch_census.number(row["NP"]), "vehicles": fetch_census.number(row["VEH"]),
                                           "spanish": row["HHL"] == "2", "persons": []}
    for row in pums_rows("p", state, pumas, ["SERIALNO", "PUMA", "SPORDER", "AGEP", "DIS", "DPHY", "DOUT", "DDRS", "DEAR"]):
        household = households.get(row["SERIALNO"])
        if household:
            household["persons"].append({"age": fetch_census.number(row["AGEP"]), "disability": row["DIS"] == "1", "ambulatory": row["DPHY"] == "1",
                                         "independentLiving": row["DOUT"] == "1", "selfCare": row["DDRS"] == "1", "hearing": row["DEAR"] == "1"})
    return [h for h in households.values() if h["persons"] and h["weight"] > 0]


def census_inputs(city_id: str) -> dict:
    """Block groups, tracts and PUMS households for the city, cached after the first run."""
    cache = cache_dir(city_id) / "census.json"
    if cache.exists():
        return json.loads(cache.read_text())
    entry = city(city_id)
    box, state = entry["detail"], entry["state"]
    features = [f for f in tiger_geojson(BLOCK_GROUP_LAYER, box, "GEOID")["features"] if f["properties"]["GEOID"].startswith(state["fips"])]
    pumas = {f["properties"]["GEOID"][2:] for f in tiger_geojson(PUMA_LAYER, box, "GEOID")["features"] if f["properties"]["GEOID"].startswith(state["fips"])}
    block_group_controls(features)
    inputs = {"blockgroups": features, "tracts": tract_controls(features), "pumas": sorted(pumas),
              "pums": pums_households(state["abbr"], pumas)}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(inputs, separators=(",", ":")))
    return inputs


OVERPASS_MIRRORS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
OVERPASS_TRIES = 6


def overpass(query: str) -> list[dict]:
    """fetch_osm.overpass, retried across two public mirrors; the main one refuses connections under load."""
    for attempt in range(OVERPASS_TRIES):
        fetch_osm.OVERPASS = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            return fetch_osm.overpass(query)
        except Exception as error:  # noqa: BLE001
            print(f"overpass attempt {attempt + 1} failed: {error}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("Overpass is unreachable")


def overpass_box(box: dict) -> str:
    return f"{box['south']},{box['west']},{box['north']},{box['east']}"


def osm_buildings(city_id: str, box: dict) -> list[dict]:
    cache = cache_dir(city_id) / "buildings.json"
    if cache.exists():
        return json.loads(cache.read_text())
    rows = []
    for element in overpass(f'way["building"]({overpass_box(box)});out center tags;'):
        point, tags = fetch_osm.center(element), element.get("tags", {})
        if point is None or tags.get("building") not in fetch_osm.RESIDENTIAL:
            continue
        levels = tags.get("building:levels", "1")
        rows.append({"lat": round(point[0], 6), "lng": round(point[1], 6), "kind": tags["building"],
                     "levels": int(levels) if levels.isdigit() else 1})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(rows, separators=(",", ":")))
    return rows


def osm_facilities(city_id: str, box: dict) -> list[dict]:
    cache = cache_dir(city_id) / "facilities.json"
    if cache.exists():
        return json.loads(cache.read_text())
    b = overpass_box(box)
    query = (f'(nwr["amenity"="nursing_home"]({b});nwr["social_facility"~"nursing_home|assisted_living|group_home"]({b});'
             f'nwr["social_facility:for"~"senior|disabled"]({b});nwr["healthcare"="nursing_home"]({b}););out center tags;')
    rows = []
    for element in overpass(query):
        point, tags = fetch_osm.center(element), element.get("tags", {})
        if point is not None:
            rows.append({"kind": tags.get("social_facility") or tags.get("amenity") or tags.get("healthcare", "facility"),
                         "lat": round(point[0], 6), "lng": round(point[1], 6)})
    cache.write_text(json.dumps(rows, separators=(",", ":")))
    return rows


def dins_units(record: dict) -> int:
    if record["STRUCTURECATEGORY"] == "Single Residence":
        return 1
    return max(int(record.get("NUMBEROFUNITPERSTRUCTURE") or 0), MULTI_UNIT_DEFAULT)


def dins_buildings(city_id: str, box: dict) -> list[dict]:
    """Every residential structure CAL FIRE inspected after the Camp Fire, standing or not, as a building."""
    cache = cache_dir(city_id) / "dins.json"
    if cache.exists():
        return json.loads(cache.read_text())
    categories = ",".join(f"'{c}'" for c in DINS_RESIDENTIAL)
    where = (f"INCIDENTNAME='Camp' AND STRUCTURECATEGORY IN ({categories}) AND LATITUDE>{box['south']} AND LATITUDE<{box['north']} "
             f"AND LONGITUDE>{box['west']} AND LONGITUDE<{box['east']}")
    rows, offset = [], 0
    while True:
        params = {"where": where, "outFields": "STRUCTURECATEGORY,NUMBEROFUNITPERSTRUCTURE,DAMAGE,LATITUDE,LONGITUDE",
                  "returnGeometry": "false", "resultOffset": offset, "resultRecordCount": 2000, "orderByFields": "OBJECTID", "f": "json"}
        with urllib.request.urlopen(f"{DINS_LAYER}/query?{urllib.parse.urlencode(params)}", timeout=180) as response:
            features = json.loads(response.read())["features"]
        for feature in features:
            a = feature["attributes"]
            units = dins_units(a)
            rows.append({"lat": round(a["LATITUDE"], 6), "lng": round(a["LONGITUDE"], 6), "units": units, "damage": a["DAMAGE"],
                         "kind": "apartments" if units > 1 else "house", "levels": max(1, units // eaton_population.APARTMENT_UNITS_PER_LEVEL)})
        if len(features) < 2000:
            break
        offset += 2000
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(rows, separators=(",", ":")))
    return rows


def in_box(geometry, box: dict) -> bool:
    p = geometry.representative_point()
    return box["south"] < p.y < box["north"] and box["west"] < p.x < box["east"]


def near_any(buildings: list[dict], facilities: list[dict], radius_m: float) -> list[bool]:
    if not facilities or not buildings:
        return [False] * len(buildings)
    lat = np.array([b["lat"] for b in buildings])
    lng = np.array([b["lng"] for b in buildings])
    scale = np.cos(np.radians(lat.mean()))
    near = np.zeros(len(buildings), dtype=bool)
    for f in facilities:
        meters = np.hypot((lat - f["lat"]) * METERS_PER_DEGREE, (lng - f["lng"]) * METERS_PER_DEGREE * scale)
        near |= meters < radius_m
    return near.tolist()


def rescale_to_housing(props: dict, units: float) -> None:
    """Keep the block group's shares from today's ACS but set its household count from pre-fire housing."""
    target = round(units * PARADISE_OCCUPANCY_2010)
    share = target / props["households"] if props["households"] else 0.0
    for key in ("hasMember65", "alone65", "noVehicle"):
        props[key] = round(props[key] * share)
    props["acsHouseholds"] = props["households"]
    props["households"] = target


# Census 2000 for the two City Planning neighborhoods that make up the Lower Ninth Ward, from the Greater New
# Orleans Community Data Center's pre-Katrina tables (SF1 households, SF3 vehicles available).
NINTH_WARD_2000 = {
    "LOWER NINTH WARD": {"households": 4_820, "noVehicleShare": 0.324, "source": "https://www.datacenterresearch.org/pre-katrina/orleans/8/22/people.html"},
    "HOLY CROSS": {"households": 1_982, "noVehicleShare": 0.361, "source": "https://www.datacenterresearch.org/pre-katrina/orleans/8/20/people.html"},
}


def ninth_ward_neighborhoods() -> dict:
    raw = json.loads((city_dir("lower-ninth") / "neighborhoods.geojson").read_text())
    return {f["properties"]["name"]: shape(f["geometry"]) for f in raw["features"]}


def rescale_to_2000(props: dict, geometry, neighborhoods: dict) -> object | None:
    """Set a block group's households and carless households from Census 2000, shared out by land area within each
    neighborhood (the 2000 ward was a near-uniform grid of houses). Ages keep today's shares. Returns the part of
    the block group inside the ward, where empty lots get the households today's buildings can't hold."""
    households, carless, inside = 0.0, 0.0, None
    for name, area in neighborhoods.items():
        overlap = geometry.intersection(area)
        if overlap.is_empty:
            continue
        share = overlap.area / area.area
        households += NINTH_WARD_2000[name]["households"] * share
        carless += NINTH_WARD_2000[name]["households"] * NINTH_WARD_2000[name]["noVehicleShare"] * share
        inside = overlap if inside is None else inside.union(overlap)
    if households < 1:
        return None
    factor = households / props["households"] if props["households"] else 0.0
    props["acsHouseholds"] = props["households"]
    props["households"] = round(households)
    props["hasMember65"] = min(round(props["hasMember65"] * factor), props["households"])
    props["alone65"] = min(round(props["alone65"] * factor), props["hasMember65"])
    props["noVehicle"] = round(carless)
    return inside


def selected_block_groups(city_id: str, census: dict, buildings: list[dict]) -> list[tuple[dict, object, list[int]]]:
    box = city(city_id)["detail"]
    neighborhoods = ninth_ward_neighborhoods() if city_id == "lower-ninth" else {}
    xs = np.array([b["lng"] for b in buildings])
    ys = np.array([b["lat"] for b in buildings])
    chosen = []
    for feature in census["blockgroups"]:
        geometry = shape(feature["geometry"])
        props = feature["properties"]
        inside = np.flatnonzero(shapely.contains_xy(geometry, xs, ys)).tolist() if len(buildings) else []
        if city_id == "paradise":
            units = sum(buildings[i]["units"] for i in inside)
            if units == 0:
                continue
            rescale_to_housing(props, units)
        elif city_id == "lower-ninth":
            geometry = rescale_to_2000(props, geometry, neighborhoods)
            if geometry is None:
                continue
            inside = np.flatnonzero(shapely.contains_xy(geometry, xs, ys)).tolist()
        elif props["households"] <= 0 or not in_box(geometry, box):
            continue
        chosen.append((props, geometry, inside))
    return chosen


def scale_tracts(tracts: dict, selected: list) -> dict:
    """Paradise's tracts lost most of their people; scale each tract's disability count with its households."""
    scaled = {k: dict(v) for k, v in tracts.items()}
    for tract_id, tract in scaled.items():
        rows = [p for p, _, _ in selected if p["tract"] == tract_id]
        before = sum(p.get("acsHouseholds", p["households"]) for p in rows)
        after = sum(p["households"] for p in rows)
        if before > 0:
            factor = after / before
            tract["disabled65"] = round(tract["disabled65"] * factor)
            tract["people65"] = round(tract["people65"] * factor)
            tract["hasMember65"] = round(tract["hasMember65"] * factor)
    return scaled


def place_household(rng, buildings, inside, near_facility, vulnerable, geometry, households: int) -> tuple[float, float]:
    """On a building while there are enough of them; past that, on an empty lot in the block group, which is where
    the Lower Ninth's 2000 houses stood before the ward was cleared."""
    capacity = sum(eaton_population.building_capacity(buildings[i]) for i in inside)
    if households > capacity and inside and rng.random() >= capacity / households:
        return eaton_population.place(rng, buildings, [], near_facility, vulnerable, geometry)
    return eaton_population.place(rng, buildings, inside, near_facility, vulnerable, geometry)


def draw_population(selected, records, weights, evac, buildings, near_facility, spill: bool) -> list[dict]:
    rng = random.Random(SEED)
    population = []
    for g, (props, geometry, inside) in enumerate(selected):
        if weights[g].sum() <= 0:
            continue
        drawn = rng.choices(range(len(records)), weights=weights[g].tolist(), k=props["households"])
        for h in drawn:
            vulnerable = any(p["age"] >= 75 and p["disability"] for p in records[h].persons)
            if spill:
                lat, lng = place_household(rng, buildings, inside, near_facility, vulnerable, geometry, len(drawn))
            else:
                lat, lng = eaton_population.place(rng, buildings, inside, near_facility, vulnerable, geometry)
            population.append({"id": f"H-{len(population) + 1:05d}", "lat": lat, "lng": lng, **evac[h],
                               "blockGroup": props["GEOID"], "pumsSerial": records[h].serial})
    return population


def city_buildings(city_id: str) -> tuple[list[dict], str]:
    box = city(city_id)["detail"]
    if city_id == "paradise":
        return dins_buildings(city_id, box), f"CAL FIRE damage inspections for the Camp Fire (every residential structure, any damage class), {DINS_LAYER}"
    return osm_buildings(city_id, box), "OpenStreetMap residential buildings in the detail box, retrieved via Overpass"


def build(city_id: str) -> dict:
    entry = city(city_id)
    census = census_inputs(city_id)
    buildings, building_source = city_buildings(city_id)
    selected = selected_block_groups(city_id, census, buildings)
    tracts = scale_tracts(census["tracts"], selected) if city_id in ("paradise", "lower-ninth") else census["tracts"]
    records = [Record(r["serial"], r["weight"], r["people"], r["vehicles"], r["spanish"], r["persons"]) for r in census["pums"]]
    weights, fit = ipf(records, [p for p, _, _ in selected], tracts)
    evac = [evacuation_record(r, random.Random(f"{SEED}-{r.serial}")) for r in records]
    facilities = [f for f in osm_facilities(city_id, entry["detail"]) if f["kind"] in FACILITY_KINDS]
    near_facility = near_any(buildings, facilities, eaton_population.FACILITY_RADIUS_METERS)
    population = draw_population(selected, records, weights, evac, buildings, near_facility, spill=city_id == "lower-ninth")
    out = city_dir(city_id)
    (out / "population.json").write_text(json.dumps(population, separators=(",", ":")))
    meta = population_meta(city_id, entry, census, selected, population, fit, building_source, len(buildings))
    (out / "population-meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    write_city_file(city_id)
    return meta


def era_note(city_id: str) -> str:
    notes = {
        "paradise": ("Housing is the town as it stood on November 8, 2018 (CAL FIRE inspected every structure in the burn area). "
                     f"Households = inspected housing units x {PARADISE_OCCUPANCY_2010:.3f}, the 2010 occupancy rate for the Town of Paradise "
                     f"({PARADISE_OCCUPANCY_SOURCE}). Ages, living alone, cars and disability follow today's ACS shares for the same block groups, "
                     "which describe the people who returned, not the 2018 town."),
        "lower-ninth": ("Households are the ward as Census 2000 counted it: 4,820 in the Lower Ninth Ward neighborhood and 1,982 in Holy Cross, "
                        "32.4% and 36.1% of them without a car (GNO Community Data Center pre-Katrina tables), shared among today's block groups "
                        "by land area. Ages and disability follow today's ACS shares and PUMS records. Where today's buildings are fewer than the "
                        "2000 households, the rest are placed on empty lots in the same block group."),
        "hilo": ("Today's census describes today's Hilo. The 1960 inundation zone downtown and at Waiakea was cleared after the tsunami and is "
                 "now largely parks, so today's households there are far fewer than in 1960."),
    }
    return notes.get(city_id, "ACS 2019-2023 describes the town within a few years of the event.")


def population_meta(city_id, entry, census, selected, population, fit, building_source, building_count) -> dict:
    return {
        "label": "Synthetic population for simulation. Real ACS PUMS household records reweighted to real block-group and tract totals; not real people.",
        "city": city_id, "name": entry["name"], "event": entry["event"],
        "source": (f"ACS 2019-2023 5-year: PUMS ({entry['state']['abbr'].upper()} PUMAs {', '.join(census['pumas'])}), B11001, B11007, B25044 by block group, "
                   f"B18101 by tract, from www2.census.gov bulk files. Buildings: {building_source}. Care facilities: OpenStreetMap."),
        "era": era_note(city_id),
        "blockGroups": len(selected), "buildings": building_count, "households": len(population),
        "needHelp": sum(needs_help(p) for p in population),
        "ipfWorstRelativeError": fit, "seed": SEED,
        "assumptions": "ACS has no wheelchair, bed or oxygen variables; see modeling/rollcall_d/population.py for the mapping and its rates.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True, choices=list(CITIES))
    meta = build(parser.parse_args().city)
    print(json.dumps({k: meta[k] for k in ("city", "blockGroups", "buildings", "households", "needHelp", "ipfWorstRelativeError")}, indent=1))


if __name__ == "__main__":
    main()
