"""The live runner against a fake Convex: what it writes for a small world."""

import time

from shapely.geometry import Point

from rollcall_d.hazard import Front, Scenario
from rollcall_d.geo import to_xy
from rollcall_d.runner import ModelRunner, RunnerConfig
from rollcall_d.travel import RoadGraph


class FakeConvex:
    url = "fake"

    def __init__(self, inputs):
        self.inputs = inputs
        self.calls = []

    def query(self, name, args=None):
        assert name == "estimates:inputs"
        return self.inputs

    def mutation(self, name, args=None):
        self.calls.append((name, args))
        return "new-household" if name == "nominations:matchAddress" else None

    def batched(self, name, key, rows, size=200):
        if rows:
            self.mutation(name, {key: rows})

    def names(self):
        return [name for name, _ in self.calls]


def world(now, warning_at):
    home = {"_id": "h1", "address": "486 West Mariposa Street, Altadena", "lat": 34.195227, "lng": -118.157957, "riderId": "R-1001",
            "mobility": "walker", "outcome": "unreachable", "callStatus": "door_check", "escalation": None, "inZone": True, "attempts": 2,
            "lastAttemptAt": now - 10 * 60_000, "needPrior": 0.9, "needProbability": 0.9, "fireArrivalAt": now, "doorPriority": None, "simulated": False}
    caller = {**home, "_id": "h2", "address": "twenty six oh nine north lincoln avenue", "lat": None, "lng": None, "callStatus": "in_call",
              "outcome": "unknown", "lastAttemptAt": now}
    return {"now": now, "warningIssuedAt": warning_at, "zone": None, "state": {"smoothing": True}, "households": [home, caller],
            "nominatedHouseholdIds": [], "closures": [],
            "openNominations": [{"_id": "n1", "spokenAddress": "the lady next door", "fromHouseholdId": "h1", "at": now},
                                {"_id": "n2", "spokenAddress": "2609 North Lincoln Avenue", "fromHouseholdId": "h1", "at": now}]}


def test_one_pass_writes_every_model():
    now = time.time() * 1000
    center = to_xy(34.195227, -118.157957)
    scenario = Scenario([Front(0, Point(*center).buffer(50)), Front(60, Point(*center).buffer(5000))])
    fake = FakeConvex(world(now, now - 30 * 60_000))
    runner = ModelRunner(fake, RunnerConfig(), scenario=scenario, roads=RoadGraph.load())
    result = runner.run_pass()
    names = fake.names()
    assert "households:setEstimates" in names
    assert "doorChecks:setPriorities" in names
    assert "households:setLocation" in names  # the inbound caller's spoken address
    assert ("nominations:resolve", {"nominationId": "n1", "note": "points at a neighbor without an address (next door, across the street)"}) in fake.calls
    assert "nominations:matchAddress" in names or any(n == "nominations:resolve" and a.get("matchedHouseholdId") for n, a in fake.calls)
    assert result.stats["closuresAdded"] > 0  # half an hour into a fast scenario, streets near the origin are closed
    closures = [a for n, a in fake.calls if n == "roads:addClosures"][0]["closures"]
    assert all(c["source"] == "hazard" and c["edgeKey"].count("-") == 2 for c in closures)
