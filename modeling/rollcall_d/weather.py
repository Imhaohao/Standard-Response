"""Live wind from the National Weather Service gridded forecast (api.weather.gov, no key needed).

The gridpoint endpoint gives 10 m sustained wind speed (km/h) and the direction the wind blows FROM, each
as runs of values over ISO 8601 intervals ("2026-10-24T09:00:00+00:00/PT6H"). We expand those runs to one
value per hour across the window the fire scenario covers.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import requests

API = "https://api.weather.gov"
USER_AGENT = "rollcall-calhacks (modeling/rollcall_d/weather.py)"
DURATION = re.compile(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?")


@dataclass(frozen=True)
class WindHour:
    at: datetime
    speed_kmh: float
    from_degrees: float  # meteorological: where the wind comes from, clockwise from north
    gust_kmh: float | None

    @property
    def heading_degrees(self) -> float:
        """Where the wind (and the head of the fire) is going."""
        return (self.from_degrees + 180.0) % 360.0


@dataclass(frozen=True)
class WindForecast:
    office: str
    grid: str
    updated: str
    fetched: str
    hours: list[WindHour]


def parse_interval(valid_time: str) -> tuple[datetime, timedelta]:
    start, duration = valid_time.split("/")
    days, hours, minutes = (int(part or 0) for part in DURATION.fullmatch(duration).groups())
    return datetime.fromisoformat(start), timedelta(days=days, hours=hours, minutes=minutes)


def hourly(values: list[dict], start: datetime, end: datetime) -> dict[datetime, float]:
    """Expand interval runs into {hour: value} for every whole hour in [start, end)."""
    out: dict[datetime, float] = {}
    for entry in values:
        if entry.get("value") is None:
            continue
        begin, length = parse_interval(entry["validTime"])
        hour = begin
        while hour < begin + length:
            if start <= hour < end:
                out[hour] = float(entry["value"])
            hour += timedelta(hours=1)
    return out


def wind_hours(properties: dict, start: datetime, hours: int) -> list[WindHour]:
    start = start.replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(hours=hours)
    speed = hourly(properties["windSpeed"]["values"], start, end)
    direction = hourly(properties["windDirection"]["values"], start, end)
    gust = hourly(properties.get("windGust", {}).get("values", []), start, end)
    return [WindHour(at, speed[at], direction[at], gust.get(at)) for at in sorted(speed) if at in direction]


def fetch_wind(lat: float, lng: float, hours: int, now: datetime | None = None, timeout: float = 20.0) -> WindForecast:
    """The NWS wind forecast for the next `hours` hours at a point. Raises on any network or shape error."""
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/geo+json"})
    point = session.get(f"{API}/points/{lat:.4f},{lng:.4f}", timeout=timeout)
    point.raise_for_status()
    grid_url = point.json()["properties"]["forecastGridData"]
    grid = session.get(grid_url, timeout=timeout)
    grid.raise_for_status()
    properties = grid.json()["properties"]
    now = now or datetime.now(timezone.utc)
    found = wind_hours(properties, now, hours)
    if not found:
        raise ValueError(f"NWS grid {grid_url} has no wind values for the next {hours} hours")
    office, cell = grid_url.rsplit("/gridpoints/", 1)[1].split("/", 1)
    return WindForecast(office, cell, properties.get("updateTime", ""), now.isoformat(timespec="seconds"), found)
