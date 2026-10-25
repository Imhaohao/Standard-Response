from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from rollcall_d.ensemble import FLOOR_RATE, burn_quantiles, draw_members, head_rate_for, length_to_breadth_for
from rollcall_d.weather import WindHour, parse_interval, wind_hours

START = datetime(2026, 10, 24, 9, tzinfo=timezone.utc)


def test_parse_interval_reads_days_and_hours():
    begin, length = parse_interval("2026-10-24T09:00:00+00:00/P1DT6H")
    assert begin == START
    assert length == timedelta(days=1, hours=6)


def test_wind_hours_expands_runs_and_drops_hours_outside_the_window():
    properties = {
        "windSpeed": {"values": [{"validTime": "2026-10-24T06:00:00+00:00/PT6H", "value": 20.0}]},
        "windDirection": {"values": [{"validTime": "2026-10-24T09:00:00+00:00/PT1H", "value": 40}, {"validTime": "2026-10-24T10:00:00+00:00/PT3H", "value": 70}]},
    }
    hours = wind_hours(properties, START + timedelta(minutes=20), 3)
    assert [h.at.hour for h in hours] == [9, 10, 11]
    assert [h.from_degrees for h in hours] == [40, 70, 70]
    assert hours[0].heading_degrees == 220


def test_head_rate_follows_ten_percent_rule_above_the_floor():
    assert head_rate_for(36.0) == pytest.approx(60.0)  # 36 km/h is 600 m/min
    assert head_rate_for(0.0) == FLOOR_RATE


def test_length_to_breadth_grows_with_wind_and_stays_bounded():
    assert length_to_breadth_for(0.0) == 1.0
    assert 1.0 < length_to_breadth_for(20.0) < length_to_breadth_for(40.0) <= 5.0


def test_members_scatter_around_the_forecast_wind():
    hours = [WindHour(START, 30.0, 40.0, None)]
    members = draw_members(hours, 200, seed=1)
    offsets = [((m.heading_degrees - 220 + 180) % 360) - 180 for m in members]
    assert abs(np.mean(offsets)) < 5
    assert 10 < np.std(offsets) < 30
    assert len({m.seed for m in members}) == 200


def test_quantile_means_share_of_members_burned_by_that_minute():
    arrivals = np.array([[[10.0]], [[20.0]], [[30.0]], [[40.0]], [[1e4]]])
    q = burn_quantiles(arrivals, [0.2, 0.6, 0.9])
    assert q[0.2][0, 0] == 10.0  # one of five members burned it by minute 10
    assert q[0.6][0, 0] == 30.0  # three of five by minute 30
    assert q[0.9][0, 0] == 1e4  # only four of five ever burn it


def test_a_members_wind_walks_around_its_own_mean():
    import math

    from rollcall_d import urban_spread

    walk = urban_spread.wind_walk(3, 0.0, 600.0, mean_heading=90.0, mean_kmh=20.0)
    headings = [math.degrees(h) for h in walk.headings]
    assert abs(np.mean(headings) - 90.0) < 20
    assert abs(np.mean(walk.speeds) - 20.0) < 6
    default = urban_spread.wind_walk(3, 0.0, 600.0)
    assert abs(np.mean([math.degrees(h) for h in default.headings]) - urban_spread.MEAN_HEADING_DEGREES) < 20
