"""The night of January 7, 2025 in west Altadena, at full scale.

Every household in the synthetic population is in the zone; nobody is sampled. When fire reached each
home comes from the record, not a made-up front: the 911, dispatch and radio sightings in the UL FSRI
timeline (data/eaton/replay-results.json) say when fire was first reported near it, and CAL FIRE's damage
inspections (data/eaton/dins-eaton.json) say whether it reached the home at all. No public perimeter covers
the hours west Altadena burned, so nothing here is interpolated from one.

The clock starts when calling starts: at the real 3:25 a.m. order, or at 10:50 p.m., the first fire
reported west of Lake Avenue. Vans stage at the Rose Bowl and roll when AccessLA was ready (4 a.m.), or at
the trigger. Command line: uv run python -m sim.eaton_night --seeds 5
"""

from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import time
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

import numpy as np
import simpy

from .constants import CALL_TAKERS, POPULATION_FILE, REPO, SHELTER, Config
from .engine import SOLVERS
from .fleetstate import Night
from .aggregate import summarize
from .metrics import boarded_at
from .optimizer_policy import OptimizerPolicy
from .population import Household, VehicleSpec, base_fleet, file_traits, ride_need_for
from .rng import generator
from .roads import TravelTimes, network
from .streams import emergency_stream, outreach_stream
from .today_policy import TodayPolicy
from .world import World

PACIFIC = timezone(timedelta(hours=-8))
EATON = REPO / "data" / "eaton"
RESULTS_FILE = EATON / "night-sim-results.json"
NIGHT_END = datetime(2025, 1, 8, 12, 0, tzinfo=PACIFIC)
STAGING = {"name": "Rose Bowl incident command post", "lat": 34.1613, "lng": -118.1676}

# A home's fire time is the first sighting within the near radius, else within the far one.
FIRE_NEAR_M, FIRE_FAR_M = 250.0, 500.0
ROAD_FIRE_M = 150.0
HOME_DAMAGE_M, DESTROYED_NEARBY_M = 40.0, 100.0
DESTROYED = 4
METERS_PER_DEGREE_LAT = 110_540.0
METERS_PER_DEGREE_LNG = 111_320.0 * math.cos(math.radians(34.18))

SCENARIOS = {
    "order325": {"label": "Calls start at the real 3:25 a.m. order; AccessLA rolls at 4 a.m.",
                 "callsStart": datetime(2025, 1, 8, 3, 25, tzinfo=PACIFIC), "vansFrom": datetime(2025, 1, 8, 4, 0, tzinfo=PACIFIC)},
    "firstFireWest": {"label": "Calls and vans start at 10:50 p.m., the first fire reported west of Lake",
                      "callsStart": datetime(2025, 1, 7, 22, 50, tzinfo=PACIFIC), "vansFrom": datetime(2025, 1, 7, 22, 50, tzinfo=PACIFIC)},
}
FLEET_SIZES = [8, 25, 50, 100]
POLICIES = {"ours": ("outreach", "alns"), "today": ("emergency", "today")}
# The sampled simulator gives 600 homes 2 call takers; the whole area gets the same ratio.
SAMPLED_HOUSEHOLDS = 600


def metric_xy(lat, lng) -> np.ndarray:
    return np.column_stack([np.asarray(lng) * METERS_PER_DEGREE_LNG, np.asarray(lat) * METERS_PER_DEGREE_LAT])


def nearest(points: np.ndarray, targets: np.ndarray, chunk: int = 400) -> tuple[np.ndarray, np.ndarray]:
    """Distance to, and index of, the nearest target for each point."""
    distance, index = np.empty(len(points)), np.empty(len(points), dtype=int)
    for start in range(0, len(points), chunk):
        block = np.hypot(points[start:start + chunk, None, 0] - targets[None, :, 0], points[start:start + chunk, None, 1] - targets[None, :, 1])
        index[start:start + chunk] = block.argmin(1)
        distance[start:start + chunk] = block.min(1)
    return distance, index


