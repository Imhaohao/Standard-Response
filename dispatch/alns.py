"""Adaptive large neighborhood search for evacuation pickups: the third dispatcher next to the
competent heuristic (heuristic.py) and OR-Tools (solver.py). Same problem in, same routes out.

It starts from the heuristic's plan and keeps the best plan it has seen, so on its own objective it
never does worse than the heuristic. Each round removes a few riders from the plan (destroy) and
puts them back where they cost least (repair). Operators that find better plans are picked more often.

A vehicle's plan is a list of trips, and a trip is pickups in order followed by one shelter, the same
shape heuristic.py builds. Every new stop comes after the vehicle's accepted run, because the problem
already starts each vehicle where and when that run ends (see solver.py).

The objective is the one solver.py prices: expected deaths (dispatch/fatality.py), then rider waiting
weighted by need, then vehicle time, plus the cost of moving an open offer to another vehicle.
"""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

import heuristic
from fatality import RAMP_SECONDS
from solver import (
    CAPACITY_FIELDS,
    CHANGED_OFFER_COST,
    UNLOAD_SECONDS,
    WAIT_COST_PER_WEIGHT_SECOND,
    drop_penalty,
    empty_result,
    worst_case_cost,
)

SEGMENT_ROUNDS = 25
REACTION = 0.2
SCORE_NEW_BEST, SCORE_BETTER, SCORE_ACCEPTED = 33.0, 9.0, 13.0
START_WORSENING_SHARE = 0.05  # a plan this much worse is accepted half the time at the start
END_TEMPERATURE_SHARE = 0.001
WORST_REMOVAL_BIAS = 3
RELATED_REMOVAL_BIAS = 6
MAX_REMOVED_SHARE = 0.3


class Rules:
    """The problem, indexed once, with the cost of each rider and each vehicle's plan."""

    def __init__(self, problem: dict):
        self.matrix = problem["matrix"]
        self.vehicles = problem["vehicles"]
        self.requests = problem["requests"]
        self.shelters = problem["shelters"]
        self.people = [heuristic.people(r) for r in self.requests]
        self.loads = [tuple(int(r["load"][f]) for f in CAPACITY_FIELDS) for r in self.requests]
        self.capacities = [tuple(int(v[f]) for f in CAPACITY_FIELDS) for v in self.vehicles]
        self.worst = [worst_case_cost(r) for r in self.requests]
        self.unserved = [drop_penalty(r) for r in self.requests]
        self.index_of = {r["id"]: i for i, r in enumerate(self.requests)}

    def seconds(self, a: int, b: int) -> float | None:
        return self.matrix[a][b]

    def rider_cost(self, r: int, arrival: float, k: int) -> float:
        """Cost of reaching rider r's door at `arrival` on vehicle k. Boarding after the fire arrives
        saves nobody, so it costs as much as not coming."""
        request = self.requests[r]
        late = arrival + request["boardingSeconds"] - request["deadline"]
        if late >= RAMP_SECONDS:
            return self.unserved[r]
        cost = self.worst[r] * max(0.0, late) / RAMP_SECONDS + WAIT_COST_PER_WEIGHT_SECOND * request["weight"] * arrival
        open_vehicle = request.get("openOfferVehicle")
        if open_vehicle is not None and open_vehicle != k:
            cost += CHANGED_OFFER_COST
        return cost

    def plan_cost(self, k: int, trips: list[Trip]) -> float | None:
        """Total cost of vehicle k driving `trips`, or None if the plan breaks a rule."""
        drive = Drive(self, k)
        for trip in trips:
            if not drive.run(trip):
                return None
        return drive.cost + drive.time - self.vehicles[k]["availableAt"]

    def stops(self, k: int, trips: list[Trip]) -> list[dict]:
        drive = Drive(self, k, record=True)
        for trip in trips:
            drive.run(trip)
        return drive.stops


@dataclass
class Trip:
    riders: list[int]
    shelter: int


