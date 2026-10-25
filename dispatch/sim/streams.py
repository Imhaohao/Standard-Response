"""Request-arrival processes: when does a household that needs a ride become a request?

Both are SimPy simulations that never look at the dispatcher, so every dispatcher sees the same
stream for the same seed. A stream is a time-sorted list of (seconds after the warning, household index).
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import numpy as np
import simpy

from . import rng, trace
from .constants import (
    ANSWERED_CALL_S, CALL_911_LEAD_CLIP_S, CALL_911_LEAD_MEDIAN_S, CALL_911_LEAD_SIGMA, CALL_TAKERS,
    CALL_TAKER_SERVICE_S, DIAL_INTERVAL_S, DOOR_TEAMS, DOOR_VISIT_S, PROB_911_CALL, RETRY_DELAYS_S,
    TEXT_DELAY_MEDIAN_S, TEXT_DELAY_SIGMA, TEXT_WAIT_S, UNANSWERED_RING_S,
)
from .population import Household
from .world import World

Stream = list[tuple[float, int]]


def stream_digest(stream: Stream) -> str:
    text = ";".join(f"{t:.3f}:{i}" for t, i in stream)
    return hashlib.sha1(text.encode()).hexdigest()[:12]


def call_priority(household: Household) -> float:
    """Need prior times urgency, as callPriorityFor in convex/model.ts at time zero."""
    minutes_left = max(household.fire_arrival_s / 60.0, 5.0)
    return household.need_prior * 1000.0 / minutes_left


@dataclass
class OutreachDesk:
    env: simpy.Environment
    world: World
    arrivals: Stream
    door_queue: simpy.PriorityStore

    def resolve(self, household: Household):
        if household.need is None:
            trace.note(self.env.now, "clear", household.index)
        elif self.env.now < household.fire_arrival_s:
            trace.note(self.env.now, "request", household.index)
            self.arrivals.append((self.env.now, household.index))


def attempt_answered(world: World, household: Household, attempt: int) -> bool:
    return rng.chance(world.seed, "answer", household.index, attempt) < household.answers_phone


def call_attempt(env, desk: OutreachDesk, household: Household, attempt: int):
    """Place one call. Returns True when the household was reached."""
    if not attempt_answered(desk.world, household, attempt):
        yield env.timeout(UNANSWERED_RING_S)
        return False
    length = rng.uniform(desk.world.seed, "callLength", *ANSWERED_CALL_S, household.index, attempt)
    yield env.timeout(length)
    return True


def text_reply_delay(world: World, household: Household) -> float | None:
    if not household.replies_to_text:
        return None
    normal = rng.generator(world.seed, "textReply", household.index).normal()
    return TEXT_DELAY_MEDIAN_S * math.exp(TEXT_DELAY_SIGMA * float(normal))


def text_stage(env, desk: OutreachDesk, household: Household):
    delay = text_reply_delay(desk.world, household)
    trace.note(env.now, "text", household.index)
    if delay is not None and delay <= TEXT_WAIT_S:
        yield env.timeout(delay)
        trace.note(env.now, "textReply", household.index)
        desk.resolve(household)
        return
    yield env.timeout(TEXT_WAIT_S)
    trace.note(env.now, "doorQueued", household.index)
    yield desk.door_queue.put(simpy.PriorityItem(household.deadline_s, household.index))


def household_contact(env, desk: OutreachDesk, household: Household, rank: int):
    yield env.timeout(rank * DIAL_INTERVAL_S)
    delays = (0.0, *RETRY_DELAYS_S)
    for attempt, delay in enumerate(delays):
        yield env.timeout(delay)
        trace.note(env.now, "call", household.index, attempt)
        reached = yield from call_attempt(env, desk, household, attempt)
        trace.note(env.now, "answer" if reached else "noAnswer", household.index, attempt)
        if reached:
            desk.resolve(household)
            return
    yield from text_stage(env, desk, household)


def door_team(env, desk: OutreachDesk, team: int, start_node: int):
    world, node = desk.world, start_node
    while True:
        item = yield desk.door_queue.get()
        household = world.households[item.item]
        if env.now >= household.fire_arrival_s:
            continue
        travel = world.travel.seconds(node, household.node, env.now)
        if not math.isfinite(travel):
            continue
        trace.note(env.now, "doorLeg", team, node, household.node, travel)
        yield env.timeout(travel + rng.uniform(world.seed, "doorVisit", *DOOR_VISIT_S, household.index))
        node = household.node
        trace.note(env.now, "door", household.index, team)
        desk.resolve(household)


def door_team_nodes(world: World) -> list[int]:
    generator = rng.generator(world.seed, "doorTeams")
    picks = generator.choice(len(world.households), size=DOOR_TEAMS, replace=True)
    return [world.households[int(i)].node for i in picks]


def outreach_stream(world: World) -> Stream:
    env = simpy.Environment()
    arrivals: Stream = []
    desk = OutreachDesk(env, world, arrivals, simpy.PriorityStore(env))
    for team, node in enumerate(door_team_nodes(world)):
        env.process(door_team(env, desk, team, node))
    ranked = sorted(world.households, key=lambda h: (-call_priority(h), h.index))
    for rank, household in enumerate(ranked):
        env.process(household_contact(env, desk, household, rank))
    env.run()
    return sorted(arrivals)


def emergency_call_time(world: World, household: Household) -> float | None:
    if rng.chance(world.seed, "call911", household.index) >= PROB_911_CALL:
        return None
    normal = float(rng.generator(world.seed, "lead911", household.index).normal())
    lead = CALL_911_LEAD_MEDIAN_S * world.config.lead_911_scale * math.exp(CALL_911_LEAD_SIGMA * normal)
    lead = float(np.clip(lead, *CALL_911_LEAD_CLIP_S))
    return max(0.0, household.fire_arrival_s - lead)


def emergency_call(env, takers: simpy.Resource, world: World, household: Household, call_at: float, arrivals: Stream):
    yield env.timeout(call_at)
    with takers.request() as slot:
        yield slot
        yield env.timeout(rng.uniform(world.seed, "service911", *CALL_TAKER_SERVICE_S, household.index))
    if env.now < household.fire_arrival_s:
        arrivals.append((env.now, household.index))


def emergency_stream(world: World) -> Stream:
    env = simpy.Environment()
    arrivals: Stream = []
    takers = simpy.Resource(env, capacity=world.config.call_takers)
    for household in world.needers:
        call_at = emergency_call_time(world, household)
        if call_at is not None:
            env.process(emergency_call(env, takers, world, household, call_at, arrivals))
    env.run()
    return sorted(arrivals)
