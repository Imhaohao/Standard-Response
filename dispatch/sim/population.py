"""Households, ride needs and the fleet.

The stand-in population mirrors convex/seed.ts (block vulnerability, ages, mobility, persona draws).
If data/population.json exists it is used instead. `ride_need_for`, `vehicle_can_serve` and `parties_for`
are ports of convex/model.ts and must stay in step with it.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace

import numpy as np

from .constants import (
    BASE_FLEET_SIZE, BLOCK_GRID, DEADLINE_MARGIN_S, HOUSEHOLD_BOX, MINUTE, POPULATION_FILE,
    VEHICLE_BAND, Config,
)
from .rng import generator
from .roads import RoadNetwork, fire_arrival_minutes

STANDIN_HOUSEHOLDS = 200
WHEELCHAIRS = {"manual_wheelchair", "power_wheelchair"}
ACCESSIBLE_MOBILITY = WHEELCHAIRS | {"bedbound"}


@dataclass(frozen=True)
class RideNeed:
    seats: int
    wheelchair_spaces: int
    stretcher_spaces: int
    crew_needed: int
    needs_lift: bool
    boarding_s: float
    weight: int
    oxygen: bool
    accessible: bool


@dataclass(frozen=True)
class Household:
    index: int
    node: int
    lat: float
    lng: float
    age: int
    answers_phone: float
    replies_to_text: bool
    need_prior: float
    fire_arrival_s: float
    need: RideNeed | None
    has_car: bool = True

    @property
    def deadline_s(self) -> float:
        return self.fire_arrival_s - DEADLINE_MARGIN_S


@dataclass(frozen=True)
class VehicleSpec:
    index: int
    label: str
    seats: int
    wheelchair_spaces: int
    stretcher_spaces: int
    crew_size: int
    lift_capable: bool


def van(index: int, label: str, crew: int) -> VehicleSpec:
    return VehicleSpec(index, label, 4, 2, 0, crew, True)


def base_fleet() -> list[VehicleSpec]:
    return [
        van(0, "Van 12", 2), van(1, "Van 7", 2), van(2, "Van 3", 1), van(3, "Van 4", 1),
        van(4, "Van 9", 2), van(5, "Van 15", 1),
        VehicleSpec(6, "Bus 2", 20, 1, 0, 1, True),
        VehicleSpec(7, "Medic 41", 1, 0, 1, 2, True),
    ]


def extra_vehicles() -> list[VehicleSpec]:
    return [van(8, "Van 21", 2), van(9, "Van 22", 1), van(10, "Van 23", 2), VehicleSpec(11, "Bus 5", 20, 1, 0, 1, True)]


def fleet_of_size(size: int) -> list[VehicleSpec]:
    if size >= BASE_FLEET_SIZE:
        return (base_fleet() + extra_vehicles())[:size]
    mixed_order = [0, 6, 2, 7, 4, 3, 1, 5]
    chosen = [base_fleet()[i] for i in mixed_order[:size]]
    return [VehicleSpec(i, v.label, v.seats, v.wheelchair_spaces, v.stretcher_spaces, v.crew_size, v.lift_capable)
            for i, v in enumerate(chosen)]


def vehicle_can_serve(vehicle: VehicleSpec, need: RideNeed) -> bool:
    return (
        vehicle.seats >= need.seats
        and vehicle.wheelchair_spaces >= need.wheelchair_spaces
        and vehicle.stretcher_spaces >= need.stretcher_spaces
        and vehicle.crew_size >= need.crew_needed
        and (vehicle.lift_capable or not need.needs_lift)
    )


def parties_for(need: RideNeed, fleet: list[VehicleSpec]) -> list[RideNeed]:
    """A household no single vehicle can carry rides as two parties: the person in the stretcher or
    wheelchair space with as many of the household as that vehicle seats, then everyone else in any
    vehicle. Mirrors ridePartiesFor in convex/model.ts."""
    if any(vehicle_can_serve(vehicle, need) for vehicle in fleet):
        return [need]
    carriers = [vehicle for vehicle in fleet if vehicle_can_serve(vehicle, replace(need, seats=0))]
    if not carriers:
        return [need]
    riding_along = min(need.seats, max(vehicle.seats for vehicle in carriers))
    companions = RideNeed(
        seats=need.seats - riding_along, wheelchair_spaces=0, stretcher_spaces=0, crew_needed=1, needs_lift=False,
        boarding_s=boarding_seconds("walks", "none"), weight=1, oxygen=False, accessible=False,
    )
    return [replace(need, seats=riding_along), companions]


def boarding_seconds(mobility: str, assistance: str) -> float:
    if mobility == "bedbound" or assistance == "two_person_lift":
        return 20 * MINUTE
    if mobility in WHEELCHAIRS:
        return 10 * MINUTE
    return 5 * MINUTE if mobility == "walker" else 2 * MINUTE


def outcome_of(truth: dict) -> str:
    if truth["mobility"] in ACCESSIBLE_MOBILITY or "oxygen" in truth["medical"]:
        return "needs_accessible"
    if truth["canLeave"] in ("no", "unsure"):
        return "needs_ride"
    if truth["canLeave"] == "yes" and not truth["hasCar"]:
        return "needs_ride"
    return "leaving"


def ride_need_for(truth: dict) -> RideNeed | None:
    outcome = outcome_of(truth)
    if outcome == "leaving":
        return None
    mobility = truth["mobility"]
    chairs = 1 if mobility in WHEELCHAIRS else 0
    stretchers = 1 if mobility == "bedbound" else 0
    people = max(truth["peopleCount"], 1)
    oxygen = "oxygen" in truth["medical"]
    return RideNeed(
        seats=max(people - chairs - stretchers, 0),
        wheelchair_spaces=chairs,
        stretcher_spaces=stretchers,
        crew_needed=2 if truth["assistanceRequired"] == "two_person_lift" else 1,
        needs_lift=chairs + stretchers > 0,
        boarding_s=boarding_seconds(mobility, truth["assistanceRequired"]),
        weight=(3 if outcome == "needs_accessible" else 1) + (1 if oxygen else 0),
        oxygen=oxygen,
        accessible=mobility in ACCESSIBLE_MOBILITY,
    )


def sample_mobility(rng: np.random.Generator, age: int, vulnerability: float) -> str:
    roll = rng.random() / (0.4 + vulnerability)
    thresholds = [(78, 0.08, "bedbound"), (70, 0.2, "manual_wheelchair"), (65, 0.28, "power_wheelchair"), (60, 0.55, "walker")]
    for minimum_age, limit, mobility in thresholds:
        if age > minimum_age and roll < limit:
            return mobility
    return "walks"


def sample_assistance(rng: np.random.Generator, mobility: str) -> str:
    if mobility == "bedbound":
        return "two_person_lift"
    if mobility == "walks":
        return "none"
    return "one_person_assist" if rng.random() < 0.3 else "none"


def sample_truth(rng: np.random.Generator, age: int, vulnerability: float) -> dict:
    mobility = sample_mobility(rng, age, vulnerability)
    oxygen = age > 68 and rng.random() < 0.12
    has_car = bool(rng.random() > vulnerability * 0.9)
    limited = mobility != "walks" or oxygen
    if limited:
        can_leave = "no" if rng.random() < 0.7 else "unsure"
    else:
        can_leave = "yes" if has_car else "no"
    people = 1 if age > 75 and rng.random() < 0.6 else 1 + int(rng.integers(0, 4))
    medical = ["oxygen"] if oxygen else (["dialysis"] if rng.random() < 0.04 else [])
    return {"canLeave": can_leave, "peopleCount": people, "mobility": mobility,
            "assistanceRequired": sample_assistance(rng, mobility), "medical": medical, "hasCar": has_car}


def block_of(lat: float, lng: float) -> int:
    box = HOUSEHOLD_BOX
    row = min(BLOCK_GRID - 1, int((lat - box["south"]) / (box["north"] - box["south"]) * BLOCK_GRID))
    col = min(BLOCK_GRID - 1, int((lng - box["west"]) / (box["east"] - box["west"]) * BLOCK_GRID))
    return max(0, row) * BLOCK_GRID + max(0, col)


def build_household(index: int, node: int, net: RoadNetwork, traits: dict, config: Config) -> Household:
    lat, lng = (float(x) for x in net.coordinates[node])
    answers = float(np.clip(traits["answersPhone"] * config.answer_scale, 0.0, 0.99))
    return Household(
        index=index, node=node, lat=lat, lng=lng, age=traits["age"], answers_phone=answers,
        replies_to_text=traits["repliesToText"], need_prior=traits["needPrior"],
        fire_arrival_s=fire_arrival_minutes(lat, lng) * MINUTE * config.hazard_scale,
        need=ride_need_for(traits["truth"]), has_car=bool(traits["truth"]["hasCar"]),
    )


def standin_traits(rng: np.random.Generator, vulnerability: float) -> dict:
    age = int(round(28 + rng.random() * 40 + vulnerability * 50))
    need_prior = float(np.clip(vulnerability + (rng.random() - 0.5) * 0.12, 0.03, 0.95))
    answers = 0.55 + rng.random() * 0.4 - (0.15 if age > 80 else 0.0)
    return {"age": age, "needPrior": need_prior, "answersPhone": answers,
            "repliesToText": bool(rng.random() < 0.45), "truth": sample_truth(rng, age, vulnerability)}


def standin_population(seed: int, net: RoadNetwork, config: Config) -> list[Household]:
    rng = generator(seed, "population")
    candidates = net.nodes_in_box(HOUSEHOLD_BOX)
    nodes = rng.choice(candidates, size=min(config.households, STANDIN_HOUSEHOLDS, len(candidates)), replace=False)
    block_vulnerability = 0.08 + rng.random(BLOCK_GRID * BLOCK_GRID) * 0.5
    households = []
    for index, node in enumerate(nodes):
        lat, lng = net.coordinates[node]
        traits = standin_traits(rng, float(block_vulnerability[block_of(lat, lng)]))
        households.append(build_household(index, int(node), net, traits, config))
    return households


def file_traits(record: dict, rng: np.random.Generator) -> dict:
    age = int(record["age"])
    prior = float(np.clip(0.05 + max(age - 50, 0) / 100 + (rng.random() - 0.5) * 0.1, 0.03, 0.95))
    truth = {key: record[key] for key in ("canLeave", "peopleCount", "mobility", "assistanceRequired", "medical", "hasCar")}
    return {"age": age, "needPrior": prior, "answersPhone": float(record["answersPhone"]),
            "repliesToText": bool(rng.random() < 0.45), "truth": truth}


def file_population(seed: int, net: RoadNetwork, config: Config) -> list[Household]:
    """Each seed draws `config.households` households from the synthetic population (all of them if fewer)."""
    records = json.loads(POPULATION_FILE.read_text())
    rng = generator(seed, "population")
    count = min(config.households, len(records))
    chosen = sorted(int(i) for i in rng.choice(len(records), size=count, replace=False))
    return [build_household(i, net.snap(records[j]["lat"], records[j]["lng"]), net, file_traits(records[j], rng), config)
            for i, j in enumerate(chosen)]


def population_source() -> str:
    if POPULATION_FILE.exists():
        return "data/population.json (synthetic population; each seed samples a subset)"
    return "stand-in generated from convex/seed.ts distributions"


def make_population(seed: int, net: RoadNetwork, config: Config) -> list[Household]:
    if POPULATION_FILE.exists():
        return file_population(seed, net, config)
    return standin_population(seed, net, config)


def vehicle_start_nodes(seed: int, net: RoadNetwork, count: int) -> list[int]:
    rng = generator(seed, "fleet")
    band = VEHICLE_BAND
    points = zip(rng.uniform(band["south"], band["north"], count), rng.uniform(band["west"], band["east"], count))
    return [net.snap(float(lat), float(lng)) for lat, lng in points]
