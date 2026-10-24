"""Every tunable number the simulator uses, with a plain reason. `assumptions_table` turns these into
the labeled list written to data/sim-results.json."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import fatality
import solver

REPO = Path(__file__).resolve().parents[2]
ROADS_FILE = REPO / "data" / "roads" / "altadena.json"
HAZARD_FILE = REPO / "data" / "hazard" / "scenario.geojson"
POPULATION_FILE = REPO / "data" / "population.json"
RESULTS_FILE = REPO / "data" / "sim-results.json"
MODELING_DIR = REPO / "modeling"

LABEL = "Simulation, not a prediction"

MINUTE = 60.0
HOUSEHOLD_BOX = {"south": 34.17, "north": 34.21, "west": -118.175, "east": -118.13}
VEHICLE_BAND = {"south": 34.179, "north": 34.183, "west": -118.168, "east": -118.14}
SHELTER = {"name": "Pasadena Convention Center", "lat": 34.1443, "lng": -118.1446, "capacity": 1200}
BLOCK_GRID = 4

DEADLINE_MARGIN_S = 10 * MINUTE
SHIFT_LENGTH_S = 8 * 3600
UNLOAD_S = 120.0
OXYGEN_MAX_RIDE_S = 3600
CLOSURE_EPOCH_S = 600.0
TICK_S = 15.0
END_PADDING_S = 1800.0

DIAL_INTERVAL_S = 1.0
ANSWERED_CALL_S = (120.0, 240.0)
UNANSWERED_RING_S = 30.0
RETRY_DELAYS_S = (120.0, 180.0)
TEXT_WAIT_S = 900.0
TEXT_DELAY_MEDIAN_S = 360.0
TEXT_DELAY_SIGMA = 0.8
DOOR_TEAMS = 6
DOOR_VISIT_S = (360.0, 600.0)
DOOR_TEAM_COUNT_NOTE = "teams stage on random household nodes"

PROB_911_CALL = 0.55
CALL_911_LEAD_MEDIAN_S = 20 * MINUTE
CALL_911_LEAD_SIGMA = 0.5
CALL_911_LEAD_CLIP_S = (5 * MINUTE, 90 * MINUTE)
CALL_TAKERS = 2
CALL_TAKER_SERVICE_S = (120.0, 240.0)
RADIO_DELAY_S = (120.0, 360.0)

DRIVER_CANCEL_PROB = 0.03

BASE_FLEET_SIZE = 8


@dataclass(frozen=True)
class Config:
    fleet_size: int = BASE_FLEET_SIZE
    answer_scale: float = 1.0
    hazard_scale: float = 1.0
    solver_time_limit_s: float = 0.3
    replan_every_s: float = 300.0
    debounce_s: float = 90.0
    households: int = 600
    plan_window: int = 40
    lead_911_scale: float = 1.0

    def with_changes(self, **changes) -> "Config":
        return replace(self, **changes)


def assumptions_table(config: Config) -> list[dict]:
    rows = [
        ("Optimizer time limit per re-plan", f"{config.solver_time_limit_s} s", "keeps 100 seeds under about 15 minutes; the production service uses 3 s, so the optimizer here is slightly weaker than deployed"),
        ("Re-plan cadence", f"on arrival (debounced {config.debounce_s:.0f} s), when a vehicle frees up, and at least every {config.replan_every_s / 60:.0f} min", "mirrors the plan's debounced event-driven loop"),
        ("Solver objective weights (imported from solver.py)",
         f"WAIT_COST_PER_WEIGHT_SECOND={solver.WAIT_COST_PER_WEIGHT_SECOND}, DEATH_COST={solver.DEATH_COST}, "
         f"UNSERVED_SURCHARGE={solver.UNSERVED_SURCHARGE}, CHANGED_OFFER_COST={solver.CHANGED_OFFER_COST}",
         "read from the solver module at run time, so this list always matches the objective that produced the numbers"),
        ("Fatality risk (dispatch/fatality.py)",
         f"{fatality.DEATH_SHARE_PER_WEIGHT:.0%} per need weight per person, capped at {fatality.MAX_DEATH_SHARE:.0%}; zero when boarded by the deadline, rising linearly to the cap at fire arrival {fatality.RAMP_SECONDS / 60:.0f} min later",
         "assumption, not data: it ranks plans by who is left in harm's way and is never shown per person"),
        ("Planning window", f"the {config.plan_window} pending requests with the earliest deadlines go to each dispatcher", "both dispatchers get the same window; only the first trip of each route is committed, and a short solver budget cannot handle 100+ requests"),
        ("Frozen runs", "each idle vehicle commits to the first trip of its returned route", "an accepted run is never moved or extended; later trips are re-planned from the run's end"),
        ("Driver cancellation", f"{DRIVER_CANCEL_PROB:.0%} per committed pickup", "small stand-in rate; the request goes back to the open pool"),
        ("Dialer rate", f"{1 / DIAL_INTERVAL_S:.0f} new call per second, unlimited phone lines", "the plan says about 1 per second"),
        ("Answered call length", f"{ANSWERED_CALL_S[0] / 60:.0f} to {ANSWERED_CALL_S[1] / 60:.0f} min, uniform", "from the plan"),
        ("Unanswered ring", f"{UNANSWERED_RING_S:.0f} s", "a ring or voicemail ends well before a conversation would"),
        ("Retries after no answer", "2 min after the first miss, then 3 min after that (5 min total)", "the plan says retry at 2 and 5 minutes"),
        ("Text reply", f"about 45% of households can reply; delay is lognormal with median {TEXT_DELAY_MEDIAN_S / 60:.0f} min; text gives up after {TEXT_WAIT_S / 60:.0f} min", "stand-in; the door-check queue takes everyone left"),
        ("Door checks", f"{DOOR_TEAMS} teams, deadline-first, travel on the road graph plus {DOOR_VISIT_S[0] / 60:.0f} to {DOOR_VISIT_S[1] / 60:.0f} min per visit", "from the plan (about 8 min a visit)"),
        ("Call accuracy", "a reached household reports its true need", "perfect accuracy is optimistic; call accuracy is evaluated separately by Track D"),
        ("Answer probability", "per-household answersPhone, scaled by the answer-rate setting", "stand-in persona draw as in convex/seed.ts"),
        ("911 callers", f"{PROB_911_CALL:.0%} of households that need a ride call 911", "assumption for today's process; the Eaton Fire case shows long gaps before calls"),
        ("911 call timing", f"fire arrival minus a lognormal lead (median {CALL_911_LEAD_MEDIAN_S / 60:.0f} min, clipped {CALL_911_LEAD_CLIP_S[0] / 60:.0f} to {CALL_911_LEAD_CLIP_S[1] / 60:.0f} min)", "people call when the fire is visibly near; assumption"),
        ("911 call takers", f"{CALL_TAKERS} takers, {CALL_TAKER_SERVICE_S[0] / 60:.0f} to {CALL_TAKER_SERVICE_S[1] / 60:.0f} min per call", "a queue models 'we have a lot of calls in that area'"),
        ("Radio delay before a unit moves", f"{RADIO_DELAY_S[0] / 60:.0f} to {RADIO_DELAY_S[1] / 60:.0f} min, uniform", "assumption for today's process"),
        ("Today's dispatch rule", "first come first served, nearest idle unit, one rider per trip, no need matching", "an incompatible unit arrives, cannot load the rider, and the request goes back in line without that unit"),
        ("Deadline", "fire arrival at the home minus 10 min", "same as deadlineFor in convex/model.ts"),
        ("Primary metric", "pickups finished by the deadline", "a pickup finished after the deadline but before the fire arrives counts as late; after that, never picked up"),
        ("Hazard closures", "a road closes when the fire front reaches its midpoint", "the same front timing that sets household deadlines; recomputed every 10 min"),
        ("Travel times", "free-flow edge seconds from OpenStreetMap; a leg's time is fixed when it starts", "closures affect legs that start after them; riders already aboard are never stranded"),
        ("Unload time", f"{UNLOAD_S:.0f} s per arrival at the shelter", "same constant as the solver"),
        ("Shelter", f"{SHELTER['name']}, capacity {SHELTER['capacity']} people, enforced but never binding", "1200 is far above the number of riders"),
        ("Fleet", f"{config.fleet_size} vehicles (base fleet from convex/seed.ts)", "vans, one bus, one ambulance; shift length 8 h"),
        ("Population", f"{config.households} households sampled per seed from data/population.json when it exists (about 10% need a ride), otherwise 200 stand-in households from convex/seed.ts (about half need a ride)", "demo-scale zone: eight vehicles cannot serve the 11,855-household file in full, so each night uses a sampled zone"),
        ("Seeds", "each seed redraws the sampled population, vehicle start points, calls and cancellations", "ranges therefore reflect population and behavior variation"),
    ]
    return [{"name": name, "value": value, "why": why} for name, value, why in rows]
