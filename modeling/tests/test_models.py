import math

from shapely.geometry import Point

from rollcall_d import door, need
from rollcall_d.hazard import Front, Scenario


def ring_scenario():
    return Scenario([Front(0, Point(0, 0).buffer(100)), Front(60, Point(0, 0).buffer(700))])


def test_arrival_interpolates_between_fronts():
    scenario = ring_scenario()
    assert scenario.arrival_minutes_xy(0, 0) == 0
    assert 0 < scenario.arrival_minutes_xy(400, 0) < 60
    assert scenario.arrival_minutes_xy(400, 0) < scenario.arrival_minutes_xy(600, 0)


def test_outside_every_front_is_never_safe():
    minutes = ring_scenario().arrival_minutes_xy(5000, 0)
    assert math.isfinite(minutes) and minutes > 60


def household(i, outcome="unknown", lat=34.19, lng=-118.15, prior=0.2):
    return {"_id": f"h{i}", "outcome": outcome, "lat": lat, "lng": lng, "needPrior": prior, "needProbability": prior}


def test_known_outcomes_are_not_estimated():
    estimates = need.estimate([household(1, "needs_ride"), household(2)], set(), smoothing=False)
    assert set(estimates) == {"h2"}


def test_nomination_raises_sharply():
    plain = need.estimate([household(1)], set(), smoothing=False)["h1"]
    nominated = need.estimate([household(1)], {"h1"}, smoothing=False)["h1"]
    assert plain == 0.2 and nominated > 0.6


def test_smoothing_moves_toward_answered_neighbors_only_when_on():
    homes = [household(1)] + [household(i, "needs_accessible", lng=-118.1501) for i in range(2, 6)]
    off = need.estimate(homes, set(), smoothing=False)["h1"]
    on = need.estimate(homes, set(), smoothing=True)["h1"]
    assert off == 0.2 and on > 0.5


def test_smoothing_leaves_a_known_need_alone():
    known = {**household(1, prior=0.9), "priorKnown": True}
    homes = [known] + [household(i, "leaving", lng=-118.1501) for i in range(2, 6)]
    assert need.estimate(homes, set(), smoothing=True)["h1"] == 0.9


def test_aging_lets_any_home_reach_the_top():
    alpha = door.alpha_for([0.1, 0.5, 1.0, 2.0], door.DoorConfig())
    isolated = door.need_urgency_term(0.02, 200, 30)
    best_fresh = door.need_urgency_term(0.9, 20, 1)
    minutes = next(m for m in range(0, 2000) if door.priority(isolated, m, alpha) > best_fresh)
    assert minutes < 120


def test_unreachable_home_stays_on_the_list():
    assert door.need_urgency_term(0.5, 60, math.inf) > 0
