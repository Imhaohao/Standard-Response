"""The real Altadena road graph, hazard closures and travel times.

Closures: an edge closes when the fire front reaches its midpoint (arrival time scaled by the
hazard-speed setting). Travel times are recomputed with Dijkstra once per closure epoch.
"""

from __future__ import annotations

import json
import sys
from functools import lru_cache

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

from .constants import CLOSURE_EPOCH_S, HAZARD_FILE, MINUTE, MODELING_DIR, ROADS_FILE

if str(MODELING_DIR) not in sys.path:
    sys.path.insert(0, str(MODELING_DIR))

from rollcall_d.hazard import Scenario  # noqa: E402

LNG_SCALE = float(np.cos(np.radians(34.18)))
KEPT_EPOCHS = 3
_roads_file = ROADS_FILE


def use_roads(path) -> None:
    """Point network() at another city's road graph (data/cities/<id>/roads.json)."""
    global _roads_file
    _roads_file = path
    network.cache_clear()
    edge_closure_minutes.cache_clear()


class RoadNetwork:
    def __init__(self, path=None):
        path = path or _roads_file
        raw = json.loads(path.read_text())
        self.coordinates = np.array(raw["nodes"], dtype=float)
        self.lng_scale = LNG_SCALE if path == ROADS_FILE else float(np.cos(np.radians(self.coordinates[:, 0].mean())))
        self.edge_highway = [e.get("highway", "") for e in raw["edges"]]
        self.size = len(self.coordinates)
        edges = raw["edges"]
        self.edge_from = np.array([e["u"] for e in edges], dtype=np.int64)
        self.edge_to = np.array([e["v"] for e in edges], dtype=np.int64)
        self.edge_seconds = np.maximum(np.array([e["seconds"] for e in edges], dtype=float), 0.1)
        self.edge_lanes = np.array([e.get("lanes") or 1 for e in edges], dtype=float)
        self.edge_meters = np.array([e["meters"] for e in edges], dtype=float)
        self._cheapest_first = np.argsort(self.edge_seconds, kind="stable")
        self.main_nodes = self._largest_strong_component()
        self._tree = cKDTree(self._scaled(self.coordinates[self.main_nodes]))

    def _scaled(self, latlng: np.ndarray) -> np.ndarray:
        return np.column_stack([latlng[:, 0], latlng[:, 1] * self.lng_scale])

    def _largest_strong_component(self) -> np.ndarray:
        graph = csr_matrix((np.ones(len(self.edge_from)), (self.edge_from, self.edge_to)), shape=(self.size, self.size))
        _, labels = connected_components(graph, directed=True, connection="strong")
        biggest = np.bincount(labels).argmax()
        return np.flatnonzero(labels == biggest)

    def snap(self, lat: float, lng: float) -> int:
        _, index = self._tree.query([lat, lng * self.lng_scale])
        return int(self.main_nodes[index])

    def nodes_in_box(self, box: dict) -> np.ndarray:
        lat, lng = self.coordinates[self.main_nodes, 0], self.coordinates[self.main_nodes, 1]
        inside = (lat >= box["south"]) & (lat <= box["north"]) & (lng >= box["west"]) & (lng <= box["east"])
        return self.main_nodes[inside]

    def edge_midpoints(self) -> np.ndarray:
        return (self.coordinates[self.edge_from] + self.coordinates[self.edge_to]) / 2

    def cheapest_parallel_edges(self, open_mask: np.ndarray) -> np.ndarray:
        """Indices of the fastest open edge for each (from, to) pair."""
        order = self._cheapest_first[open_mask[self._cheapest_first]]
        keys = self.edge_from[order] * self.size + self.edge_to[order]
        _, first = np.unique(keys, return_index=True)
        return order[first]


@lru_cache(maxsize=1)
def hazard_scenario() -> Scenario:
    return Scenario.load(HAZARD_FILE)


def fire_arrival_minutes(lat: float, lng: float) -> float:
    return hazard_scenario().arrival_minutes(lat, lng)


@lru_cache(maxsize=1)
def network() -> RoadNetwork:
    return RoadNetwork()


@lru_cache(maxsize=1)
def edge_closure_minutes() -> np.ndarray:
    midpoints = network().edge_midpoints()
    return np.array([fire_arrival_minutes(lat, lng) for lat, lng in midpoints])


class TravelTimes:
    """Shortest-path seconds from a fixed set of source nodes, under the closures at a given time."""

    def __init__(self, sources: list[int], hazard_scale: float, closure_seconds: np.ndarray | None = None):
        self.net = network()
        self.sources = np.array(sorted(set(sources)), dtype=np.int64)
        self.row_of = {int(node): row for row, node in enumerate(self.sources)}
        self.closure_seconds = edge_closure_minutes() * MINUTE * hazard_scale if closure_seconds is None else closure_seconds
        self._by_epoch: dict[int, np.ndarray] = {}
        self._last_key: tuple[int, np.ndarray] | None = None

    def epoch_of(self, t: float) -> int:
        return int(max(t, 0.0) // CLOSURE_EPOCH_S)

    def open_edges(self, epoch: int) -> np.ndarray:
        return self.closure_seconds > epoch * CLOSURE_EPOCH_S

    def table(self, t: float) -> np.ndarray:
        epoch = self.epoch_of(t)
        if epoch not in self._by_epoch:
            self._forget_old_epochs(epoch)
            self._by_epoch[epoch] = self._same_closures_table(epoch)
        return self._by_epoch[epoch]

    def _same_closures_table(self, epoch: int) -> np.ndarray:
        """An epoch whose open streets match the last one computed shares its table: one array, not another copy."""
        key = hash(self.open_edges(epoch).tobytes())
        if self._last_key is not None and self._last_key[0] == key:
            return self._last_key[1]
        table = self._compute(epoch)
        self._last_key = (key, table)
        return table

    def _forget_old_epochs(self, epoch: int):
        """A whole night of tables would not fit in memory. Epoch 0 stays: it is the no-closure fallback."""
        for old in [e for e in self._by_epoch if 0 < e < epoch - KEPT_EPOCHS]:
            del self._by_epoch[old]

    def _compute(self, epoch: int) -> np.ndarray:
        keep = self.net.cheapest_parallel_edges(self.open_edges(epoch))
        size = self.net.size
        graph = csr_matrix((self.net.edge_seconds[keep], (self.net.edge_from[keep], self.net.edge_to[keep])), shape=(size, size))
        return dijkstra(graph, directed=True, indices=self.sources)

    def seconds(self, a: int, b: int, t: float) -> float:
        return float(self.table(t)[self.row_of[a], b])

    def matrix(self, nodes: list[int], t: float) -> list[list[float | None]]:
        table = self.table(t)
        rows = [self.row_of[n] for n in nodes]
        block = table[np.ix_(rows, nodes)]
        return [[None if not np.isfinite(x) else float(x) for x in line] for line in block]

    def closed_edge_count(self, t: float) -> int:
        return int((~self.open_edges(self.epoch_of(t))).sum())
