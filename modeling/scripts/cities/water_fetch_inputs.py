# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "h5py>=3.10", "requests>=2.31", "shapely>=2.0"]
# ///
"""Download the measured inputs for the three water scenarios and save the small, sourced pieces under
data/cities/<id>/. Run once per city; build_water_scenario.py then works offline.

    uv run modeling/scripts/cities/water_fetch_inputs.py --city fort-myers-beach

fort-myers-beach: the USGS storm-tide sensor records for Hurricane Ian (STN event 325) on Estero Island and the
    NOAA CO-OPS Fort Myers gauge's wind, written to gauges.json.
hilo: the State of Hawaii tsunami evacuation zones and Loomis's 1960 runup heights around Hilo Bay.
lower-ninth: the City of New Orleans neighbourhood outlines of the Lower Ninth Ward and Holy Cross, and St. Bernard Parish
    south of the Forty Arpent Canal from OpenStreetMap.
"""

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import h5py
import numpy as np
import requests
from shapely.geometry import LineString, Polygon, box, mapping, shape
from shapely.ops import polygonize, unary_union

REPO = Path(__file__).resolve().parents[3]
CACHE = REPO / "modeling" / "cache" / "cities"
STN = "https://api.waterdata.usgs.gov/stnservices"
COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
HAWAII_HAZARDS = "https://geodata.hawaii.gov/arcgis/rest/services/Hazards/MapServer"
OVERPASS = "https://overpass-api.de/api/interpreter"
ST_BERNARD_PARISH_RELATION = 1836430
FORTY_ARPENT_CANAL_WAY = 977577408
# lib/cities.ts: lower-ninth's extent (detail grown by 0.015 degrees), as west, south, east, north.
LOWER_NINTH_MAP_EXTENT = (-90.052, 29.933, -89.966, 29.999)
NOLA_NEIGHBOURHOODS = "https://maps.nola.gov/server/rest/services/Reference/Reference_Layers/MapServer/0/query"
EDT = timezone(timedelta(hours=-4))

# file_id is the processed, wave-filtered storm-tide record USGS published for each site.
IAN_SENSORS = [
    {"site": "FLLEE03382", "name": "Fort Myers Beach pier", "fileId": 130763},
    {"site": "FLLEE03284", "name": "Matanzas Pass (San Carlos Island side)", "fileId": 130798},
    {"site": "FLLEE03288", "name": "Big Carlos Pass bridge", "fileId": 130439},
]
SAMPLE_MINUTES = 10


def city_dir(city_id: str) -> Path:
    path = REPO / "data" / "cities" / city_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def cached_download(url: str, path: Path, **params) -> Path:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        response = requests.get(url, params=params, timeout=120)
        response.raise_for_status()
        path.write_bytes(response.content)
    return path


def stn_file(file_id: int) -> Path:
    path = CACHE / "fort-myers-beach" / f"stn-{file_id}.nc"
    if path.exists():
        return path
    signed = requests.get(f"{STN}/files/{file_id}/presigned-url/", timeout=60).json()["url"]
    return cached_download(signed, path)


def sensor_series(sensor: dict) -> dict:
    with h5py.File(stn_file(sensor["fileId"]), "r") as record:
        millis = record["time"][:]
        level = record["water_surface_height_above_reference_datum"][:]
        lat, lng = float(record["latitude"][()]), float(record["longitude"][()])
    step = int(SAMPLE_MINUTES * 60 / 30)
    samples = [
        {"local": datetime.fromtimestamp(m / 1000, tz=EDT).isoformat(timespec="minutes"), "meters": round(float(z), 3)}
        for m, z in zip(millis[::step], level[::step])
    ]
    peak = int(np.argmax(level))
    return {
        **sensor,
        "lat": round(lat, 6),
        "lng": round(lng, 6),
        "peak": {"local": datetime.fromtimestamp(millis[peak] / 1000, tz=EDT).isoformat(timespec="minutes"), "meters": round(float(level[peak]), 3)},
        "samples": samples,
    }


def coops_wind(station: str) -> list[dict]:
    path = cached_download(
        COOPS,
        CACHE / "fort-myers-beach" / f"{station}-wind.json",
        begin_date="20220927 00:00", end_date="20220929 23:59", station=station, product="wind",
        units="metric", time_zone="lst_ldt", format="json", application="standard_response",
    )
    rows = json.loads(path.read_text())["data"]
    hourly = [row for row in rows if row["t"].endswith(":00") and row["s"] != ""]
    return [
        {"local": datetime.fromisoformat(row["t"]).replace(tzinfo=EDT).isoformat(timespec="minutes"),
         "fromDegrees": float(row["d"]), "metersPerSecond": float(row["s"]), "gustMetersPerSecond": float(row["g"])}
        for row in hourly
    ]


