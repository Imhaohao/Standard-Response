"""One past disaster, replayed at full scale in another town, with our system against today's process.

The same simulator as sim.eaton_night, pointed at a city in data/cities/<id>/: its synthetic population
(modeling/scripts/cities/build_population.py), its road graph (modeling/scripts/cities/build_roads.py) and
the arrival-time fronts in public/scenarios/<id>.json. The clock starts at the warning: calls start then and
the vans roll from the staging point then. Each home's deadline is when the hazard's front reaches it, minus
that hazard's margin from sim.hazard_rules, and streets close as the hazard reaches them.

Command line: uv run python -m sim.city_night --city paradise --seeds 5
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import shapely
import simpy
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from shapely.geometry import shape

from .constants import CALL_TAKERS, MINUTE, REPO, Config
from .eaton_night import POLICIES, SAMPLED_HOUSEHOLDS, collect, hold_vehicles, scaled_fleet
from .engine import SOLVERS
from .fleetstate import Night
from .hazard_rules import RULES, ArrivalContext, HazardRule
from .metrics import boarded_at
from .optimizer_policy import OptimizerPolicy
from .population import Household, file_traits
from .rng import generator
from .roads import TravelTimes, network, use_roads
from .streams import emergency_stream, outreach_stream
from .today_policy import TodayPolicy
from .world import World

CITIES = REPO / "data" / "cities"
SCENARIOS = REPO / "public" / "scenarios"
FLEET_SIZES = [10, 25, 50]


class LazyTravelTimes(TravelTimes):
    """Travel times that compute a node's row only when something drives from it. A whole city's households as
    sources would hold a table of (homes x road nodes) per closure epoch, gigabytes for Buffalo; the dispatcher only
    ever drives from a few hundred places an epoch. The numbers are the same Dijkstra on the same open streets."""

    def __init__(self, closure_seconds: np.ndarray):
        self.net = network()
        self.closure_seconds = closure_seconds
        self._graphs: dict[int, tuple[int, csr_matrix]] = {}
        self._rows: dict[int, dict[int, np.ndarray]] = {}

    def _graph(self, epoch: int) -> csr_matrix:
        if epoch not in self._graphs:
            mask = self.open_edges(epoch)
            key = hash(mask.tobytes())
            reuse = next((graph for k, graph in self._graphs.values() if k == key), None)
            if reuse is None:
                keep = self.net.cheapest_parallel_edges(mask)
                reuse = csr_matrix((self.net.edge_seconds[keep], (self.net.edge_from[keep], self.net.edge_to[keep])), shape=(self.net.size, self.net.size))
            self._graphs = {e: v for e, v in self._graphs.items() if e >= epoch - 3 or e == 0}
            self._graphs[epoch] = (key, reuse)
        return self._graphs[epoch][1]

    def _rows_for(self, nodes, epoch: int) -> dict[int, np.ndarray]:
        rows = self._rows.setdefault(epoch, {})
        missing = sorted({int(n) for n in nodes} - rows.keys())
        if missing:
            table = np.atleast_2d(dijkstra(self._graph(epoch), directed=True, indices=missing))
            rows.update(zip(missing, table))
            self._rows = {e: r for e, r in self._rows.items() if e >= epoch - 3 or e == 0}
        return rows

    def seconds(self, a: int, b: int, t: float) -> float:
        return float(self._rows_for([a], self.epoch_of(t))[a][b])

    def matrix(self, nodes: list[int], t: float) -> list[list[float | None]]:
        rows = self._rows_for(nodes, self.epoch_of(t))
        block = np.array([rows[n][nodes] for n in nodes])
        return [[None if not np.isfinite(x) else float(x) for x in line] for line in block]


@dataclass(frozen=True)
class CityHousehold(Household):
    """A household whose deadline margin depends on the hazard (and, for a tsunami, on how far it is from high ground)."""
    margin_s: float = 10 * MINUTE
    # When the hazard physically reaches the home, which can be later than the time a pickup stops counting.
    hazard_at_s: float = math.inf
    # When the dispatcher learns this home is in danger; until then it plans as if the home could wait.
    known_at_s: float = -math.inf
    unknown_slack_s: float = 0.0

    @property
    def deadline_s(self) -> float:
        return self.fire_arrival_s - self.margin_s

    def plan_deadline_s(self, now: float) -> float:
        return self.deadline_s if now >= self.known_at_s else self.deadline_s + self.unknown_slack_s


def front_geometry(front: dict):
    raw = front.get("geometry") or front.get("polygon")
    if isinstance(raw, dict):
        return shape(raw)
    return shapely.Polygon([(lng, lat) for lng, lat in raw])


def scenario_fronts(scenario: dict) -> list[tuple[float, object]]:
    """(minutes after the warning, area the hazard has reached by then), earliest first."""
    collection = scenario["fronts"] if isinstance(scenario.get("fronts"), dict) else scenario
    if collection.get("type") == "FeatureCollection":
        fronts = [{"minutesAfterWarning": f["properties"]["minutesAfterWarning"], "geometry": f["geometry"]} for f in collection["features"]]
    else:
        fronts = scenario["fronts"]
    return sorted(((float(f["minutesAfterWarning"]), shapely.make_valid(front_geometry(f))) for f in fronts), key=lambda pair: pair[0])


def arrival_minutes(fronts, lat: np.ndarray, lng: np.ndarray) -> np.ndarray:
    """The first front that covers each point, in minutes after the warning; inf where none does."""
    out = np.full(len(lat), np.inf)
    for minutes, geometry in fronts:
        inside = shapely.contains_xy(geometry, lng, lat) & ~np.isfinite(out)
        out[inside] = minutes
    return out


def load_scenario(city_id: str) -> dict:
    path = SCENARIOS / f"{city_id}.json"
    if not path.exists():
        raise SystemExit(f"{path} is missing; the scenario is written by the research agents")
    return json.loads(path.read_text())


def warning_epoch(scenario: dict) -> float:
    stamp = (scenario.get("clock") or {}).get("warningAt") or scenario.get("warningAt") or (scenario.get("metadata") or {}).get("warningClock")
    return datetime.fromisoformat(stamp).timestamp()


@dataclass
class CityInputs:
    city: dict
    rule: HazardRule
    records: list[dict]
    nodes: list[int]
    arrival_s: np.ndarray
    margin_s: np.ndarray
    hazard_at_s: np.ndarray
    known_at_s: np.ndarray
    closures_s: np.ndarray
    window_end_s: float
    warning_at: float
    staging_node: int
    shelter_node: int


def city_inputs(city_id: str, informed: bool = True) -> CityInputs:
    folder = CITIES / city_id
    city = json.loads((folder / "city.json").read_text())
    use_roads(folder / "roads.json")
    net = network()
    scenario = load_scenario(city_id)
    rule = RULES[city["hazard"]]
    fronts = scenario_fronts(scenario)
    records = json.loads((folder / "population.json").read_text())
    lat = np.array([r["lat"] for r in records])
    lng = np.array([r["lng"] for r in records])
    nodes = [net.snap(a, b) for a, b in zip(lat, lng)]
    closures = rule.closures(net, fronts, scenario, folder)
    context = ArrivalContext(net, fronts, nodes, records, folder, warning_epoch(scenario))
    front_arrival = arrival_minutes(fronts, lat, lng) * MINUTE
    arrival = rule.adjust_arrival(front_arrival, context)
    hazard_at = np.where(np.isfinite(arrival), np.maximum(front_arrival, arrival), np.inf) if rule.roof_at_front else arrival
    known_at = rule.known_at(context, len(records)) if informed else np.full(len(records), -np.inf)
    margin = rule.margins(len(records))
    staging = net.snap(city["staging"]["lat"], city["staging"]["lng"])
    shelter = net.snap(city["shelter"]["lat"], city["shelter"]["lng"])
    # The night ends with the last household the hazard reaches; homes it never reaches can wait until then.
    reached = arrival[np.isfinite(arrival)]
    window_end = float(reached.max()) if reached.size else max(m for m, _ in fronts) * MINUTE
    return CityInputs(city, rule, records, nodes, arrival, margin, hazard_at, known_at, closures, window_end, warning_epoch(scenario), staging, shelter)


def city_household(index: int, record: dict, node: int, inputs: CityInputs, rng) -> CityHousehold:
    traits = file_traits(record, rng)
    arrival = float(inputs.arrival_s[index])
    at_risk = math.isfinite(arrival)
    return CityHousehold(
        index=index, node=node, lat=record["lat"], lng=record["lng"], age=traits["age"],
        answers_phone=float(np.clip(traits["answersPhone"], 0.0, 0.99)), replies_to_text=traits["repliesToText"],
        need_prior=traits["needPrior"], fire_arrival_s=arrival if at_risk else inputs.window_end_s,
        need=inputs.rule.ride_need({**traits["truth"], "age": traits["age"]}), has_car=bool(record["hasCar"]), at_risk=at_risk,
        margin_s=float(inputs.margin_s[index]),
        hazard_at_s=float(inputs.hazard_at_s[index]), known_at_s=float(inputs.known_at_s[index]),
        unknown_slack_s=inputs.rule.unknown_slack_s,
    )


def build_city_world(seed: int, fleet_size: int, inputs: CityInputs) -> World:
    net = network()
    rng = generator(seed, "population")
    households = [city_household(i, r, inputs.nodes[i], inputs, rng) for i, r in enumerate(inputs.records)]
    travel = LazyTravelTimes(inputs.closures_s)
    takers = max(CALL_TAKERS, round(CALL_TAKERS * len(households) / SAMPLED_HOUSEHOLDS))
    config = Config(fleet_size=fleet_size, households=len(households), call_takers=takers)
    return World(seed, config, net, households, scaled_fleet(fleet_size), [inputs.staging_node] * fleet_size, inputs.shelter_node, travel)


def simulate(world: World, policy: str, vans_from_s: float):
    """Run one night and hand back the finished state, so a traced run can be written out as a replay."""
    arrival_kind, dispatcher = POLICIES[policy]
    stream = outreach_stream(world) if arrival_kind == "outreach" else emergency_stream(world)
    env = simpy.Environment()
    night = Night(env, world)
    if dispatcher == "today":
        on_release = TodayPolicy(night, stream).dispatch
    else:
        OptimizerPolicy(night, stream, SOLVERS[dispatcher])
        on_release = lambda: None  # noqa: E731
    env.process(hold_vehicles(night, vans_from_s, on_release))
    env.run(until=world.horizon_s)
    return night, stream


def city_metrics(night: Night, stream) -> dict:
    boarded = boarded_at(night)
    at_risk = [h for h in night.world.needers if h.at_risk]
    on_time = [h for h in at_risk if h.index in boarded and boarded[h.index] <= h.deadline_s]
    before = [h for h in at_risk if h.index in boarded and boarded[h.index] <= h.fire_arrival_s]
    reached_us = {index for _, index in stream}
    return {
        "needers": len(night.world.needers),
        "atRisk": len(at_risk),
        "hazardBeforeWarning": sum(1 for h in at_risk if h.deadline_s <= 0),
        "atRiskReachedDispatch": sum(1 for h in at_risk if h.index in reached_us),
        "atRiskOnTime": len(on_time),
        "atRiskBeforeHazard": len(before),
        "everyoneBoarded": len(boarded),
        "lastBoardingHour": round(float(max(boarded.values(), default=0.0)) / 3600, 2),
    }


def run_one(inputs: CityInputs, seed: int, fleet: int, policy: str) -> dict:
    started = time.perf_counter()
    world = build_city_world(seed, fleet, inputs)
    night, stream = simulate(world, policy, inputs.rule.vans_from_s)
    return {**city_metrics(night, stream), "wallSeconds": round(time.perf_counter() - started, 1)}


def assumptions(inputs: CityInputs) -> list[dict]:
    city, rule = inputs.city, inputs.rule
    rows = [
        ("Households", f"all {len(inputs.records):,} in data/cities/{city['id']}/population.json, none sampled",
         "real ACS household records reweighted to the town's block groups; not real people; see population-meta.json for the census year"),
        ("When the hazard reached a home", f"the first front in public/scenarios/{city['id']}.json that covers it", "the research agents' reconstruction, cited in sources.md"),
        ("Needs a ride", rule.need_rule, "the hazard decides who is at risk at home"),
        ("On time", rule.on_time, rule.on_time_why),
        ("Road closures", rule.closure_rule, rule.closure_why),
        ("Driving", "free-flow OpenStreetMap times on open streets", "no traffic, which flatters both processes"),
        ("Fleet", f"the base mix of six lift vans, a 20-seat bus and an ambulance in every eight, staged at {city['staging']['name']}",
         f"{city['staging']['record']}; {city['staging']['source']}"),
        ("Shelter", f"{city['shelter']['name']}", f"{city['shelter']['record']}; {city['shelter']['source']}"),
        ("Clock", f"calls start at the warning; vans roll {rule.vans_from_s / 60:.0f} min after it", rule.vans_why),
        ("Our calls", "1 call a second in priority order, retries at 2 and 5 min, a text, then 6 door teams", "same as the Eaton run; priority uses the true arrival time, as if the forecast were right"),
        ("Today's process", "55% of those who need a ride call 911 about 20 min before the hazard arrives; 2 call takers per 600 homes; nearest free unit, one rider per trip",
         "a model of today, not the record"),
        ("Call accuracy", "a reached household reports its true need", "optimistic"),
    ]
    if rule.unknown_slack_s > 0:
        rows.append(("What the dispatcher knows", "a home's outage becomes known 30 min after it happens, from the utility's outage feed; until then the dispatcher plans as if the home could wait out the 12-hour no-heat window",
                     "assumption (data/cities/buffalo/sources.md); calls that reach a home after its outage would tell it sooner and aren't credited; the oursBlind row has no outage information at all"))
    return [{"name": n, "value": v, "why": w} for n, v, w in rows]


def per_seed(outputs: list) -> dict:
    """At-risk homes out on time in each seed, so a replay can be drawn from a seed that sits at the median."""
    table: dict = {}
    for fleet, seed, policy, result in sorted(outputs, key=lambda o: (o[0], o[2], o[1])):
        table.setdefault(str(fleet), {}).setdefault(policy, []).append(result["atRiskOnTime"])
    return table


def results_payload(city_id: str, inputs: CityInputs, seeds: int, fleets: list[int], outputs: list, started: float) -> dict:
    grouped = collect([("night", fleet, seed, policy, result) for fleet, seed, policy, result in outputs])["night"]
    return {
        "label": "Simulation on a reconstruction of a past disaster, not a prediction",
        "city": city_id, "name": inputs.city["name"], "event": inputs.city["event"], "hazard": inputs.city["hazard"],
        "warningAt": datetime.fromtimestamp(inputs.warning_at, timezone.utc).isoformat(),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seeds": seeds, "fleets": fleets, "runtimeSeconds": round(time.time() - started),
        "assumptions": assumptions(inputs),
        "metricDefinitions": {
            "atRisk": "Households that need a ride and that the hazard reached",
            "hazardBeforeWarning": "At-risk households whose deadline had already passed when the warning went out",
            "atRiskReachedDispatch": "At-risk households whose request reached a dispatcher before the hazard did",
            "atRiskOnTime": f"At-risk households whose whole party boarded on time ({inputs.rule.on_time})",
            "atRiskBeforeHazard": "At-risk households whose whole party boarded before the hazard reached the home",
            "everyoneBoarded": "Households that need a ride, at risk or not, whose whole party boarded",
        },
        "results": grouped,
        "onTimeBySeed": per_seed(outputs),
        "headline": {fleet: {policy: runs["atRiskOnTime"]["median"] for policy, runs in grouped[fleet].items()} for fleet in grouped},
        "policies": {
            "ours": "our calls and the re-planning dispatcher",
            "today": "today's process: 911 calls shortly before the hazard, nearest free unit, one rider per trip",
            "oursBlind": "our system with no outage information: every home that needs moving looks equally urgent (blizzard only)",
        },
    }


def run_plan(city_id: str, inputs: CityInputs) -> dict:
    """Our system and today's process; where the dispatcher's knowledge is part of the model (the blizzard's outage
    feed), also our system without it, to show what that knowledge is worth."""
    runs = {policy: (inputs, policy) for policy in POLICIES}
    if inputs.rule.unknown_slack_s > 0:
        runs["oursBlind"] = (city_inputs(city_id, informed=False), "ours")
    return runs


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True)
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--fleets", type=int, nargs="*", default=FLEET_SIZES)
    args = parser.parse_args()
    started = time.time()
    inputs = city_inputs(args.city)
    runs = run_plan(args.city, inputs)
    outputs = []
    for fleet in args.fleets:
        for seed in range(args.seeds):
            for label, (run_inputs, policy) in runs.items():
                result = run_one(run_inputs, seed, fleet, policy)
                outputs.append((fleet, seed, label, result))
                print(f"{args.city} fleet {fleet} seed {seed} {label}: {result['atRiskOnTime']} of {result['atRisk']} on time ({result['wallSeconds']} s)", flush=True)
    payload = results_payload(args.city, inputs, args.seeds, args.fleets, outputs, started)
    target = CITIES / args.city / "night-sim-results.json"
    target.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {target}: {json.dumps(payload['headline'])}")


if __name__ == "__main__":
    main()
