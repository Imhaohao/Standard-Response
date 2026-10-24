"""Run one policy through one night."""

from __future__ import annotations

import time

import simpy

import heuristic
import solver

from .fleetstate import Night
from .metrics import compatibility_violations, run_metrics
from .optimizer_policy import OptimizerPolicy
from .streams import Stream, emergency_stream, outreach_stream, stream_digest
from .today_policy import TodayPolicy
from .world import World

SOLVERS = {"heuristic": heuristic.solve, "ortools": solver.solve}
STREAM_BUILDERS = {"outreach": outreach_stream, "emergency": emergency_stream}

# policy name -> (arrival process, dispatcher)
POLICIES = {
    "heuristic_outreach": ("outreach", "heuristic"),
    "ortools_outreach": ("outreach", "ortools"),
    "heuristic_911": ("emergency", "heuristic"),
    "today_911": ("emergency", "today"),
}


def simulate(world: World, stream: Stream, dispatcher: str) -> dict:
    started = time.perf_counter()
    env = simpy.Environment()
    night = Night(env, world)
    policy = TodayPolicy(night, stream) if dispatcher == "today" else OptimizerPolicy(night, stream, SOLVERS[dispatcher])
    env.run(until=world.horizon_s)
    result = run_metrics(night)
    result.update(
        streamDigest=stream_digest(stream),
        compatibilityViolations=compatibility_violations(night),
        capacityViolations=night.capacity_violations,
        solves=getattr(policy, "solve_count", 0),
        wallSeconds=time.perf_counter() - started,
    )
    return result


def run_policies(world: World, names: list[str]) -> dict[str, dict]:
    streams: dict[str, Stream] = {}
    results = {}
    for name in names:
        arrival_kind, dispatcher = POLICIES[name]
        if arrival_kind not in streams:
            streams[arrival_kind] = STREAM_BUILDERS[arrival_kind](world)
        results[name] = simulate(world, streams[arrival_kind], dispatcher)
    return results