class Drive:
    """Walks one vehicle through its trips, adding up cost and checking every rule on the way."""

    def __init__(self, rules: Rules, k: int, record: bool = False):
        self.rules, self.k = rules, k
        vehicle = rules.vehicles[k]
        self.location, self.time, self.end_by = vehicle["location"], vehicle["availableAt"], vehicle["endBy"]
        self.cost = 0.0
        self.stops: list[dict] | None = [] if record else None

    def run(self, trip: Trip) -> bool:
        if not self._fits(trip):
            return False
        aboard = []
        for r in trip.riders:
            if not self._pick_up(r):
                return False
            aboard.append((r, self.time - self.rules.requests[r]["boardingSeconds"]))
        return self._drop_off(trip.shelter, aboard)

    def _fits(self, trip: Trip) -> bool:
        totals = [sum(self.rules.loads[r][f] for r in trip.riders) for f in range(len(CAPACITY_FIELDS))]
        return all(total <= limit for total, limit in zip(totals, self.rules.capacities[self.k]))

    def _pick_up(self, r: int) -> bool:
        request = self.rules.requests[r]
        seconds = self.rules.seconds(self.location, request["location"])
        if seconds is None or self.time + seconds > self.end_by:
            return False
        arrival = self.time + seconds
        self.cost += self.rules.rider_cost(r, arrival, self.k)
        self._record(r, "pickup", None, arrival)
        self.location, self.time = request["location"], arrival + request["boardingSeconds"]
        return True

    def _drop_off(self, s: int, aboard: list[tuple[int, float]]) -> bool:
        shelter = self.rules.shelters[s]
        seconds = self.rules.seconds(self.location, shelter["location"])
        if seconds is None:
            return False
        self.time += seconds
        for r, picked_up in aboard:
            max_ride = self.rules.requests[r].get("maxRideSeconds")
            # A rider alone goes straight to the shelter, the shortest ride there is; heuristic.py
            # allows it too. The limit stops pooling detours.
            if max_ride is not None and len(aboard) > 1 and self.time - picked_up > max_ride:
                return False
            self._record(r, "dropoff", shelter["id"], self.time)
        self.location, self.time = shelter["location"], self.time + UNLOAD_SECONDS
        return True

    def _record(self, r: int, kind: str, shelter_id, arrival: float):
        if self.stops is not None:
            self.stops.append({"request": self.rules.requests[r]["id"], "kind": kind, "shelter": shelter_id, "arrival": arrival})


@dataclass
class Plan:
    trips: list[list[Trip]]
    costs: list[float]
    unassigned: set[int]
    room: list[int]
    total: float = field(init=False)

    def __post_init__(self):
        self.total = 0.0

    def copy(self) -> Plan:
        trips = [[Trip(list(t.riders), t.shelter) for t in vehicle] for vehicle in self.trips]
        plan = Plan(trips, list(self.costs), set(self.unassigned), list(self.room))
        plan.total = self.total
        return plan

    def assigned(self) -> list[int]:
        return [r for vehicle in self.trips for trip in vehicle for r in trip.riders]


def refresh_total(rules: Rules, plan: Plan):
    plan.total = sum(plan.costs) + sum(rules.unserved[r] for r in plan.unassigned)


def plan_from_heuristic(rules: Rules, problem: dict) -> Plan:
    start = heuristic.solve(problem)
    request_index = rules.index_of
    shelter_index = {s["id"]: i for i, s in enumerate(rules.shelters)}
    trips = [trips_from_stops(route["stops"], request_index, shelter_index) for route in start["routes"]]
    room = [int(s["capacity"]) for s in rules.shelters]
    for vehicle in trips:
        for trip in vehicle:
            room[trip.shelter] -= sum(rules.people[r] for r in trip.riders)
    unassigned = {request_index[i] for i in start["dropped"]}
    costs = [rules.plan_cost(k, vehicle) for k, vehicle in enumerate(trips)]
    plan = Plan(trips, [math.inf if c is None else c for c in costs], unassigned, room)
    refresh_total(rules, plan)
    return plan


