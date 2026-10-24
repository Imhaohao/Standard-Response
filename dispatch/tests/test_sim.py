import json
import math
import sys

import pytest

from sim import run as sim_run
from sim.constants import Config
from sim.engine import POLICIES, run_policies
from sim.exploration import explore_seed
from sim.population import RideNeed, VehicleSpec, fleet_of_size, ride_need_for, vehicle_can_serve
from sim.streams import emergency_stream, outreach_stream, stream_digest
from sim.world import build_world

SMALL = Config(households=45, solver_time_limit_s=0.05)
ALL = list(POLICIES)
DETERMINISTIC = ["heuristic_outreach", "heuristic_911", "today_911"]


@pytest.fixture(scope="module")
def night_results():
    return {seed: run_policies(build_world(seed, SMALL), ALL) for seed in (0, 1)}


def comparable(result):
    return {k: v for k, v in result.items() if k != "wallSeconds"}


def test_a_night_completes_for_every_policy(night_results):
    for results in night_results.values():
        assert set(results) == set(ALL)


def test_same_seed_reproduces_exactly_for_deterministic_policies():
    first = run_policies(build_world(3, SMALL), DETERMINISTIC)
    second = run_policies(build_world(3, SMALL), DETERMINISTIC)
    assert {k: comparable(v) for k, v in first.items()} == {k: comparable(v) for k, v in second.items()}


def test_different_seeds_differ():
    a = run_policies(build_world(0, SMALL), ["today_911"])["today_911"]
    b = run_policies(build_world(1, SMALL), ["today_911"])["today_911"]
    assert comparable(a) != comparable(b)


def test_dispatch_only_policies_get_identical_request_streams(night_results):
    for results in night_results.values():
        assert results["heuristic_outreach"]["streamDigest"] == results["ortools_outreach"]["streamDigest"]
        assert results["heuristic_outreach"]["requests"] == results["ortools_outreach"]["requests"]
        assert results["heuristic_outreach"]["streamDigest"] == results["alns_outreach"]["streamDigest"]
        assert results["heuristic_911"]["streamDigest"] == results["today_911"]["streamDigest"]


def test_streams_are_pure_functions_of_the_seed():
    world = build_world(2, SMALL)
    assert outreach_stream(world) == outreach_stream(build_world(2, SMALL))
    assert emergency_stream(world) == emergency_stream(build_world(2, SMALL))
    assert stream_digest(outreach_stream(world)) != stream_digest(emergency_stream(world))


def test_streams_are_time_sorted_and_before_the_fire():
    world = build_world(4, SMALL)
    for stream in (outreach_stream(world), emergency_stream(world)):
        assert [t for t, _ in stream] == sorted(t for t, _ in stream)
        for at, index in stream:
            household = world.households[index]
            assert household.need is not None
            assert 0 <= at < household.fire_arrival_s


def test_metrics_are_sane(night_results):
    for results in night_results.values():
        for result in results.values():
            picked = result["pickupsOnTime"] + result["pickupsLate"]
            assert picked <= result["requests"] <= result["needers"]
            assert result["ridersNeverPickedUp"] == result["needers"] - picked
            assert result["worstWaitMinutes"] >= 0
            assert result["vehicleMinutes"] >= 0
            wheel = result["accessibleWaitMinutes"]
            assert math.isnan(wheel) or wheel >= 0


def test_compatibility_and_capacity_are_respected(night_results):
    for results in night_results.values():
        for result in results.values():
            assert result["compatibilityViolations"] == 0
            assert result["capacityViolations"] == 0


def test_wheelchair_rider_needs_a_lift_vehicle():
    truth = {"canLeave": "no", "peopleCount": 1, "mobility": "power_wheelchair", "assistanceRequired": "none",
             "medical": [], "hasCar": False}
    need = ride_need_for(truth)
    no_lift = VehicleSpec(0, "walker van", 4, 0, 0, 1, False)
    assert not vehicle_can_serve(no_lift, need)
    assert vehicle_can_serve(fleet_of_size(8)[0], need)
    assert not vehicle_can_serve(fleet_of_size(8)[7], need)  # ambulance has no wheelchair space


def test_bedbound_rider_needs_two_crew_and_a_stretcher():
    truth = {"canLeave": "no", "peopleCount": 1, "mobility": "bedbound", "assistanceRequired": "two_person_lift",
             "medical": [], "hasCar": False}
    need = ride_need_for(truth)
    assert isinstance(need, RideNeed) and need.crew_needed == 2 and need.stretcher_spaces == 1
    allowed = [v.label for v in fleet_of_size(8) if vehicle_can_serve(v, need)]
    assert allowed == ["Medic 41"]


def test_fleet_sizes():
    assert [len(fleet_of_size(n)) for n in (4, 6, 8, 12)] == [4, 6, 8, 12]
    assert [v.index for v in fleet_of_size(4)] == [0, 1, 2, 3]


def test_exploration_runs_and_reports_ranges():
    result = explore_seed((0, SMALL))
    assert set(result) == {"ownPace", "withCalls", "everyoneAtOnce", "residents"}
    assert result["everyoneAtOnce"]["meanTripMinutes"] >= result["everyoneAtOnce"]["freeFlowMeanTripMinutes"]


def test_quick_style_run_writes_the_documented_json(tmp_path, monkeypatch):
    out = tmp_path / "sim-results.json"
    argv = ["sim.run", "--seeds", "2", "--sensitivity-seeds", "1", "--households", "40", "--solver-limit", "0.05",
            "--workers", "4", "--out", str(out)]
    monkeypatch.setattr(sys, "argv", argv)
    sim_run.main()
    data = json.loads(out.read_text())
    assert data["label"] == "Simulation, not a prediction"
    assert {"generatedAt", "seeds", "population", "assumptions", "results", "sensitivity", "whereWeDontHelp", "exploration"} <= set(data)
    assert set(data["results"]) == {"dispatchOnly", "dispatchOnlyAlns", "alnsVsOrtools", "outreachOnly", "combined", "todayProcess"}
    metric = data["results"]["dispatchOnly"]["difference"]["pickupsOnTime"]
    assert {"median", "p5", "p95"} <= set(metric)
    assert data["integrity"]["dispatchOnlyStreamsIdentical"] is True
    assert all({"name", "value", "why"} <= set(row) for row in data["assumptions"])
    assert "lives saved" not in json.dumps(data).lower()
