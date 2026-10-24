"""EXPLORATION, assumption-driven, not a finding: congestion and departure timing.

Residents who drive themselves leave by a drift-diffusion model with two classes (evacuation-keen and
evacuation-reluctant), load onto the road graph, and edge times follow the BPR curve
t = t0 * (1 + 0.15 * (v/c)^4). Every number here is a stated assumption. The effect of a phone call on
departure is an assumption explored by simulation, not something we measured.
"""

from __future__ import annotations

import multiprocessing as mp

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

from . import rng
from .aggregate import summarize
from .constants import DEADLINE_MARGIN_S, MINUTE, POPULATION_FILE, Config
from .roads import RoadNetwork
from .world import World, build_world

LABEL = "Exploration, assumption-driven, not a finding"
STANDIN_CARS_PER_HOUSEHOLD = 20
MAX_VOLUME_TO_CAPACITY = 4.0
KEEN_SHARE = 0.4
KEEN_DRIFT, KEEN_NOISE = 0.10, 0.10
RELUCTANT_DRIFT, RELUCTANT_NOISE = 0.01, 0.08
FIRE_PRESSURE, FIRE_PRESSURE_SCALE_MIN = 0.06, 30.0
CALL_DRIFT_BOOST, CALL_REACHED_AT_S = 0.05, 5 * MINUTE
EVERYONE_AT_ONCE_WINDOW_S = 10 * MINUTE
LANE_CAPACITY_PER_HOUR = 600.0
EVERYONE = 10**9
BIN_S, BIN_COUNT = 300.0, 96
STEP_S = 60.0
BPR_ITERATIONS = 3
CHECKPOINT_MINUTES = (15, 30, 60, 120)


def exploration_assumptions() -> list[dict]:
    rows = [
        ("Residents", "every household in data/population.json that has a car and no ride need drives one car (stand-in population: 20 cars per household)", "the whole area, not the sampled demo zone, because the question is about everyone"),
        ("Congestion cap", f"volume over capacity is capped at {MAX_VOLUME_TO_CAPACITY}", "stops the fourth-power BPR curve from producing absurd times when a single route is hugely overloaded"),
        ("Departure model", "dX = mu(t) dt + sigma dW, leave when X reaches 1", "drift-diffusion with two classes"),
        ("Evacuation-keen share", KEEN_SHARE, "stand-in; the plan cites Berkeley's survey of California evacuees for the two classes, shape not fitted here"),
        ("Keen drift and noise", f"{KEEN_DRIFT} per min, {KEEN_NOISE}", "typical keen resident leaves in about 10 minutes"),
        ("Reluctant drift and noise", f"{RELUCTANT_DRIFT} per min, {RELUCTANT_NOISE}", "typical reluctant resident would wait well over an hour on their own"),
        ("Fire pressure", f"drift rises by up to {FIRE_PRESSURE} per min as the fire nears (scale {FIRE_PRESSURE_SCALE_MIN:.0f} min)", "people leave faster as the fire gets close"),
        ("Forced departure", "everyone still home leaves at their deadline (fire arrival minus 10 min)", "keeps the model from stranding anyone"),
        ("Effect of a call", f"a reached resident's drift rises by {CALL_DRIFT_BOOST} per min from minute {CALL_REACHED_AT_S / 60:.0f}", "an assumption explored in simulation, not a finding"),
        ("Reached by a call", "probability equals the household's answer probability", "single attempt"),
        ("Destination", "every car drives the free-flow shortest path to the shelter", "a stand-in for real exit routes"),
        ("Edge capacity", f"{LANE_CAPACITY_PER_HOUR:.0f} vehicles per hour per lane", "residential street assumption"),
        ("Congestion", "BPR curve, 5 minute bins, 3 fixed-point iterations", "time on an edge depends on the volume entering in that bin"),
    ]
    return [{"name": n, "value": v, "why": w} for n, v, w in rows]