class FireRecord:
    """Where and when fire was documented that night, and which structures it damaged."""

    def __init__(self):
        sightings = json.loads((EATON / "replay-results.json").read_text())["fireSightings"]
        self.sighting_xy = metric_xy([s["lat"] for s in sightings], [s["lng"] for s in sightings])
        self.sighting_at = np.array([datetime.fromisoformat(s["at"]).replace(tzinfo=PACIFIC).timestamp() for s in sightings])
        dins = json.loads((EATON / "dins-eaton.json").read_text())["points"]
        self.structure_xy = metric_xy([p[0] for p in dins], [p[1] for p in dins])
        self.damage = np.array([p[2] for p in dins])

    def first_within(self, xy: np.ndarray, radius: float) -> np.ndarray:
        out = np.full(len(xy), np.inf)
        for start in range(0, len(xy), 400):
            block = np.hypot(xy[start:start + 400, None, 0] - self.sighting_xy[None, :, 0], xy[start:start + 400, None, 1] - self.sighting_xy[None, :, 1])
            out[start:start + 400] = np.where(block <= radius, self.sighting_at[None, :], np.inf).min(1)
        return out

    def fire_nearby_at(self, xy: np.ndarray) -> np.ndarray:
        near = self.first_within(xy, FIRE_NEAR_M)
        return np.where(np.isfinite(near), near, self.first_within(xy, FIRE_FAR_M))

    def reached(self, xy: np.ndarray) -> np.ndarray:
        distance, index = nearest(xy, self.structure_xy)
        damaged_here = (distance <= HOME_DAMAGE_M) & (self.damage[index] >= 1)
        to_destroyed, _ = nearest(xy, self.structure_xy[self.damage >= DESTROYED])
        return damaged_here | (to_destroyed <= DESTROYED_NEARBY_M)


@dataclass(frozen=True)
class HomeFire:
    """When fire was first reported near each home (epoch seconds, inf when never), and whether it reached it."""
    fire_at: np.ndarray
    reached: np.ndarray


def home_fire(records: list[dict], fire: FireRecord) -> HomeFire:
    xy = metric_xy([r["lat"] for r in records], [r["lng"] for r in records])
    return HomeFire(fire.fire_nearby_at(xy), fire.reached(xy))


def scaled_fleet(size: int) -> list[VehicleSpec]:
    """The base fleet's mix (six vans, a bus, an ambulance in every eight), repeated to the size asked for."""
    mix = base_fleet()
    return [replace(mix[i % len(mix)], index=i, label=f"{mix[i % len(mix)].label}-{i // len(mix) + 1}") for i in range(size)]


def household_for(index: int, record: dict, node: int, fire_at: float, reached: bool, trigger: float, rng) -> Household:
    traits = file_traits(record, rng)
    at_risk = bool(reached and math.isfinite(fire_at))
    arrival = fire_at if at_risk else NIGHT_END.timestamp()
    return Household(
        index=index, node=node, lat=record["lat"], lng=record["lng"], age=traits["age"],
        answers_phone=float(np.clip(traits["answersPhone"], 0.0, 0.99)), replies_to_text=traits["repliesToText"],
        need_prior=traits["needPrior"], fire_arrival_s=arrival - trigger, need=ride_need_for(traits["truth"]),
        has_car=bool(record["hasCar"]), at_risk=at_risk,
    )


def road_closures(fire: FireRecord, trigger: float) -> np.ndarray:
    """Seconds after the trigger when fire was reported within a short walk of each street's midpoint."""
    net = network()
    midpoints = net.edge_midpoints()
    closes = fire.first_within(metric_xy(midpoints[:, 0], midpoints[:, 1]), ROAD_FIRE_M)
    return closes - trigger


