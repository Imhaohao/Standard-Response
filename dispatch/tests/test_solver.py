import heuristic
import solver

# Locations: 0 depot A, 1 depot B, 2 rider near A, 3 rider near B, 4 shelter, 5 island (no road in or out)
MATRIX = [
    [0, 600, 120, 700, 900, None],
    [600, 0, 650, 100, 900, None],
    [120, 650, 0, 640, 880, None],
    [700, 100, 640, 0, 860, None],
    [900, 900, 880, 860, 0, None],
    [None, None, None, None, None, 0],
]


def vehicle(vid, location, **fields):
    base = {"id": vid, "location": location, "availableAt": 0, "endBy": 8 * 3600,
            "seats": 4, "wheelchairSpaces": 0, "stretcherSpaces": 0}
    return {**base, **fields}


def request(rid, location, allowed, **fields):
    base = {"id": rid, "location": location, "boardingSeconds": 120, "deadline": 3600, "weight": 1,
            "load": {"seats": 1, "wheelchairSpaces": 0, "stretcherSpaces": 0},
            "allowedVehicles": allowed, "openOfferVehicle": None, "maxRideSeconds": None}
    return {**base, **fields}


def problem(vehicles, requests):
    return {"locations": [{"lat": 0, "lng": 0}] * len(MATRIX), "matrix": MATRIX, "vehicles": vehicles,
            "requests": requests, "shelters": [{"id": "s", "location": 4, "capacity": 100}], "timeLimitSeconds": 1}


def pickups(result):
    return {r["vehicle"]: [s["request"] for s in r["stops"] if s["kind"] == "pickup"] for r in result["routes"]}


def run_both(p):
    return [solver.solve(p), heuristic.solve(p)]


def test_tight_deadline_sends_the_second_van_instead_of_pooling():
    p = problem([vehicle("a", 0), vehicle("b", 1)],
                [request("near_a", 2, [0, 1], deadline=300), request("near_b", 3, [0, 1], deadline=300)])
    for result in run_both(p):
        assert pickups(result) == {"a": ["near_a"], "b": ["near_b"]}
        assert result["dropped"] == []


def test_wheelchair_rider_only_goes_to_the_lift_van():
    wheelchair = {"seats": 0, "wheelchairSpaces": 1, "stretcherSpaces": 0}
    p = problem([vehicle("a", 0), vehicle("b", 1, wheelchairSpaces=2)],
                [request("chair", 2, [1], load=wheelchair)])
    for result in run_both(p):
        assert pickups(result)["b"] == ["chair"]


def test_every_pickup_is_followed_by_a_dropoff_on_the_same_vehicle():
    p = problem([vehicle("a", 0)], [request("r1", 2, [0]), request("r2", 3, [0])])
    for result in run_both(p):
        stops = result["routes"][0]["stops"]
        for rid in ("r1", "r2"):
            kinds = [s["kind"] for s in stops if s["request"] == rid]
            assert kinds == ["pickup", "dropoff"]


def test_unreachable_rider_is_dropped_not_promised():
    p = problem([vehicle("a", 0)], [request("island", 5, [0]), request("ok", 2, [0])])
    for result in run_both(p):
        assert result["dropped"] == ["island"]
        assert pickups(result)["a"] == ["ok"]


def test_vehicle_finishing_an_accepted_run_starts_late():
    p = problem([vehicle("a", 0, availableAt=1800)], [request("r", 2, [0])])
    for result in run_both(p):
        pickup = next(s for s in result["routes"][0]["stops"] if s["kind"] == "pickup")
        assert pickup["arrival"] >= 1800 + 120


def test_open_offer_stays_when_the_alternative_saves_little():
    # b is 10 seconds closer, far less than the cost of changing an offer a driver is looking at
    matrix_row = {"near_both": 2}
    p = problem([vehicle("a", 0), vehicle("b", 1)],
                [request("near_both", matrix_row["near_both"], [0, 1], openOfferVehicle=1)])
    p["matrix"] = [row[:] for row in MATRIX]
    p["matrix"][0][2], p["matrix"][1][2] = 120, 110
    result = solver.solve(p)
    assert pickups(result)["b"] == ["near_both"]


def test_capacity_is_respected():
    full = {"seats": 4, "wheelchairSpaces": 0, "stretcherSpaces": 0}
    p = problem([vehicle("a", 0)], [request("r1", 2, [0], load=full), request("r2", 3, [0], load=full)])
    for result in run_both(p):
        load = 0
        for stop in result["routes"][0]["stops"]:
            load += 4 if stop["kind"] == "pickup" else -4
            assert load <= 4