def trips_from_stops(stops: list[dict], request_index: dict, shelter_index: dict) -> list[Trip]:
    trips, riders = [], []
    for stop in stops:
        if stop["kind"] == "pickup":
            riders.append(request_index[stop["request"]])
        elif riders:
            trips.append(Trip(riders, shelter_index[stop["shelter"]]))
            riders = []
    return trips


# Destroy: each takes riders out of the plan and returns them.


def remove_riders(rules: Rules, plan: Plan, riders: set[int]):
    for k, vehicle in enumerate(plan.trips):
        touched = False
        for trip in vehicle:
            kept = [r for r in trip.riders if r not in riders]
            if len(kept) != len(trip.riders):
                plan.room[trip.shelter] += sum(rules.people[r] for r in trip.riders if r in riders)
                trip.riders, touched = kept, True
        if touched:
            plan.trips[k] = [t for t in vehicle if t.riders]
            cost = rules.plan_cost(k, plan.trips[k])
            plan.costs[k] = math.inf if cost is None else cost
    plan.unassigned |= riders


def random_removal(rules: Rules, plan: Plan, count: int, rng: random.Random) -> set[int]:
    return set(rng.sample(plan.assigned(), count))


def rider_costs(rules: Rules, plan: Plan) -> dict[int, float]:
    costs = {}
    for k, vehicle in enumerate(plan.trips):
        for stop in rules.stops(k, vehicle):
            if stop["kind"] == "pickup":
                r = rules.index_of[stop["request"]]
                costs[r] = rules.rider_cost(r, stop["arrival"], k)
    return costs


def worst_removal(rules: Rules, plan: Plan, count: int, rng: random.Random) -> set[int]:
    costs = rider_costs(rules, plan)
    ranked = sorted(costs, key=costs.get, reverse=True)
    return biased_pick(ranked, count, WORST_REMOVAL_BIAS, rng)


def related_removal(rules: Rules, plan: Plan, count: int, rng: random.Random) -> set[int]:
    """Riders close in place and deadline, so a repair can swap them between vehicles."""
    assigned = plan.assigned()
    seed = rng.choice(assigned)
    ranked = sorted((r for r in assigned if r != seed), key=lambda r: relatedness(rules, seed, r))
    return {seed} | biased_pick(ranked, count - 1, RELATED_REMOVAL_BIAS, rng)


def relatedness(rules: Rules, a: int, b: int) -> float:
    first, second = rules.requests[a], rules.requests[b]
    seconds = rules.seconds(first["location"], second["location"])
    distance = 4 * 3600 if seconds is None else seconds
    return distance + abs(first["deadline"] - second["deadline"])


def trip_removal(rules: Rules, plan: Plan, count: int, rng: random.Random) -> set[int]:
    trips = [trip for vehicle in plan.trips for trip in vehicle]
    return set(rng.choice(trips).riders)


def biased_pick(ranked: list[int], count: int, bias: int, rng: random.Random) -> set[int]:
    """Mostly from the front of `ranked`, with some randomness so repeated rounds differ."""
    pool, picked = list(ranked), set()
    while pool and len(picked) < count:
        picked.add(pool.pop(int(len(pool) * rng.random() ** bias)))
    return picked


DESTROY = [random_removal, worst_removal, related_removal, trip_removal]


# Repair: put unassigned riders back where they cost least.


@dataclass
class Insertion:
    delta: float
    rider: int
    vehicle: int
    trips: list[Trip]
    shelter: int


def vehicle_insertions(rules: Rules, plan: Plan, r: int, k: int) -> Insertion | None:
    """Cheapest place for rider r on vehicle k: inside an existing trip, or as a new trip."""
    best = None
    for trips, s in candidate_plans(rules, plan, r, k):
        cost = rules.plan_cost(k, trips)
        if cost is not None and (best is None or cost - plan.costs[k] < best.delta):
            best = Insertion(cost - plan.costs[k], r, k, trips, s)
    return best