def build_night_world(seed: int, scenario: str, fleet_size: int, inputs: dict) -> World:
    trigger = SCENARIOS[scenario]["callsStart"].timestamp()
    net = network()
    rng = generator(seed, "population")
    records, fire = inputs["records"], inputs["homeFire"]
    nodes = inputs["nodes"]
    households = [household_for(i, r, nodes[i], fire.fire_at[i], fire.reached[i], trigger, rng) for i, r in enumerate(records)]
    fleet = scaled_fleet(fleet_size)
    staging = net.snap(STAGING["lat"], STAGING["lng"])
    shelter = net.snap(SHELTER["lat"], SHELTER["lng"])
    sources = [h.node for h in households] + [staging, shelter]
    travel = TravelTimes(sources, 1.0, inputs["closures"][scenario])
    takers = max(CALL_TAKERS, round(CALL_TAKERS * len(households) / SAMPLED_HOUSEHOLDS))
    config = Config(fleet_size=fleet_size, households=len(households), call_takers=takers)
    return World(seed, config, net, households, fleet, [staging] * fleet_size, shelter, travel)


def hold_vehicles(night: Night, until_s: float, on_release):
    """Vans are out of reach until they roll; the dispatcher sees them as busy until then."""
    for vehicle in night.vehicles:
        vehicle.busy = True
    yield night.env.timeout(max(until_s, 0.0))
    for vehicle in night.vehicles:
        vehicle.busy = False
        vehicle.free_at = night.env.now
    night.vehicle_freed = True
    on_release()


def run_night(world: World, policy: str, vans_from_s: float) -> dict:
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
    return night_metrics(night, stream)


def night_metrics(night: Night, stream) -> dict:
    boarded = boarded_at(night)
    at_risk = [h for h in night.world.needers if h.at_risk]
    on_time = [h for h in at_risk if h.index in boarded and boarded[h.index] <= h.deadline_s]
    before_fire = [h for h in at_risk if h.index in boarded and boarded[h.index] <= h.fire_arrival_s]
    reached_us = {index for _, index in stream}
    return {
        "needers": len(night.world.needers),
        "atRisk": len(at_risk),
        "fireBeforeCallsStart": sum(1 for h in at_risk if h.fire_arrival_s <= 0),
        "atRiskReachedDispatch": sum(1 for h in at_risk if h.index in reached_us),
        "atRiskOnTime": len(on_time),
        "atRiskBeforeFire": len(before_fire),
        "everyoneBoardedByNoon": len(boarded),
        "lastBoardingHour": round(float(max(boarded.values(), default=0.0)) / 3600, 2),
    }


def night_task(task):
    scenario, fleet_size, seed, policy, inputs = task
    started = time.perf_counter()
    world = build_night_world(seed, scenario, fleet_size, inputs)
    vans_from = SCENARIOS[scenario]["vansFrom"].timestamp() - SCENARIOS[scenario]["callsStart"].timestamp()
    result = run_night(world, policy, vans_from)
    return scenario, fleet_size, seed, policy, {**result, "wallSeconds": round(time.perf_counter() - started, 1)}


def shared_inputs() -> dict:
    records = json.loads(POPULATION_FILE.read_text())
    fire = FireRecord()
    net = network()
    closures = {name: road_closures(fire, s["callsStart"].timestamp()) for name, s in SCENARIOS.items()}
    return {
        "records": records,
        "nodes": [net.snap(r["lat"], r["lng"]) for r in records],
        "homeFire": home_fire(records, fire),
        "closures": closures,
    }