def test_oxygen_rider_rides_no_longer_than_allowed():
    p = problem([vehicle("a", 0)],
                [request("oxygen", 2, [0], maxRideSeconds=1200), request("other", 3, [0])])
    for result in run_both(p):
        stops = result["routes"][0]["stops"]
        times = {s["kind"]: s["arrival"] for s in stops if s["request"] == "oxygen"}
        assert times["dropoff"] - times["pickup"] <= 1200 + 120


def test_riders_are_spread_across_idle_vans_instead_of_one_bus_tour():
    # A 20-seat bus near rider 2 and a van at each depot. Pooling everyone on the bus saves vehicle
    # time, but riders would wait for it while vans sit idle; the wait cost must spread them.
    p = problem([vehicle("bus", 2, seats=20), vehicle("a", 0), vehicle("b", 1)],
                [request("near_a", 2, [0, 1, 2]), request("near_b", 3, [0, 1, 2])])
    result = solver.solve(p)
    used = [vehicle_id for vehicle_id, riders in pickups(result).items() if riders]
    assert len(used) == 2


def test_rider_with_no_road_to_a_shelter_is_dropped_without_crashing():
    p = problem([vehicle("a", 0)], [request("cut_off", 2, [0]), request("ok", 3, [0])])
    p["matrix"] = [row[:] for row in MATRIX]
    p["matrix"][2][4] = None
    result = heuristic.solve(p)
    assert result["dropped"] == ["cut_off"]


def test_heuristic_serves_reachable_riders_before_hopeless_ones():
    hopeless = request("hopeless", 3, [0], deadline=10)
    reachable = request("reachable", 2, [0], deadline=400)
    result = heuristic.solve(problem([vehicle("a", 0)], [hopeless, reachable]))
    assert pickups(result)["a"] == ["reachable", "hopeless"]


def test_full_shelter_sends_riders_to_the_one_with_room():
    p = problem([vehicle("a", 0, seats=8)], [request("r1", 2, [0]), request("r2", 3, [0])])
    p["matrix"] = [row + [700] for row in MATRIX] + [[700, 700, 700, 700, 700, None, 0]]
    p["shelters"] = [{"id": "near", "location": 4, "capacity": 1}, {"id": "far", "location": 6, "capacity": 10}]
    for result in run_both(p):
        drops = [s["shelter"] for s in result["routes"][0]["stops"] if s["kind"] == "dropoff"]
        assert sorted(drops).count("near") <= 1 and len(drops) == 2


def test_no_shelter_room_means_the_rider_is_not_promised_a_ride():
    p = problem([vehicle("a", 0)], [request("r1", 2, [0])])
    p["shelters"] = [{"id": "s", "location": 4, "capacity": 0}]
    for result in run_both(p):
        assert result["dropped"] == ["r1"]


def test_solver_reaches_the_rider_more_likely_to_die_first():
    # One van, two riders with the same deadline. The near one can walk; the far one is on oxygen
    # and needs a lift. Fewer expected deaths come from the farther, more vulnerable rider first.
    near = request("walks", 2, [0], deadline=650)
    far = request("oxygen_lift", 3, [0], deadline=650, weight=4)
    result = solver.solve(problem([vehicle("a", 0)], [near, far]))
    assert pickups(result)["a"][0] == "oxygen_lift"


def test_a_rider_being_reassigned_goes_first_in_the_heuristic():
    # Told they're still at the top of the list: the van goes to them before a rider waiting longer.
    waiting = request("waiting", 2, [0], deadline=1500)
    reassigned = request("reassigned", 3, [0], deadline=2500, reassigned=True)
    result = heuristic.solve(problem([vehicle("a", 0)], [waiting, reassigned]))
    assert pickups(result)["a"][0] == "reassigned"


def test_when_only_one_rider_can_be_carried_the_reassigned_one_is_kept():
    import alns

    p = problem([vehicle("a", 0)], [request("waiting", 2, [0]), request("reassigned", 3, [0], reassigned=True)])
    p["shelters"] = [{"id": "s", "location": 4, "capacity": 1}]
    for result in [solver.solve(p), alns.solve(p), heuristic.solve(p)]:
        assert result["dropped"] == ["waiting"]


def test_heuristic_keeps_an_open_offer_unless_another_van_is_much_sooner():
    # Van b holds the open offer. Van a reaches the rider 530 s sooner: not worth pulling the offer.
    held = request("held", 2, [0, 1], openOfferVehicle=1)
    assert pickups(heuristic.solve(problem([vehicle("a", 0), vehicle("b", 1)], [held])))["b"] == ["held"]
    # Van b is busy for another 10 minutes, so a is 1,130 s sooner: the offer moves.
    busy_b = problem([vehicle("a", 0), vehicle("b", 1, availableAt=600)], [held])
    assert pickups(heuristic.solve(busy_b))["a"] == ["held"]