def candidate_plans(rules: Rules, plan: Plan, r: int, k: int):
    vehicle, party = plan.trips[k], rules.people[r]
    for i, trip in enumerate(vehicle):
        if plan.room[trip.shelter] < party:
            continue
        for p in range(len(trip.riders) + 1):
            changed = Trip(trip.riders[:p] + [r] + trip.riders[p:], trip.shelter)
            yield vehicle[:i] + [changed] + vehicle[i + 1:], trip.shelter
    s = nearest_shelter_with_room(rules, plan, r)
    if s is not None:
        for i in range(len(vehicle) + 1):
            yield vehicle[:i] + [Trip([r], s)] + vehicle[i:], s


def nearest_shelter_with_room(rules: Rules, plan: Plan, r: int) -> int | None:
    location, best = rules.requests[r]["location"], None
    for s, shelter in enumerate(rules.shelters):
        seconds = rules.seconds(location, shelter["location"])
        if seconds is not None and plan.room[s] >= rules.people[r] and (best is None or seconds < best[1]):
            best = (s, seconds)
    return None if best is None else best[0]


def options_for(rules: Rules, plan: Plan, r: int) -> list[Insertion]:
    options = []
    for k in rules.requests[r]["allowedVehicles"]:
        if math.isfinite(plan.costs[k]):
            option = vehicle_insertions(rules, plan, r, k)
            if option is not None and option.delta < rules.unserved[r]:
                options.append(option)
    return sorted(options, key=lambda o: o.delta)


def greedy_choice(options: dict[int, list[Insertion]]) -> Insertion | None:
    firsts = [o[0] for o in options.values() if o]
    return min(firsts, key=lambda o: o.delta, default=None)


def regret_choice(options: dict[int, list[Insertion]]) -> Insertion | None:
    """The rider who loses most by waiting goes first: one with a single vehicle left goes before all."""

    def regret(o: list[Insertion]) -> tuple[float, float]:
        second = o[1].delta if len(o) > 1 else math.inf
        return second - o[0].delta, -o[0].delta

    candidates = [o for o in options.values() if o]
    return max(candidates, key=regret)[0] if candidates else None


def repair(rules: Rules, plan: Plan, choose):
    options = {r: options_for(rules, plan, r) for r in plan.unassigned}
    while True:
        chosen = choose(options)
        if chosen is None:
            return
        if plan.room[chosen.shelter] < rules.people[chosen.rider]:
            options[chosen.rider] = options_for(rules, plan, chosen.rider)
            continue
        apply_insertion(rules, plan, chosen)
        del options[chosen.rider]
        for r in options:
            options[r] = refreshed_options(rules, plan, r, options[r], chosen.vehicle)


def apply_insertion(rules: Rules, plan: Plan, chosen: Insertion):
    plan.trips[chosen.vehicle] = chosen.trips
    plan.costs[chosen.vehicle] += chosen.delta
    plan.room[chosen.shelter] -= rules.people[chosen.rider]
    plan.unassigned.discard(chosen.rider)


def refreshed_options(rules: Rules, plan: Plan, r: int, options: list[Insertion], changed: int) -> list[Insertion]:
    """Only the vehicle that just changed needs recomputing; the others' options still hold."""
    kept = [o for o in options if o.vehicle != changed]
    if changed in rules.requests[r]["allowedVehicles"] and math.isfinite(plan.costs[changed]):
        option = vehicle_insertions(rules, plan, r, changed)
        if option is not None and option.delta < rules.unserved[r]:
            kept.append(option)
    return sorted(kept, key=lambda o: o.delta)


REPAIR = [greedy_choice, regret_choice]


# The search loop.


