from rollcall_d.eaton import Record, clean_location, parse_place, parse_time, says_fire, says_help
from rollcall_d.eaton_replay import needs_ride


def record(text):
    return Record(1, parse_time("1/8/2025", "05:26"), "LA County Dispatch", "", text)


def test_reads_the_24_hour_clock_in_pacific_time():
    moment = parse_time("1/7/2025", "22:50")
    assert (moment.hour, moment.minute, moment.utcoffset().total_seconds()) == (22, 50, -8 * 3600)


def test_drops_the_city_and_prefix_from_a_dispatch_location():
    assert clean_location("LOC: 1** E HARRIET ST ,ALTD") == "1** E HARRIET ST"
    assert clean_location("13** N Altadena Dr, Pasadena") == "13** N Altadena Dr"


def test_reads_a_redacted_house_number_as_its_block():
    place = parse_place("25** N PORTER AV ,ALTD")
    assert (place.kind, place.low, place.high, place.streets) == ("block", 2500, 2599, ("N PORTER AV",))


def test_reads_an_intersection():
    place = parse_place("GLEN AV/W PALM ST ,ALTD")
    assert (place.kind, place.streets) == ("intersection", ("GLEN AV", "W PALM ST"))


def test_a_power_line_alone_does_not_date_the_fire_front():
    assert not says_fire(record("GEO:POWER LINE ON FIRE"))
    assert says_fire(record("TXT: HOUSE ON FIRE"))
    assert says_fire(record("POWER LINE DOWN, HOUSE ON FIRE"))


def test_picks_out_a_request_for_help_getting_out():
    assert says_help(record("FIRE IN YARD, NEEDS HELP EVAC F.ELD, RP NOT AT LOC"))
    assert says_help(record("2 DISABLED PTS STUCK IN HOME, BACKYARD NOW ON FIRE"))
    assert not says_help(record("KITCHEN SMOKE"))


def test_needs_ride_matches_the_contract_outcome():
    home = {"mobility": "walker", "medical": [], "canLeave": "yes", "hasCar": True}
    assert not needs_ride(home)  # outcomeFor says "leaving"
    assert needs_ride({**home, "hasCar": False})
    assert needs_ride({**home, "mobility": "manual_wheelchair"})
    assert needs_ride({**home, "canLeave": "unsure"})
    assert needs_ride({**home, "medical": ["oxygen"]})
