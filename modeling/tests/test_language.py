import pytest

from rollcall_d.addresses import AddressBook, AddressPoint, match
from rollcall_d.spoken_numbers import digits_in, say_en, say_es


@pytest.mark.parametrize("n", [5, 45, 100, 486, 705, 1010, 1182, 1250, 2000, 2609, 3100, 3255])
def test_spoken_numbers_round_trip(n):
    assert digits_in(say_en(n))[0][0] == str(n)
    assert digits_in(say_es(n))[0][0] == str(n)


def test_digit_by_digit_and_pairs():
    assert digits_in("two six zero nine lincoln")[0][0] == "2609"
    assert digits_in("twenty six oh nine lincoln")[0][0] == "2609"


@pytest.fixture
def book():
    return AddressBook([
        AddressPoint("486", "West Mariposa Street", "mariposa", "west", 34.1952, -118.158),
        AddressPoint("486", "East Mariposa Street", "mariposa", "east", 34.1910, -118.130),
        AddressPoint("2609", "North Lincoln Avenue", "lincoln", "north", 34.1906, -118.159),
    ])


def test_spoken_spanish_address_matches(book):
    assert match("dos mil seiscientos nueve avenida lincoln", [book]).point.number == "2609"


def test_direction_disambiguates(book):
    assert match("486 West Mariposa", [book]).point.street == "West Mariposa Street"


def test_nominator_location_disambiguates(book):
    assert match("486 Mariposa", [book], near=(34.1950, -118.1585)).point.street == "West Mariposa Street"


def test_ambiguous_without_context_is_flagged(book):
    result = match("486 Mariposa", [book])
    assert result.point is None and "two streets match" in result.note


def test_relative_reference_is_flagged(book):
    result = match("the lady next door", [book])
    assert result.point is None and "without an address" in result.note


def test_unknown_number_is_flagged(book):
    assert match("1234 Mariposa", [book]).note == "street found but not that house number"