ASSUMPTIONS = [
    ("Households", "all 11,855 in data/population.json, none sampled", "real ACS household records reweighted to west Altadena's block groups; not real people"),
    ("Fire reached a home", f"its nearest inspected structure within {HOME_DAMAGE_M:.0f} m was damaged, or a destroyed one stood within {DESTROYED_NEARBY_M:.0f} m", "CAL FIRE DINS; homes it never reached still need a ride, by noon"),
    ("When fire reached it", f"the first fire sighting in the FSRI timeline within {FIRE_NEAR_M:.0f} m, else within {FIRE_FAR_M:.0f} m", "a first report comes after the fire arrives, so every deadline here is a little late, which flatters both processes"),
    ("Deadline", "fire nearby minus 10 min", "same margin as the live dispatcher"),
    ("Road closures", f"a street closes for good when fire is reported within {ROAD_FIRE_M:.0f} m of its midpoint", "no public log of which streets closed when"),
    ("Driving", "free-flow OpenStreetMap times on open streets", "no traffic: the roads were jammed in places, so this flatters both processes"),
    ("Fleet", "the base mix of six lift vans, a 20-seat bus and an ambulance in every eight, staged at the Rose Bowl", "AccessLA alone had more than 1,800 vehicles countywide; how many could have come to Altadena is unknown, so it is swept"),
    ("Our calls", "1 call a second in priority order, retries at 2 and 5 min, a text, then 6 door teams", "same as the sampled simulator; priority uses the true fire time, as if the hazard forecast were right. Calling in need order alone moved one seed from 641 to 633 on time (10:50 p.m., 25 vans) and from 356 to 337 (3:25 a.m., 50 vans)"),
    ("Today's process", "55% of those who need a ride call 911 about 20 min before fire arrives; 2 call takers per 600 homes (40 here); nearest free unit, one rider per trip", "a model of today, not the record; on the real night AccessLA was never called"),
    ("Call accuracy", "a reached household reports its true need", "optimistic"),
]


def collect(outputs: list) -> dict:
    grouped: dict = {}
    for scenario, fleet_size, _, policy, result in outputs:
        grouped.setdefault(scenario, {}).setdefault(str(fleet_size), {}).setdefault(policy, []).append(result)
    return {
        scenario: {
            fleet: {policy: {metric: summarize([r[metric] for r in runs]) for metric in runs[0]} for policy, runs in policies.items()}
            for fleet, policies in fleets.items()
        }
        for scenario, fleets in grouped.items()
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--fleets", type=int, nargs="*", default=FLEET_SIZES)
    parser.add_argument("--workers", type=int, default=max(1, mp.cpu_count() - 1))
    args = parser.parse_args()
    started = time.time()
    inputs = shared_inputs()
    tasks = [(scenario, fleet, seed, policy, inputs) for scenario in SCENARIOS for fleet in args.fleets
             for seed in range(args.seeds) for policy in POLICIES]
    with mp.get_context("spawn").Pool(args.workers) as pool:
        outputs = list(pool.imap_unordered(night_task, tasks, chunksize=1))
    results = {
        "label": "Simulation on the real night's fire record, not a prediction",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "seeds": args.seeds,
        "runtimeSeconds": round(time.time() - started),
        "scenarios": {name: {"label": s["label"], "callsStart": s["callsStart"].isoformat(), "vansFrom": s["vansFrom"].isoformat()} for name, s in SCENARIOS.items()},
        "assumptions": [{"name": n, "value": v, "why": w} for n, v, w in ASSUMPTIONS],
        "metricDefinitions": {
            "atRisk": "Households that need a ride and that the fire reached, with a time on record",
            "fireBeforeCallsStart": "At-risk households with fire already reported nearby when calling began",
            "atRiskReachedDispatch": "At-risk households whose request reached a dispatcher before the fire did",
            "atRiskOnTime": "At-risk households whose whole party boarded by the deadline (fire nearby minus 10 min)",
            "atRiskBeforeFire": "At-risk households whose whole party boarded before fire was reported nearby",
            "everyoneBoardedByNoon": "Households that need a ride, at risk or not, whose whole party boarded",
        },
        "results": collect(outputs),
    }
    RESULTS_FILE.write_text(json.dumps(results, indent=2) + "\n")
    print(f"wrote {RESULTS_FILE} in {results['runtimeSeconds']}s")


if __name__ == "__main__":
    main()
