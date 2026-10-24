"""Download the west Altadena drive network from OpenStreetMap and write data/roads/altadena.json.

The box covers the simulated area in convex/model.ts (AREA) plus the shelter in Pasadena.
Both the Convex dispatcher (TypeScript) and the Python solver and simulator read the same file.

    uv run python build_graph.py
"""

import json
import math
from datetime import date
from pathlib import Path

import osmnx as ox

BBOX = {"south": 34.138, "north": 34.212, "west": -118.178, "east": -118.120}
OUT = Path(__file__).resolve().parent.parent / "data" / "roads" / "altadena.json"
COORD_DIGITS = 5


def first(value):
    return value[0] if isinstance(value, list) else value


def lanes_of(data) -> int:
    raw = first(data.get("lanes"))
    try:
        return max(1, int(float(raw)))
    except (TypeError, ValueError):
        return 1


def name_of(data) -> str:
    name = first(data.get("name")) or first(data.get("ref")) or ""
    return str(name)


def geometry_of(data):
    geometry = data.get("geometry")
    if geometry is None:
        return None
    return [[round(lat, COORD_DIGITS), round(lng, COORD_DIGITS)] for lng, lat in geometry.coords]


def main():
    graph = ox.graph_from_bbox(
        (BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"]), network_type="drive", simplify=True
    )
    graph = ox.truncate.largest_component(graph, strongly=True)
    graph = ox.add_edge_speeds(graph)
    graph = ox.add_edge_travel_times(graph)

    osm_ids = list(graph.nodes)
    index = {osm_id: i for i, osm_id in enumerate(osm_ids)}
    nodes = [[round(graph.nodes[n]["y"], COORD_DIGITS), round(graph.nodes[n]["x"], COORD_DIGITS)] for n in osm_ids]

    edges = []
    for u, v, key, data in graph.edges(keys=True, data=True):
        edges.append(
            {
                "u": index[u],
                "v": index[v],
                "key": f"{u}-{v}-{key}",
                "meters": round(float(data["length"]), 1),
                "seconds": round(float(data["travel_time"]), 1),
                "kph": round(float(data["speed_kph"]), 1),
                "lanes": lanes_of(data),
                "name": name_of(data),
                "geometry": geometry_of(data),
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": f"OpenStreetMap contributors via OSMnx {ox.__version__}, drive network, retrieved {date.today()}",
        "bbox": BBOX,
        "nodes": nodes,
        "osmIds": [str(n) for n in osm_ids],
        "edges": edges,
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":")))
    total_km = sum(e["meters"] for e in edges) / 1000
    print(f"{len(nodes)} nodes, {len(edges)} edges, {total_km:.0f} km of road, {OUT.stat().st_size / 1e6:.2f} MB")
    assert not math.isnan(total_km)


if __name__ == "__main__":
    main()