def fort_myers_beach() -> None:
    out = {
        "datum": "NAVD88",
        "timezone": "America/New_York",
        "note": f"Wave-filtered storm tide (USGS 6-minute Butterworth low-pass), sampled every {SAMPLE_MINUTES} minutes. "
        "Values at the sensor orifice height mean the sensor was dry, not that the water was there.",
        "sensors": [sensor_series(sensor) for sensor in IAN_SENSORS],
        "wind": {"station": "NOAA CO-OPS 8725520 Fort Myers", "lat": 26.6478, "lng": -81.8711, "samples": coops_wind("8725520")},
    }
    path = city_dir("fort-myers-beach") / "gauges.json"
    path.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {path}")


def clipped_features(layer: int, clip, label: str) -> list[dict]:
    response = requests.get(
        f"{HAWAII_HAZARDS}/{layer}/query",
        params={"where": "island='HAWAII'", "geometry": ",".join(map(str, clip.bounds)), "geometryType": "esriGeometryEnvelope",
                "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson"},
        timeout=180,
    )
    response.raise_for_status()
    features = []
    for feature in response.json()["features"]:
        geometry = shape(feature["geometry"]).intersection(clip).simplify(0.00002, preserve_topology=True)
        features.append({"type": "Feature", "properties": {"zone": label}, "geometry": mapping(geometry)})
    return features


def hilo() -> None:
    clip = box(-155.11, 19.695, -155.05, 19.745)
    zones = clipped_features(2, clip, "Tsunami Evacuation Zone") + clipped_features(12, clip, "Extreme Tsunami Evacuation Zone")
    (city_dir("hilo") / "evacuation-zones.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": zones}))
    response = requests.get(
        f"{HAWAII_HAZARDS}/1/query",
        params={"geometry": ",".join(map(str, clip.bounds)), "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson"},
        timeout=120,
    )
    points = [
        {"number": f["properties"]["number"], "name": f["properties"]["name"], "lng": round(f["geometry"]["coordinates"][0], 5),
         "lat": round(f["geometry"]["coordinates"][1], 5), "runup1960Ft": f["properties"]["wave1960_f"], "runup1946Ft": f["properties"]["wave1946_f"]}
        for f in response.json()["features"]
    ]
    runup = {"source": f"Hawaii Statewide GIS Program, {HAWAII_HAZARDS}/1 (Loomis 1976)", "note": "0 means no reading, not zero runup.", "points": points}
    (city_dir("hilo") / "runup-loomis-1976.json").write_text(json.dumps(runup, indent=1))
    print("wrote hilo inputs")


def lower_ninth() -> None:
    response = requests.get(
        NOLA_NEIGHBOURHOODS,
        params={"where": "GNOCDC_LAB IN ('LOWER NINTH WARD','HOLY CROSS')", "outFields": "GNOCDC_LAB", "outSR": 4326, "f": "geojson"},
        timeout=120,
    )
    response.raise_for_status()
    features = [{"type": "Feature", "properties": {"name": f["properties"]["GNOCDC_LAB"]}, "geometry": f["geometry"]} for f in response.json()["features"]]
    (city_dir("lower-ninth") / "neighborhoods.geojson").write_text(json.dumps({"type": "FeatureCollection", "source": NOLA_NEIGHBOURHOODS, "features": features}))
    st_bernard_polder()
    print("wrote lower-ninth inputs")


def st_bernard_polder() -> None:
    """St. Bernard Parish south of the Forty Arpent Canal (the polder's back levee), inside the map extent."""
    query = f"[out:json][timeout:90];(way({FORTY_ARPENT_CANAL_WAY});relation({ST_BERNARD_PARISH_RELATION}););out geom;"
    elements = requests.post(OVERPASS, data={"data": query}, headers={"User-Agent": "standard-response-calhacks/0.1"}, timeout=180).json()["elements"]
    canal = next(e for e in elements if e["type"] == "way")
    points = [(p["lon"], p["lat"]) for p in canal["geometry"]]
    relation = next(e for e in elements if e["type"] == "relation")
    outer = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]]) for m in relation["members"] if m["type"] == "way" and m.get("role") == "outer"]
    parish = unary_union(list(polygonize(unary_union(outer))))
    south_of_canal = Polygon([(-90.03, points[0][1]), *points, (-89.95, points[-1][1] - 0.0035), (-89.95, 29.90), (-90.03, 29.90)])
    polder = parish.intersection(south_of_canal).intersection(box(*LOWER_NINTH_MAP_EXTENT)).buffer(0).simplify(0.00002)
    feature = {"type": "Feature", "properties": {"name": "St. Bernard (Arabi), south of the 40 Arpent Canal"}, "geometry": mapping(polder)}
    collection = {"type": "FeatureCollection", "source": "OpenStreetMap relation 1836430 and way 977577408 (ODbL), clipped to lib/cities.ts extent", "features": [feature]}
    (city_dir("lower-ninth") / "st-bernard-polder.geojson").write_text(json.dumps(collection))


FETCHERS = {"fort-myers-beach": fort_myers_beach, "hilo": hilo, "lower-ninth": lower_ninth}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True, choices=sorted(FETCHERS))
    FETCHERS[parser.parse_args().city]()
