"""Write data/cities/<id>/roads.json, the same drive graph dispatch/build_graph.py writes for Altadena.

Every drivable street inside the city's detail box (plus a margin), every street near the staging point and
the shelter, and the arterials (motorway to tertiary) across the box that joins them. Laying the arterials over
a wide box keeps the graph small when the shelter is 20 km away, as it is for Paradise and Fort Myers Beach.
Each edge also carries its OSM highway class, which the blizzard run uses to decide when a street drifts shut.

    uv run python scripts/cities/build_roads.py --city paradise
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from datetime import date
from pathlib import Path

import networkx as nx
import osmnx as ox

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))
from cities.registry import CITIES, SHELTERS, STAGING, city, city_dir, road_box, write_city_file  # noqa: E402

_spec = importlib.util.spec_from_file_location("build_graph", SCRIPTS.parents[1] / "dispatch" / "build_graph.py")
build_graph = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_graph)

DETAIL_MARGIN_DEG = 0.004
SITE_RADIUS_DEG = 0.006
ARTERIALS = '["highway"~"motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link"]'


MIRRORS = ["https://overpass-api.de/api", "https://lz4.overpass-api.de/api", "https://z.overpass-api.de/api", "https://maps.mail.ru/osm/tools/overpass/api"]


ox.settings.overpass_rate_limit = False
ox.settings.requests_timeout = 400
ox.settings.log_console = True


def fetch_graph(bbox, **options):
    for attempt in range(12):
        ox.settings.overpass_url = MIRRORS[attempt % len(MIRRORS)]
        try:
            return ox.graph_from_bbox(bbox, simplify=True, **options)
        except Exception as error:  # noqa: BLE001
            print(f"overpass attempt {attempt + 1} failed: {error}", flush=True)
            time.sleep(5 * (attempt + 1))
    raise SystemExit("Overpass is unreachable")


def bbox_of(box: dict, margin: float = 0.0) -> tuple[float, float, float, float]:
    return (box["west"] - margin, box["south"] - margin, box["east"] + margin, box["north"] + margin)


def around(point: dict) -> dict:
    return {"south": point["lat"], "north": point["lat"], "west": point["lng"], "east": point["lng"]}


def drive_graph(city_id: str):
    detail = city(city_id)["detail"]
    parts = [fetch_graph(bbox_of(detail, DETAIL_MARGIN_DEG), network_type="drive")]
    for point in (STAGING[city_id], SHELTERS[city_id]):
        parts.append(fetch_graph(bbox_of(around(point), SITE_RADIUS_DEG), network_type="drive"))
    parts.append(fetch_graph(bbox_of(road_box(city_id)), custom_filter=ARTERIALS))
    graph = nx.compose_all(parts)
    graph = ox.truncate.largest_component(graph, strongly=True)
    graph = ox.add_edge_speeds(graph)
    return ox.add_edge_travel_times(graph)


def highway_of(data) -> str:
    return str(build_graph.first(data.get("highway")) or "unclassified")


def edge_rows(graph, index: dict) -> list[dict]:
    rows = []
    for u, v, key, data in graph.edges(keys=True, data=True):
        rows.append({
            "u": index[u], "v": index[v], "key": f"{u}-{v}-{key}",
            "meters": round(float(data["length"]), 1), "seconds": round(float(data["travel_time"]), 1),
            "kph": round(float(data["speed_kph"]), 1), "lanes": build_graph.lanes_of(data),
            "name": build_graph.name_of(data), "highway": highway_of(data), "geometry": build_graph.geometry_of(data),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True, choices=list(CITIES))
    city_id = parser.parse_args().city
    graph = drive_graph(city_id)
    osm_ids = list(graph.nodes)
    index = {osm_id: i for i, osm_id in enumerate(osm_ids)}
    digits = build_graph.COORD_DIGITS
    nodes = [[round(graph.nodes[n]["y"], digits), round(graph.nodes[n]["x"], digits)] for n in osm_ids]
    edges = edge_rows(graph, index)
    payload = {
        "source": f"OpenStreetMap contributors via OSMnx {ox.__version__}: drive network in the detail box and around the staging point and shelter, arterials between them; retrieved {date.today()}",
        "bbox": road_box(city_id), "staging": STAGING[city_id], "shelter": SHELTERS[city_id],
        "nodes": nodes, "osmIds": [str(n) for n in osm_ids], "edges": edges,
    }
    out = city_dir(city_id) / "roads.json"
    out.write_text(json.dumps(payload, separators=(",", ":")))
    write_city_file(city_id)
    total_km = sum(e["meters"] for e in edges) / 1000
    print(f"{city_id}: {len(nodes)} nodes, {len(edges)} edges, {total_km:.0f} km, {out.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
