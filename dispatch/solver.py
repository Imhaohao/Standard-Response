"""OR-Tools dial-a-ride solver for evacuation pickups.

Input is the problem the Convex dispatcher builds (convex/dispatchProblem.ts has the same shape):

    {
      "locations": [{"lat", "lng"}],              # index into the matrix
      "matrix": [[seconds | null]],               # travel time i -> j on open roads, null if no route
      "vehicles": [{"id", "location", "availableAt", "endBy",
                    "seats", "wheelchairSpaces", "stretcherSpaces"}],
      "requests": [{"id", "location", "load": {"seats", "wheelchairSpaces", "stretcherSpaces"},
                    "boardingSeconds", "deadline", "weight", "allowedVehicles": [vehicle index],
                    "openOfferVehicle": vehicle index | null, "maxRideSeconds": seconds | null}],
      "shelters": [{"id", "location", "capacity"}],  # capacity = people the shelter can still take
      "timeLimitSeconds": 3
    }

All times are seconds from now. `availableAt` is when a vehicle finishes its accepted run, and
`location` is where that run ends, so new stops always come after accepted ones.

Output: {"routes": [{"vehicle", "stops": [{"request", "kind", "shelter", "arrival"}]}], "dropped": [...]}
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from fatality import RAMP_SECONDS, deaths_if_unserved, party_size

# Cost units are seconds of vehicle time. The objective is expected deaths (dispatch/fatality.py),
# priced so one expected death outweighs any amount of driving, with vehicle time as the tie-break.
# mu: every second a rider waits costs their weight in seconds of driving. Without it, the cheapest
# plan in vehicle time loads one bus with every rider while the vans sit idle.
WAIT_COST_PER_WEIGHT_SECOND = 1
DEATH_COST = 10_000_000
# Boarding after fire arrival costs as much as an unserved rider; this keeps the solver sending a
# vehicle when the two tie, and the late pickup is escalated to a human either way.
UNSERVED_SURCHARGE = 2 * 3600
CHANGED_OFFER_COST = 600  # nu: moving an open offer must save 10 vehicle-minutes
UNLOAD_SECONDS = 120
NO_ROUTE = 10**7
CAPACITY_FIELDS = ("seats", "wheelchairSpaces", "stretcherSpaces")


@dataclass
class Node:
    location: int
    service: int
    kind: str  # "start", "end", "pickup", "dropoff"
    request: int | None = None
    shelter: int | None = None


def worst_case_cost(request: dict) -> float:
    return DEATH_COST * deaths_if_unserved(request["weight"], party_size(request["load"]))


def drop_penalty(request: dict) -> int:
    return int(worst_case_cost(request)) + UNSERVED_SURCHARGE


def lateness_cost_per_second(request: dict) -> int:
    """Expected deaths rise linearly from the deadline to fire arrival, so lateness is linear too."""
    return max(1, round(worst_case_cost(request) / RAMP_SECONDS))


class Model:
    def __init__(self, problem: dict):
        self.problem = problem
        self.matrix = problem["matrix"]
        self.vehicles = problem["vehicles"]
        self.requests = problem["requests"]
        self.shelters = problem["shelters"]
        self.nodes: list[Node] = []
        self.pickup_of: dict[int, int] = {}
        self.dropoffs_of: dict[int, list[int]] = {}
        self._build_nodes()

    def _build_nodes(self):
        for vehicle in self.vehicles:
            self.nodes.append(Node(vehicle["location"], 0, "start"))
        self.end_node = len(self.nodes)
        self.nodes.append(Node(-1, 0, "end"))
        for r, request in enumerate(self.requests):
            self.pickup_of[r] = len(self.nodes)
            self.nodes.append(Node(request["location"], int(request["boardingSeconds"]), "pickup", request=r))
            self.dropoffs_of[r] = []
            for s, shelter in enumerate(self.shelters):
                self.dropoffs_of[r].append(len(self.nodes))
                self.nodes.append(Node(shelter["location"], UNLOAD_SECONDS, "dropoff", request=r, shelter=s))

    def travel(self, a: Node, b: Node) -> int:
        if a.kind == "end" or b.kind == "end":
            return 0
        seconds = self.matrix[a.location][b.location]
        return NO_ROUTE if seconds is None else int(seconds)


def _register_costs(routing, manager, model: Model):
    def transit(from_index, to_index):
        a = model.nodes[manager.IndexToNode(from_index)]
        b = model.nodes[manager.IndexToNode(to_index)]
        return model.travel(a, b) + a.service

    transit_index = routing.RegisterTransitCallback(transit)
    for k in range(len(model.vehicles)):
        routing.SetArcCostEvaluatorOfVehicle(_vehicle_cost(routing, manager, model, k), k)
    return transit_index


def _vehicle_cost(routing, manager, model: Model, k: int):
    def cost(from_index, to_index):
        a = model.nodes[manager.IndexToNode(from_index)]
        b = model.nodes[manager.IndexToNode(to_index)]
        seconds = model.travel(a, b) + a.service
        if b.kind == "pickup":
            open_vehicle = model.requests[b.request].get("openOfferVehicle")
            if open_vehicle is not None and open_vehicle != k:
                seconds += CHANGED_OFFER_COST
        return seconds

    return routing.RegisterTransitCallback(cost)


def _add_time(routing, manager, model: Model, transit_index):
    horizon = int(max([r["deadline"] for r in model.requests] + [v["endBy"] for v in model.vehicles] + [0])) + 4 * 3600
    # Two copies of the same clock, because OR-Tools allows one soft bound per node per dimension:
    # "time" prices waiting from now, "lateness" prices time past the deadline. No idle waiting, so they agree.
    for name in ("time", "lateness"):
        routing.AddDimension(transit_index, 0, horizon, False, name)
    time_dim = routing.GetDimensionOrDie("time")
    lateness_dim = routing.GetDimensionOrDie("lateness")
    for k, vehicle in enumerate(model.vehicles):
        start = int(vehicle["availableAt"])
        for dim in (time_dim, lateness_dim):
            dim.CumulVar(routing.Start(k)).SetRange(start, start)
        time_dim.CumulVar(routing.End(k)).SetMax(max(start, int(vehicle["endBy"])))
    for r, request in enumerate(model.requests):
        pickup = manager.NodeToIndex(model.pickup_of[r])
        time_dim.SetCumulVarSoftUpperBound(pickup, 0, max(1, round(WAIT_COST_PER_WEIGHT_SECOND * request["weight"])))
        # The cumul is arrival at the door; the rider is safe once boarding finishes, so that must beat the deadline.
        boarded_by = int(request["deadline"] - request["boardingSeconds"])
        lateness_dim.SetCumulVarSoftUpperBound(pickup, max(0, boarded_by), lateness_cost_per_second(request))
    return time_dim


def _add_capacities(routing, manager, model: Model):
    for field in CAPACITY_FIELDS:

        def demand(from_index, field=field):
            node = model.nodes[manager.IndexToNode(from_index)]
            if node.request is None:
                return 0
            amount = int(model.requests[node.request]["load"][field])
            return amount if node.kind == "pickup" else -amount

        demand_index = routing.RegisterUnaryTransitCallback(demand)
        capacities = [int(v[field]) for v in model.vehicles]
        routing.AddDimensionWithVehicleCapacity(demand_index, 0, capacities, True, field)


def _add_requests(routing, manager, model: Model, time_dim):
    solver = routing.solver()
    for r, request in enumerate(model.requests):
        pickup = manager.NodeToIndex(model.pickup_of[r])
        dropoffs = [manager.NodeToIndex(n) for n in model.dropoffs_of[r]]
        # -1 lets the stop go unperformed. SetAllowedVehiclesForIndex's Python binding rejects lists in 9.15.
        allowed = [-1, *request["allowedVehicles"]]
        for index in [pickup, *dropoffs]:
            routing.VehicleVar(index).SetValues(allowed)
        pickup_set = routing.AddDisjunction([pickup], drop_penalty(request))
        dropoff_set = routing.AddDisjunction(dropoffs, 0)
        routing.AddPickupAndDeliverySets(pickup_set, dropoff_set)
        for dropoff in dropoffs:
            _same_vehicle_after(solver, routing, time_dim, pickup, dropoff, request.get("maxRideSeconds"))


def _add_shelter_capacity(routing, manager, model: Model):
    """People dropped at each shelter fit the room it has left (capacity is passed as room left)."""
    solver = routing.solver()
    for s, shelter in enumerate(model.shelters):
        arrivals = []
        for r, request in enumerate(model.requests):
            party = sum(int(request["load"][f]) for f in CAPACITY_FIELDS)
            arrivals.append(routing.ActiveVar(manager.NodeToIndex(model.dropoffs_of[r][s])) * party)
        if arrivals:
            solver.Add(solver.Sum(arrivals) <= int(shelter["capacity"]))


def _same_vehicle_after(solver, routing, time_dim, pickup, dropoff, max_ride):
    active = routing.ActiveVar(dropoff)
    solver.Add(active * (routing.VehicleVar(pickup) - routing.VehicleVar(dropoff)) == 0)
    solver.Add(active * (time_dim.CumulVar(dropoff) - time_dim.CumulVar(pickup)) >= 0)
    if max_ride is not None:
        solver.Add(active * (time_dim.CumulVar(dropoff) - time_dim.CumulVar(pickup)) <= int(max_ride))


def _initial_routes(manager, model: Model):
    """Warm start: keep each open offer on its vehicle, dropped at the first shelter."""
    routes = [[] for _ in model.vehicles]
    for r, request in enumerate(model.requests):
        k = request.get("openOfferVehicle")
        if k is None:
            continue
        routes[k].append(manager.NodeToIndex(model.pickup_of[r]))
        routes[k].append(manager.NodeToIndex(model.dropoffs_of[r][0]))
    return routes


def _heuristic_routes(manager, model: Model):
    """Warm start from the competent heuristic, so the search begins at the baseline and only improves on it."""
    import heuristic  # heuristic imports this module's constants

    plan = heuristic.solve(model.problem)
    request_index = {request["id"]: r for r, request in enumerate(model.requests)}
    shelter_index = {shelter["id"]: s for s, shelter in enumerate(model.shelters)}
    routes = []
    for route in plan["routes"]:
        nodes = []
        for stop in route["stops"]:
            r = request_index[stop["request"]]
            node = model.pickup_of[r] if stop["kind"] == "pickup" else model.dropoffs_of[r][shelter_index[stop["shelter"]]]
            nodes.append(manager.NodeToIndex(node))
        routes.append(nodes)
    return routes


def _solve_warm(routing, manager, model: Model, params):
    for routes in (_heuristic_routes(manager, model), _initial_routes(manager, model)):
        initial = routing.ReadAssignmentFromRoutes(routes, True)
        if initial is not None:
            return routing.SolveFromAssignmentWithParameters(initial, params)
    return routing.SolveWithParameters(params)


def _search_parameters(time_limit: float):
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromMilliseconds(int(time_limit * 1000))
    return params


def _read_solution(routing, manager, model: Model, time_dim, solution):
    routes, served = [], set()
    for k, vehicle in enumerate(model.vehicles):
        stops = []
        index = solution.Value(routing.NextVar(routing.Start(k)))
        while not routing.IsEnd(index):
            node = model.nodes[manager.IndexToNode(index)]
            stop = {
                "request": model.requests[node.request]["id"],
                "kind": node.kind,
                "shelter": model.shelters[node.shelter]["id"] if node.shelter is not None else None,
                "arrival": solution.Min(time_dim.CumulVar(index)),
            }
            stops.append(stop)
            served.add(node.request)
            index = solution.Value(routing.NextVar(index))
        routes.append({"vehicle": vehicle["id"], "stops": stops})
    dropped = [request["id"] for r, request in enumerate(model.requests) if r not in served]
    return routes, dropped


def empty_result(problem: dict, solver: str):
    return {
        "routes": [{"vehicle": v["id"], "stops": []} for v in problem["vehicles"]],
        "dropped": [r["id"] for r in problem["requests"]],
        "solver": solver,
        "solveMs": 0,
    }


def solve(problem: dict) -> dict:
    started = time.perf_counter()
    if not problem["vehicles"] or not problem["requests"] or not problem["shelters"]:
        return empty_result(problem, "ortools")
    model = Model(problem)
    starts = list(range(len(model.vehicles)))
    manager = pywrapcp.RoutingIndexManager(len(model.nodes), len(model.vehicles), starts, [model.end_node] * len(starts))
    routing = pywrapcp.RoutingModel(manager)
    transit_index = _register_costs(routing, manager, model)
    time_dim = _add_time(routing, manager, model, transit_index)
    _add_capacities(routing, manager, model)
    _add_requests(routing, manager, model, time_dim)
    _add_shelter_capacity(routing, manager, model)

    params = _search_parameters(problem.get("timeLimitSeconds", 3))
    solution = _solve_warm(routing, manager, model, params)
    if solution is None:
        return empty_result(problem, "ortools")
    routes, dropped = _read_solution(routing, manager, model, time_dim, solution)
    return {
        "routes": routes,
        "dropped": dropped,
        "solver": "ortools",
        "solveMs": round((time.perf_counter() - started) * 1000),
        "objective": solution.ObjectiveValue(),
    }
