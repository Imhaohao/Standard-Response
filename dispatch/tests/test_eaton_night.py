import math

import numpy as np
import simpy

from sim.constants import Config
from sim.eaton_night import (
    NIGHT_END, SCENARIOS, FireRecord, hold_vehicles, household_for, metric_xy, scaled_fleet,
)
from sim.fleetstate import Night
from sim.population import vehicle_can_serve
from sim.world import World

RECORD = {"lat": 34.19, "lng": -118.15, "age": 82, "peopleCount": 1, "mobility": "power_wheelchair",
          "assistanceRequired": "none", "medical": [], "hasCar": False, "canLeave": "no", "answersPhone": 0.7}
TRIGGER = SCENARIOS["firstFireWest"]["callsStart"].timestamp()


def test_first_fire_west_of_lake_is_the_earliest_sighting():
    fire = FireRecord()
    first = fire.sighting_at.argmin()
    at = fire.first_within(fire.sighting_xy[first:first + 1], 1.0)[0]
    assert at == TRIGGER


def test_a_home_with_no_sighting_nearby_has_no_fire_time():
    fire = FireRecord()
    far_south = metric_xy([34.0], [-118.15])
    assert math.isinf(fire.fire_nearby_at(far_south)[0])


def test_a_home_the_fire_never_reached_needs_a_ride_by_noon():
    home = household_for(0, RECORD, 1, math.inf, False, TRIGGER, np.random.default_rng(0))
    assert not home.at_risk and home.need is not None
    assert home.fire_arrival_s == NIGHT_END.timestamp() - TRIGGER


def test_fire_before_calls_start_leaves_no_time():
    home = household_for(0, RECORD, 1, TRIGGER - 600, True, TRIGGER, np.random.default_rng(0))
    assert home.at_risk and home.deadline_s < 0


def test_scaled_fleet_keeps_the_mix():
    fleet = scaled_fleet(24)
    assert [v.index for v in fleet] == list(range(24))
    assert sum(v.stretcher_spaces for v in fleet) == 3
    assert len({v.label for v in fleet}) == 24


def test_vans_wait_until_they_roll():
    fleet = scaled_fleet(2)
    world = World(0, Config(fleet_size=2), None, [], fleet, [0, 0], 0, None)
    env = simpy.Environment()
    night = Night(env, world)
    released = []
    env.process(hold_vehicles(night, 600.0, lambda: released.append(env.now)))
    env.run(until=300)
    assert all(v.busy for v in night.vehicles)
    env.run(until=700)
    assert released == [600.0] and not any(v.busy for v in night.vehicles)
    assert vehicle_can_serve(fleet[0], household_for(0, RECORD, 1, math.inf, False, TRIGGER, np.random.default_rng(0)).need)
