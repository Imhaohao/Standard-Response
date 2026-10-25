"""Download the OpenStreetMap inputs the models use and save compact copies under data/osm.

  addresses.json    every address point (nodes and building centroids) in the study area
  buildings.json    residential building footprint centroids, for placing the synthetic population
  facilities.json   senior housing, nursing homes and assisted living, for clustering
  nonresidential.geojson  land that isn't homes (research campuses, schools, commercial and industrial land),
                    so an untagged building there (`building=yes`) isn't taken for a house
  drive.graphml     the drivable road graph (OSMnx, simplified), for travel times and closures

Run once: `uv run python scripts/fetch_osm.py` (or `--only nonresidential` for one file). The outputs are
committed so nobody needs the network.
"""

import argparse
import json
import sys
import time
from pathlib import Path

import osmnx as ox
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.area import BBOX, EAST, NORTH, SOUTH, WEST  # noqa: E402
from rollcall_d.paths import OSM  # noqa: E402

OVERPASS = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "rollcall-calhacks/0.1 (evacuation coordination research)", "Accept": "application/json"}
BOX = f"{SOUTH},{WEST},{NORTH},{EAST}"
RETRY_STATUSES = {429, 502, 503, 504}


def overpass(query: str, attempts: int = 4) -> list[dict]:
    """Run an Overpass query, retrying the gateway errors and rate limits the public server returns when busy."""
    for attempt in range(attempts):
        response = requests.post(OVERPASS, data={"data": f"[out:json][timeout:180];{query}"}, timeout=240, headers=HEADERS)
        if response.status_code not in RETRY_STATUSES or attempt == attempts - 1:
            response.raise_for_status()
            return response.json()["elements"]
        time.sleep(15 * (attempt + 1))
    raise AssertionError("unreachable")


def center(element: dict) -> tuple[float, float] | None:
    if "lat" in element:
        return element["lat"], element["lon"]
    if "center" in element:
        return element["center"]["lat"], element["center"]["lon"]
    return None


def fetch_addresses() -> list[dict]:
    elements = overpass(f'(node["addr:housenumber"]["addr:street"]({BOX});way["addr:housenumber"]["addr:street"]({BOX}););out center tags;')
    seen: set[tuple[str, str]] = set()
    rows = []
    for element in elements:
        point = center(element)
        tags = element.get("tags", {})
        key = (tags["addr:housenumber"], tags["addr:street"])
        if point is None or key in seen:
            continue
        seen.add(key)
        rows.append({
            "osmId": f"{element['type']}/{element['id']}",
            "housenumber": tags["addr:housenumber"],
            "street": tags["addr:street"],
            "city": tags.get("addr:city", ""),
            "postcode": tags.get("addr:postcode", ""),
            "lat": round(point[0], 6),
            "lng": round(point[1], 6),
            "building": tags.get("building", ""),
        })
    return sorted(rows, key=lambda r: (r["street"], r["housenumber"]))


RESIDENTIAL = {"house", "residential", "apartments", "detached", "semidetached_house", "bungalow", "yes", "terrace", "dormitory"}


def fetch_buildings() -> list[dict]:
    elements = overpass(f'way["building"]({BOX});out center tags;')
    rows = []
    for element in elements:
        point = center(element)
        tags = element.get("tags", {})
        if point is None or tags.get("building") not in RESIDENTIAL:
            continue
        levels = tags.get("building:levels", "1")
        rows.append({
            "lat": round(point[0], 6),
            "lng": round(point[1], 6),
            "kind": tags["building"],
            "levels": int(levels) if levels.isdigit() else 1,
        })
    return rows


def fetch_facilities() -> list[dict]:
    query = (
        f'(nwr["amenity"="nursing_home"]({BOX});nwr["social_facility"~"nursing_home|assisted_living|group_home"]({BOX});'
        f'nwr["social_facility:for"~"senior|disabled"]({BOX});nwr["healthcare"="nursing_home"]({BOX}););out center tags;'
    )
    rows = []
    for element in overpass(query):
        point = center(element)
        if point is None:
            continue
        tags = element.get("tags", {})
        rows.append({
            "osmId": f"{element['type']}/{element['id']}",
            "name": tags.get("name", "Unnamed facility"),
            "kind": tags.get("social_facility") or tags.get("amenity") or tags.get("healthcare", "facility"),
            "lat": round(point[0], 6),
            "lng": round(point[1], 6),
        })
    return rows


NONRESIDENTIAL_LANDUSE = "commercial|industrial|retail|military|institutional|education|religious|cemetery"
NONRESIDENTIAL_AMENITY = "research_institute|university|college|school|hospital|place_of_worship|prison"


def fetch_nonresidential() -> dict:
    """Closed outlines of land that isn't homes, as a GeoJSON FeatureCollection. A multipolygon's outer ways
    each become one polygon; its holes are left out, which only ever keeps a building out, never puts one in."""
    query = (f'(way["landuse"~"^({NONRESIDENTIAL_LANDUSE})$"]({BOX});way["amenity"~"^({NONRESIDENTIAL_AMENITY})$"]({BOX});'
             f'relation["landuse"~"^({NONRESIDENTIAL_LANDUSE})$"]({BOX});relation["amenity"~"^({NONRESIDENTIAL_AMENITY})$"]({BOX}););out geom tags;')
    features = []
    for element in overpass(query):
        tags = element.get("tags", {})
        ways = [element.get("geometry", [])] if element["type"] == "way" else [m.get("geometry", []) for m in element.get("members", []) if m.get("role") == "outer"]
        for points in ways:
            ring = [[round(p["lon"], 6), round(p["lat"], 6)] for p in points]
            if len(ring) < 4 or ring[0] != ring[-1]:
                continue  # an open way, or an outer ring split across ways
            features.append({"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
                             "properties": {"osmId": f"{element['type']}/{element['id']}", "name": tags.get("name", ""),
                                            "kind": tags.get("amenity") or tags.get("landuse", "")}})
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", choices=["addresses", "buildings", "facilities", "nonresidential", "graph"])
    only = parser.parse_args().only
    OSM.mkdir(parents=True, exist_ok=True)
    for name, fetch in [("addresses", fetch_addresses), ("buildings", fetch_buildings), ("facilities", fetch_facilities)]:
        if only not in (None, name):
            continue
        rows = fetch()
        (OSM / f"{name}.json").write_text(json.dumps(rows, separators=(",", ":")))
        print(f"{name}: {len(rows)}")
    if only in (None, "nonresidential"):
        land = fetch_nonresidential()
        (OSM / "nonresidential.geojson").write_text(json.dumps(land, separators=(",", ":")))
        print(f"nonresidential: {len(land['features'])} outlines")
    if only not in (None, "graph"):
        return
    graph = ox.graph_from_bbox(BBOX, network_type="drive", simplify=True)
    graph = ox.add_edge_speeds(graph)
    graph = ox.add_edge_travel_times(graph)
    ox.save_graphml(graph, OSM / "drive.graphml")
    print(f"drive graph: {graph.number_of_nodes()} nodes, {graph.number_of_edges()} edges")


if __name__ == "__main__":
    main()
