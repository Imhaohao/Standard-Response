"""A door-team simulation for testing door-check orderings.

Calls reach most homes; the ones that don't answer go on the door-check list over the first half hour.
Six teams drive the real road graph and knock (KNOCK_MINUTES per home). A free team picks its next home
by the policy. We measure, per policy and stress scenario, how long homes wait to be checked (worst case,
not only the average) and how many homes that truly need help, and that the fire reaches, are checked before
their hazard deadline.

Ground truth comes from the synthetic population; estimates see only what a real agency would: the
census base rate, answered neighbors and neighbor nominations (which may be wrong).
"""

import math
import random
from dataclasses import dataclass, field

import networkx as nx
import numpy as np

from . import door
from .geo import to_xy
from .hazard import Scenario
from .need import NeedConfig
from .travel import WALK_METERS_PER_MINUTE, RoadGraph

KNOCK_MINUTES = 4.0  # park, knock, wait, check: an assumption
LIST_OPENS_MINUTES = (15.0, 45.0)  # homes join the list as the reach ladder runs out (call, 2 and 5 min retries, text)
NOMINATION_SHARE = 0.10  # nominations reach about 10% of truly needy unreached homes


@dataclass
class Scenario_:
    name: str
    wrong_nominations: float = 0.0  # share of nominations that point at a home that doesn't need help
    slow_area_answer_factor: float = 1.0  # one neighborhood answers at this fraction of the usual rate
    silent_pocket_meters: float = 0.0  # nobody answers within this distance of the area's far northwest home
    homes: int = 400


@dataclass
class World:
    xy: np.ndarray  # home positions, meters
    node: np.ndarray  # nearest graph node index per home
    offset: np.ndarray  # walking minutes from node to door
    truth: np.ndarray  # 1 if the home really needs help
    p: np.ndarray  # need estimate the policy sees
    deadline: np.ndarray  # scenario minutes when the hazard deadline passes
    entry: np.ndarray  # minute the home joins the door-check list
    isolated: np.ndarray  # no answered neighbor within 500 m
    slow_area: np.ndarray
    reached: np.ndarray  # the scenario's fire reaches the home (past its last front, the deadline is extrapolated)


@dataclass
class Result:
    wait: np.ndarray  # minutes from joining the list to being checked
    checked_in_time: float  # share of truly needy homes the fire reaches that are checked before their deadline
    extra: dict = field(default_factory=dict)


class TravelMatrix:
    """All-pairs driving minutes between graph nodes (868 nodes: a few seconds once)."""

    def __init__(self, roads: RoadGraph):
        self.roads = roads
        index = {n: i for i, n in enumerate(roads.node_ids)}
        self.index = index
        size = len(index)
        self.minutes = np.full((size, size), np.inf)
        weight = lambda u, v, d: min(e.get("travel_time", 0.0) for e in d.values()) / 60.0  # noqa: E731
        for source, lengths in nx.all_pairs_dijkstra_path_length(roads.graph, weight=weight):
            row = self.minutes[index[source]]
            for target, minutes in lengths.items():
                row[index[target]] = minutes

    def nearest(self, lat: float, lng: float) -> tuple[int, float]:
        node, meters = self.roads.nearest_node(lat, lng)
        return self.index[node], meters / WALK_METERS_PER_MINUTE


def build_world(rng: random.Random, population: list[dict], scenario: Scenario_, hazard: Scenario, travel: TravelMatrix,
                base_rates: dict[str, float], config: NeedConfig = NeedConfig()) -> World:
    """Call everyone in a sample; the homes that don't answer become the door-check list."""
    lats = [h["lat"] for h in population]
    slow_lat = np.quantile(lats, 0.8)  # the northern fifth answers less in the slow-area scenario
    corner = max(population, key=lambda h: h["lat"] - h["lng"])  # far northwest: the canyon edge
    corner_xy = np.array(to_xy(corner["lat"], corner["lng"]))
    pool = rng.sample(population, min(len(population), scenario.homes * 4))
    answered, listed = [], []
    for home in pool:
        rate = home["answersPhone"] * (scenario.slow_area_answer_factor if home["lat"] >= slow_lat else 1.0)
        if np.hypot(*(np.array(to_xy(home["lat"], home["lng"])) - corner_xy)) < scenario.silent_pocket_meters:
            rate = 0.0
        (answered if rng.random() < rate else listed).append(home)
    listed = listed[: scenario.homes]
    needs = lambda h: h["canLeave"] != "yes" or h["mobility"] in ("power_wheelchair", "bedbound") or bool(h["medical"])  # noqa: E731
    answered_xy = np.array([to_xy(h["lat"], h["lng"]) for h in answered])
    answered_y = np.array([1.0 if needs(h) else 0.0 for h in answered])
    xy = np.array([to_xy(h["lat"], h["lng"]) for h in listed])
    truth = np.array([1.0 if needs(h) else 0.0 for h in listed])
    nominated = _nominations(rng, truth, scenario.wrong_nominations)
    p, isolated = np.zeros(len(listed)), np.zeros(len(listed), dtype=bool)
    for i, home in enumerate(listed):
        prior = base_rates.get(home["blockGroup"], 0.12)
        d2 = ((answered_xy - xy[i]) ** 2).sum(axis=1)
        isolated[i] = not (d2 < 500.0**2).any()
        w = np.exp(-d2 / (2 * config.kernel_meters**2))
        w[d2 > (3 * config.kernel_meters) ** 2] = 0.0
        estimate = (prior * config.prior_strength + w @ answered_y) / (config.prior_strength + w.sum())
        if nominated[i]:
            odds = estimate / (1 - estimate) * config.nomination_lr
            estimate = odds / (1 + odds)
        p[i] = estimate
    nodes, offsets = zip(*(travel.nearest(h["lat"], h["lng"]) for h in listed))
    deadline = np.array([hazard.arrival_minutes(h["lat"], h["lng"]) - door.DEADLINE_MARGIN_MINUTES for h in listed])
    entry = np.array([rng.uniform(*LIST_OPENS_MINUTES) for _ in listed])
    slow = np.array([h["lat"] >= slow_lat for h in listed])
    reached = np.array([hazard.reaches(h["lat"], h["lng"]) for h in listed])
    return World(xy, np.array(nodes), np.array(offsets), truth, p, deadline, entry, isolated, slow, reached)


