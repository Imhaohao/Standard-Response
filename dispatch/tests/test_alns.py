import random

import alns
import heuristic
import solver
from solver import CAPACITY_FIELDS
from tests.test_parity import random_problem
from tests.test_solver import pickups, problem, request, vehicle


def heuristic_objective(p):
    rules = alns.Rules(p)
    return alns.plan_from_heuristic(rules, p).total


def assert_valid(p, result):
    requests = {r["id"]: r for r in p["requests"]}
    seen = []
    for k, route in enumerate(result["routes"]):
        aboard, trip_size = {}, 0
        for stop in route["stops"]:
            rider = requests[stop["request"]]
            if stop["kind"] == "pickup":
                assert k in rider["allowedVehicles"]
                aboard[rider["id"]] = stop["arrival"]
                trip_size = len(aboard)
                seen.append(rider["id"])
                for f in CAPACITY_FIELDS:
                    assert sum(requests[i]["load"][f] for i in aboard) <= p["vehicles"][k][f]
            else:
                picked_up = aboard.pop(rider["id"])
                if rider["maxRideSeconds"] is not None and trip_size > 1:
                    assert stop["arrival"] - picked_up <= rider["maxRideSeconds"]
        assert not aboard
    assert sorted(seen + result["dropped"]) == sorted(requests)


def test_random_plans_are_valid_and_never_worse_than_the_heuristic():
    rng = random.Random(11)
    for _ in range(80):
        p = {**random_problem(rng), "maxRounds": 60, "timeLimitSeconds": 5}
        result = alns.solve(p)
        assert_valid(p, result)
        assert result["objective"] <= heuristic_objective(p)


def test_shelter_room_is_never_overfilled():
    p = problem([vehicle("a", 0), vehicle("b", 1)], [request(f"r{i}", 2 + i % 2, [0, 1]) for i in range(5)])
    p["shelters"][0]["capacity"] = 3
    result = {**alns.solve({**p, "maxRounds": 100})}
    assert len(result["dropped"]) == 2
    assert_valid(p, result)


def test_tight_deadline_sends_the_second_van_instead_of_pooling():
    p = problem([vehicle("a", 0), vehicle("b", 1)],
                [request("near_a", 2, [0, 1], deadline=300), request("near_b", 3, [0, 1], deadline=300)])
    result = alns.solve({**p, "maxRounds": 100})
    assert pickups(result) == {"a": ["near_a"], "b": ["near_b"]}
    assert result["dropped"] == []


def test_wheelchair_rider_only_goes_to_the_lift_van():
    wheelchair = {"seats": 0, "wheelchairSpaces": 1, "stretcherSpaces": 0}
    p = problem([vehicle("a", 0), vehicle("b", 1, wheelchairSpaces=2)], [request("chair", 2, [1], load=wheelchair)])
    assert pickups(alns.solve({**p, "maxRounds": 50}))["b"] == ["chair"]


def test_an_unreachable_rider_is_dropped():
    p = problem([vehicle("a", 0)], [request("island", 5, [0]), request("r", 2, [0])])
    result = alns.solve({**p, "maxRounds": 50})
    assert result["dropped"] == ["island"]


def test_finds_a_better_plan_than_the_heuristic_when_one_exists():
    """Earliest deadline first sends the only van to the far rider first and reaches the near
    pair late; picking up the pair on the way out saves both."""
    matrix = [
        [0, 100, 110, 1500, 1200],
        [100, 0, 20, 1450, 1150],
        [110, 20, 0, 1440, 1140],
        [1500, 1450, 1440, 0, 300],
        [1200, 1150, 1140, 300, 0],
    ]
    p = {
        "locations": [{"lat": 0, "lng": 0}] * 5, "matrix": matrix, "timeLimitSeconds": 5, "maxRounds": 200,
        "vehicles": [vehicle("a", 0)],
        "shelters": [{"id": "s", "location": 4, "capacity": 100}],
        "requests": [request("far", 3, [0], deadline=2400), request("n1", 1, [0], deadline=2500),
                     request("n2", 2, [0], deadline=2500)],
    }
    found = alns.solve(p)
    assert found["objective"] < heuristic_objective(p)
    assert pickups(found)["a"][:2] == ["n1", "n2"] or pickups(found)["a"][:2] == ["n2", "n1"]
    assert_valid(p, found)
    assert heuristic.solve(p)["routes"][0]["stops"][0]["request"] == "far"


def test_a_reassigned_rider_rides_in_the_vans_next_trip():
    # Same deadline, same weight, one seat: whoever goes first is the van's next trip. The rider whose
    # driver dropped out was told they're at the top of the list.
    p = problem([vehicle("a", 0, seats=1)], [request("waiting", 2, [0], deadline=7200), request("reassigned", 3, [0], deadline=7200, reassigned=True)])
    for result in [alns.solve(p), solver.solve(p), heuristic.solve(p)]:
        assert pickups(result)["a"][0] == "reassigned"