def resident_columns(world: World) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Household index, fire arrival seconds, node and answer probability for every resident car."""
    drivers = [h for h in world.households if h.need is None and h.has_car]
    cars = 1 if POPULATION_FILE.exists() else STANDIN_CARS_PER_HOUSEHOLD
    index = np.repeat([h.index for h in drivers], cars)
    arrival = np.repeat([h.fire_arrival_s for h in drivers], cars)
    answers = np.repeat([h.answers_phone for h in drivers], cars)
    node = np.repeat([h.node for h in drivers], cars)
    return index, arrival, node, answers


def drift_at(t_s: float, keen: np.ndarray, arrival: np.ndarray, reached: np.ndarray | None) -> np.ndarray:
    pressure = FIRE_PRESSURE * np.exp(-np.maximum(arrival - t_s, 0.0) / (FIRE_PRESSURE_SCALE_MIN * MINUTE))
    drift = np.where(keen, KEEN_DRIFT, RELUCTANT_DRIFT + pressure)
    if reached is not None and t_s >= CALL_REACHED_AT_S:
        drift = drift + CALL_DRIFT_BOOST * reached
    return drift


def departure_times(generator, arrival: np.ndarray, reached: np.ndarray | None) -> np.ndarray:
    count = len(arrival)
    keen = generator.random(count) < KEEN_SHARE
    noise = np.where(keen, KEEN_NOISE, RELUCTANT_NOISE)
    state, leave = np.zeros(count), np.full(count, np.inf)
    forced_at = np.maximum(arrival - DEADLINE_MARGIN_S, STEP_S)
    steps = int(np.ceil(forced_at.max() / STEP_S)) + 1
    for step in range(steps):
        t = step * STEP_S
        dt_min = STEP_S / MINUTE
        state += drift_at(t, keen, arrival, reached) * dt_min + noise * np.sqrt(dt_min) * generator.standard_normal(count)
        leaving = np.isinf(leave) & ((state >= 1.0) | (t + STEP_S >= forced_at))
        leave[leaving] = t + STEP_S
    return leave


def everyone_at_once(generator, count: int) -> np.ndarray:
    return generator.uniform(0.0, EVERYONE_AT_ONCE_WINDOW_S, count)


class RoutePlanner:
    """Free-flow shortest paths from household nodes to the shelter, as lists of edge indices."""

    def __init__(self, net: RoadNetwork, world: World):
        keep = net.cheapest_parallel_edges(np.ones(len(net.edge_from), dtype=bool))
        graph = csr_matrix((net.edge_seconds[keep], (net.edge_from[keep], net.edge_to[keep])), shape=(net.size, net.size))
        self.edge_of = {(int(net.edge_from[i]), int(net.edge_to[i])): int(i) for i in keep}
        sources = sorted({h.node for h in world.households})
        self.row_of = {node: row for row, node in enumerate(sources)}
        _, self.predecessors = dijkstra(graph, directed=True, indices=sources, return_predecessors=True)
        self.shelter = world.shelter_node
        self.cache: dict[int, list[int]] = {}

    def path(self, node: int) -> list[int]:
        if node not in self.cache:
            self.cache[node] = self._walk(node)
        return self.cache[node]

    def _walk(self, node: int) -> list[int]:
        row, edges, current = self.predecessors[self.row_of[node]], [], self.shelter
        while current != node and current >= 0:
            before = int(row[current])
            if before < 0:
                return []
            edges.append(self.edge_of[(before, current)])
            current = before
        return edges[::-1]


def bpr_times(net: RoadNetwork, flows: np.ndarray) -> np.ndarray:
    capacity = np.maximum(net.edge_lanes, 1.0) * LANE_CAPACITY_PER_HOUR
    ratio = np.minimum(flows * (3600.0 / BIN_S) / capacity, MAX_VOLUME_TO_CAPACITY)
    return net.edge_seconds * (1.0 + 0.15 * ratio**4)


def load_network(net: RoadNetwork, planner: RoutePlanner, nodes: np.ndarray, departures: np.ndarray):
    """Fixed-point loop: flows set edge times, edge times set when cars reach each edge."""
    times = np.tile(net.edge_seconds, (BIN_COUNT, 1))
    flows = np.zeros_like(times)
    arrive = departures
    for _ in range(BPR_ITERATIONS):
        flows = np.zeros_like(times)
        arrive = np.empty(len(nodes))
        for i, (node, depart) in enumerate(zip(nodes, departures)):
            clock = depart
            for edge in planner.path(int(node)):
                bin_index = min(int(clock // BIN_S), BIN_COUNT - 1)
                flows[bin_index, edge] += 1
                clock += times[bin_index, edge]
            arrive[i] = clock
        times = bpr_times(net, flows)
    return arrive, flows


def free_flow_minutes(net: RoadNetwork, planner: RoutePlanner, nodes: np.ndarray) -> np.ndarray:
    return np.array([net.edge_seconds[planner.path(int(n))].sum() for n in nodes]) / MINUTE


def scenario_metrics(net: RoadNetwork, planner: RoutePlanner, nodes: np.ndarray, departures: np.ndarray) -> dict:
    arrive, flows = load_network(net, planner, nodes, departures)
    trip = (arrive - departures) / MINUTE
    free = free_flow_minutes(net, planner, nodes)
    peak_bin = int(np.bincount(np.minimum((departures // BIN_S).astype(int), BIN_COUNT - 1)).argmax())
    in_peak = np.minimum((departures // BIN_S).astype(int), BIN_COUNT - 1) == peak_bin
    capacity_per_bin = np.maximum(net.edge_lanes, 1.0) * LANE_CAPACITY_PER_HOUR * (BIN_S / 3600.0)
    return {
        **{f"departedByMinute{m}": float((departures <= m * MINUTE).mean()) for m in CHECKPOINT_MINUTES},
        "meanTripMinutes": float(trip.mean()),
        "p95TripMinutes": float(np.percentile(trip, 95)),
        "freeFlowMeanTripMinutes": float(free.mean()),
        "peakBinSlowdownFactor": float(trip[in_peak].sum() / max(free[in_peak].sum(), 1e-9)),
        "worstVolumeToCapacity": float((flows / capacity_per_bin).max()),
        "peakDepartureMinute": peak_bin * BIN_S / MINUTE,
    }


def explore_seed(args) -> dict:
    seed, config = args
    world = build_world(seed, config.with_changes(households=EVERYONE))
    net = world.net
    index, arrival, nodes, answers = resident_columns(world)
    generator = rng.generator(seed, "exploration")
    reached = (generator.random(len(index)) < answers).astype(float)
    planner = RoutePlanner(net, world)
    own = departure_times(rng.generator(seed, "departure"), arrival, None)
    called = departure_times(rng.generator(seed, "departure"), arrival, reached)
    at_once = everyone_at_once(rng.generator(seed, "exploration", 1), len(index))
    return {
        "ownPace": scenario_metrics(net, planner, nodes, own),
        "withCalls": scenario_metrics(net, planner, nodes, called),
        "everyoneAtOnce": scenario_metrics(net, planner, nodes, at_once),
        "residents": int(len(index)),
    }


def summarize_scenarios(runs: list[dict]) -> dict:
    names = ("ownPace", "withCalls", "everyoneAtOnce")
    return {name: {metric: summarize([r[name][metric] for r in runs]) for metric in runs[0][name]} for name in names}


def exploration_headline(scenarios: dict, seeds: int) -> str:
    own, once = scenarios["ownPace"], scenarios["everyoneAtOnce"]
    return (
        f"Exploration only: if every resident left within 10 minutes, the median trip to the shelter took "
        f"{once['meanTripMinutes']['median']:.0f} minutes against {once['freeFlowMeanTripMinutes']['median']:.0f} with empty roads, "
        f"and the busiest road segment ran at {once['worstVolumeToCapacity']['median']:.1f} times its capacity "
        f"(drift-diffusion departures at their own pace: {own['meanTripMinutes']['median']:.0f} minutes, {own['worstVolumeToCapacity']['median']:.1f} times). "
        f"Median over {seeds} seeds; every input is an assumption."
    )


def run_exploration(seeds: int, config: Config, workers: int) -> dict:
    tasks = [(seed, config) for seed in range(seeds)]
    with mp.get_context("spawn").Pool(min(workers, len(tasks))) as pool:
        runs = pool.map(explore_seed, tasks)
    scenarios = summarize_scenarios(runs)
    return {
        "label": LABEL,
        "question": "What happens if everyone leaves at once?",
        "seeds": seeds,
        "residents": summarize([r["residents"] for r in runs]),
        "assumptions": exploration_assumptions(),
        "scenarios": scenarios,
        "scenarioMeaning": {
            "ownPace": "Drift-diffusion departures, no phone calls.",
            "withCalls": "Same draws, but residents we reach get a drift boost (an assumption).",
            "everyoneAtOnce": "Every resident leaves within 10 minutes of the warning.",
        },
        "headline": exploration_headline(scenarios, seeds),
    }