def _nominations(rng: random.Random, truth: np.ndarray, wrong_share: float) -> np.ndarray:
    needy = [i for i in range(len(truth)) if truth[i]]
    others = [i for i in range(len(truth)) if not truth[i]]
    right = rng.sample(needy, max(1, round(len(needy) * NOMINATION_SHARE))) if needy else []
    wrong_count = round(len(right) * wrong_share / max(1 - wrong_share, 1e-9))
    wrong = rng.sample(others, min(len(others), wrong_count))
    flags = np.zeros(len(truth), dtype=bool)
    flags[right + wrong] = True
    return flags


def simulate(world: World, policy: str, travel: TravelMatrix, teams: list[tuple[float, float]], rng: random.Random,
             alpha: float | None = None) -> Result:
    n = len(world.p)
    checked_at = np.full(n, np.inf)
    remaining = np.ones(n, dtype=bool)
    team_node = [travel.nearest(lat, lng)[0] for lat, lng in teams]
    team_free = [LIST_OPENS_MINUTES[0]] * len(teams)
    driven = 0.0
    while remaining.any():
        t_index = int(np.argmin(team_free))
        now = team_free[t_index]
        available = remaining & (world.entry <= now)
        if not available.any():
            team_free[t_index] = float(world.entry[remaining].min())
            continue
        candidates = np.flatnonzero(available)
        tau = travel.minutes[team_node[t_index], world.node[candidates]] + world.offset[candidates]
        choice = candidates[_pick(policy, world, candidates, tau, now, alpha, rng)]
        drive = travel.minutes[team_node[t_index], world.node[choice]] + world.offset[choice]
        drive = drive if math.isfinite(drive) else 30.0
        driven += drive
        checked_at[choice] = now + drive + KNOCK_MINUTES
        team_node[t_index] = world.node[choice]
        team_free[t_index] = checked_at[choice]
        remaining[choice] = False
    wait = checked_at - world.entry
    needy = (world.truth > 0) & world.reached  # a home the fire never reaches can't be checked late
    in_time = float((checked_at[needy] <= world.deadline[needy]).mean()) if needy.any() else 1.0
    return Result(wait, in_time, {"drivePerCheck": driven / n if n else 0.0})


def _pick(policy: str, world: World, candidates: np.ndarray, tau: np.ndarray, now: float, alpha: float | None, rng: random.Random) -> int:
    if policy == "random":
        return rng.randrange(len(candidates))
    if policy == "nearest":
        return int(np.argmin(tau))
    minutes_left = world.deadline[candidates] + door.DEADLINE_MARGIN_MINUTES - now
    terms = np.array([door.need_urgency_term(p, m, t) for p, m, t in zip(world.p[candidates], minutes_left, tau)])
    a = 0.0 if policy == "score_no_aging" else (alpha or 0.0)
    return int(np.argmax(terms + a * (now - world.entry[candidates])))


def alpha_at_start(world: World, travel: TravelMatrix, teams: list[tuple[float, float]], config: door.DoorConfig) -> float:
    """Alpha set the same way the live runner sets it: from the queue's need-and-urgency terms once
    door checks start, using the nearest team's travel time."""
    starts = [travel.nearest(lat, lng)[0] for lat, lng in teams]
    first = np.flatnonzero(world.entry <= np.quantile(world.entry, 0.25))
    tau = np.min([travel.minutes[s, world.node[first]] for s in starts], axis=0) + world.offset[first]
    minutes = world.deadline[first] + door.DEADLINE_MARGIN_MINUTES - LIST_OPENS_MINUTES[0]
    terms = [door.need_urgency_term(p, m, t) for p, m, t in zip(world.p[first], minutes, tau)]
    return door.alpha_for(terms, config)