class Weights:
    """Roulette-wheel operator choice; operators that find better plans get picked more often."""

    def __init__(self, count: int):
        self.weights = [1.0] * count
        self.scores = [0.0] * count
        self.uses = [0] * count

    def pick(self, rng: random.Random) -> int:
        return rng.choices(range(len(self.weights)), weights=self.weights)[0]

    def reward(self, i: int, score: float):
        self.scores[i] += score
        self.uses[i] += 1

    def update(self):
        for i, uses in enumerate(self.uses):
            if uses:
                self.weights[i] = (1 - REACTION) * self.weights[i] + REACTION * self.scores[i] / uses
        self.scores = [0.0] * len(self.weights)
        self.uses = [0] * len(self.weights)


@dataclass
class Search:
    rules: Rules
    current: Plan
    best: Plan
    rng: random.Random
    started: float
    limit: float
    start_temperature: float
    destroy: Weights = field(default_factory=lambda: Weights(len(DESTROY)))
    fix: Weights = field(default_factory=lambda: Weights(len(REPAIR)))
    rounds: int = 0

    def temperature(self) -> float:
        progress = min(1.0, (time.perf_counter() - self.started) / self.limit)
        return self.start_temperature * END_TEMPERATURE_SHARE**progress

    def round(self):
        assigned = len(self.current.assigned())
        d, f = self.destroy.pick(self.rng), self.fix.pick(self.rng)
        count = self.rng.randint(1, max(1, min(assigned, round(MAX_REMOVED_SHARE * assigned))))
        trial = self.current.copy()
        remove_riders(self.rules, trial, DESTROY[d](self.rules, trial, count, self.rng))
        repair(self.rules, trial, REPAIR[f])
        refresh_total(self.rules, trial)
        score = self.judge(trial)
        self.destroy.reward(d, score)
        self.fix.reward(f, score)
        self.rounds += 1
        if self.rounds % SEGMENT_ROUNDS == 0:
            self.destroy.update()
            self.fix.update()

    def judge(self, trial: Plan) -> float:
        if trial.total < self.best.total:
            self.best = self.current = trial
            return SCORE_NEW_BEST
        if trial.total < self.current.total:
            self.current = trial
            return SCORE_BETTER
        worse = trial.total - self.current.total
        if math.isfinite(worse) and self.rng.random() < math.exp(-worse / self.temperature()):
            self.current = trial
            return SCORE_ACCEPTED
        return 0.0


def start_temperature(plan: Plan) -> float:
    driving = sum(c for c in plan.costs if math.isfinite(c))
    return max(60.0, START_WORSENING_SHARE * driving) / math.log(2)


def result(rules: Rules, search: Search, started: float) -> dict:
    best = search.best
    return {
        "routes": [{"vehicle": v["id"], "stops": rules.stops(k, best.trips[k])} for k, v in enumerate(rules.vehicles)],
        "dropped": [rules.requests[r]["id"] for r in sorted(best.unassigned)],
        "solver": "alns",
        "solveMs": round((time.perf_counter() - started) * 1000),
        "objective": best.total,
        "rounds": search.rounds,
    }


def solve(problem: dict) -> dict:
    started = time.perf_counter()
    if not problem["vehicles"] or not problem["requests"] or not problem["shelters"]:
        return empty_result(problem, "alns")
    rules = Rules(problem)
    first = plan_from_heuristic(rules, problem)
    if not math.isfinite(first.total):
        return heuristic.solve(problem)  # its plan breaks a rule checked here; hand it back unchanged
    limit = float(problem.get("timeLimitSeconds", 3))
    search = Search(rules, first, first, random.Random(problem.get("seed", 0)), started, limit, start_temperature(first))
    max_rounds = problem.get("maxRounds")
    while time.perf_counter() - started < limit and (max_rounds is None or search.rounds < max_rounds):
        if not search.current.assigned():
            break
        search.round()
    return result(rules, search, started)
