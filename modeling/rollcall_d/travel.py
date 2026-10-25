"""Travel times on the real west Altadena road graph (OSMnx), with closures removed.

Door-check teams and the hazard runner both use this. Edge keys are "u-v-key" with OSM node ids,
the same keys the dispatcher's graph uses when it loads data/osm/drive.graphml.
"""

import math
from dataclasses import dataclass
from functools import cached_property
from typing import Iterable, Iterator

import networkx as nx
import numpy as np
import osmnx as ox
from shapely.geometry import LineString

from .geo import to_xy
from .paths import OSM

GRAPH_FILE = OSM / "drive.graphml"
# Getting from the nearest intersection to the door, at walking pace.
WALK_METERS_PER_MINUTE = 80.0


@dataclass(frozen=True)
class Edge:
    u: int
    v: int
    key: int
    length: float
    travel_minutes: float
    coords: list[tuple[float, float]]  # (lat, lng) along the street

    @property
    def edge_key(self) -> str:
        return f"{self.u}-{self.v}-{self.key}"


def edge_key(u: int, v: int, key: int) -> str:
    return f"{u}-{v}-{key}"


class RoadGraph:
    def __init__(self, graph: nx.MultiDiGraph):
        self.graph = graph
        self.node_ids = np.array(list(graph.nodes))
        xy = [to_xy(graph.nodes[n]["y"], graph.nodes[n]["x"]) for n in self.node_ids]
        self.node_xy = np.array(xy)

    @classmethod
    def load(cls, path=GRAPH_FILE) -> "RoadGraph":
        return cls(ox.load_graphml(path))

    def edges(self) -> Iterator[Edge]:
        for u, v, key, data in self.graph.edges(keys=True, data=True):
            geometry = data.get("geometry")
            if geometry is not None:
                coords = [(lat, lng) for lng, lat in geometry.coords]
            else:
                coords = [(self.graph.nodes[n]["y"], self.graph.nodes[n]["x"]) for n in (u, v)]
            yield Edge(u, v, key, float(data.get("length", 0.0)), float(data.get("travel_time", 0.0)) / 60.0, coords)

    def undirected_edges(self) -> Iterator[Edge]:
        """One edge per street segment: the u<v direction when both exist, else the one-way."""
        for edge in self.edges():
            if edge.u > edge.v and self.graph.has_edge(edge.v, edge.u, edge.key):
                continue
            yield edge

    def nearest_node(self, lat: float, lng: float) -> tuple[int, float]:
        x, y = to_xy(lat, lng)
        d2 = (self.node_xy[:, 0] - x) ** 2 + (self.node_xy[:, 1] - y) ** 2
        i = int(np.argmin(d2))
        return int(self.node_ids[i]), math.sqrt(float(d2[i]))

    @cached_property
    def _edge_index(self) -> tuple[list[tuple[int, int, int]], list[LineString]]:
        keys, lines = [], []
        for edge in self.edges():
            keys.append((edge.u, edge.v, edge.key))
            lines.append(LineString([to_xy(lat, lng) for lat, lng in edge.coords]))
        return keys, lines

    def closed_edges(self, closures: Iterable[dict], snap_meters: float = 40.0) -> set[tuple[int, int, int]]:
        """Edges blocked by closures, both directions. Uses edgeKey when it names a graph edge;
        otherwise snaps the closure's midpoint to the nearest street within `snap_meters`."""
        closed: set[tuple[int, int, int]] = set()
        keys, lines = self._edge_index
        for closure in closures:
            parsed = _parse_edge_key(closure.get("edgeKey"))
            if parsed and self.graph.has_edge(*parsed):
                hit = parsed
            else:
                hit = self._snap(closure.get("path") or [], keys, lines, snap_meters)
            if hit:
                u, v, k = hit
                closed.add((u, v, k))
                if self.graph.has_edge(v, u, k):
                    closed.add((v, u, k))
        return closed

    @staticmethod
    def _snap(path, keys, lines, snap_meters):
        if not path:
            return None
        mid = path[len(path) // 2]
        from shapely.geometry import Point

        point = Point(*to_xy(mid["lat"], mid["lng"]))
        best = min(range(len(lines)), key=lambda i: lines[i].distance(point))
        return keys[best] if lines[best].distance(point) <= snap_meters else None

    def minutes_from(self, sources: Iterable[tuple[float, float]], closed: set[tuple[int, int, int]]) -> dict[int, float]:
        """Driving minutes from the nearest of several (lat, lng) sources to every reachable node."""
        source_nodes = {self.nearest_node(lat, lng)[0] for lat, lng in sources}

        def weight(u, v, edges):
            open_times = [d.get("travel_time", 0.0) for k, d in edges.items() if (u, v, k) not in closed]
            return min(open_times) / 60.0 if open_times else None

        return nx.multi_source_dijkstra_path_length(self.graph, source_nodes, weight=weight)

    def minutes_to(self, lat: float, lng: float, from_sources: dict[int, float]) -> float:
        """Minutes to reach a point, given `minutes_from` output. Unreachable points get infinity."""
        node, offset = self.nearest_node(lat, lng)
        if node not in from_sources:
            return math.inf
        return from_sources[node] + offset / WALK_METERS_PER_MINUTE


def _parse_edge_key(value) -> tuple[int, int, int] | None:
    if not value:
        return None
    parts = str(value).split("-")
    if len(parts) != 3 or not all(p.isdigit() for p in parts):
        return None
    return int(parts[0]), int(parts[1]), int(parts[2])
