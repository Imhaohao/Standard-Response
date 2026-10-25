"""Buffalo blizzard scenario, 23-29 December 2022, framed on Buffalo's East Side.

Inputs, all under data/cities/buffalo/:
  kbuf-hourly.json, kbuf-daily.json   from buffalo_weather.py
  reported.json                       numbers typed in from NWS, NYU Wagner, NYS DHSES, WIVB, WKBW

Writes data/cities/buffalo/scenario.json: hourly series of wind, gust, visibility, temperature, wind
chill, snowfall rate and storm-total snowfall at KBUF; daily snow depth; street-class closures; city
power outages; and the arrival-time fronts.

Minute 0 is 09:30 EST on 23 December, when Erie County's travel ban took effect. The front is the time
the East Side became unreachable by ordinary vehicles: 15:00, when whiteout conditions stopped road
operations in Buffalo (minute 330). No source gives a different time for any part of the East Side,
so there is one front covering the whole frame.

    cd modeling && uv run python scripts/cities/buffalo_scenario.py
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CITY = REPO / "data" / "cities" / "buffalo"
OUTPUT = CITY / "scenario.json"
MINUTE_ZERO = datetime.fromisoformat("2022-12-23T09:30:00-05:00")
UNREACHABLE_AT = datetime.fromisoformat("2022-12-23T15:00:00-05:00")
# lib/cities.ts, buffalo: `extent`, which is `detail` grown by 0.015 degrees on every side.
FRAME = {"west": -78.887, "south": 42.857, "east": -78.793, "north": 42.923}
LABEL = "Reconstruction of a past storm, not a forecast"


def minutes_after_warning(at: datetime) -> int:
    return round((at - MINUTE_ZERO).total_seconds() / 60)


def local(text: str) -> datetime:
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else datetime.fromisoformat(text + "-05:00")


def cumulative_snow_at(points: list[dict], at: datetime) -> float:
    if at <= local(points[0]["at"]):
        return points[0]["inches"]
    for before, after in zip(points, points[1:]):
        start, end = local(before["at"]), local(after["at"])
        if start <= at <= end:
            share = (at - start) / (end - start) if end > start else 1.0
            return round(before["inches"] + share * (after["inches"] - before["inches"]), 1)
    return points[-1]["inches"]


def hourly_series(reported: dict) -> list[dict]:
    snow_points = reported["snowfallCumulativeKBUF"]["points"]
    rows = json.loads((CITY / "kbuf-hourly.json").read_text())["observations"]
    series = []
    for row in rows:
        at = local(row["at"])
        total = cumulative_snow_at(snow_points, at)
        hour_ago = cumulative_snow_at(snow_points, at - timedelta(hours=1))
        series.append({
            "at": at.isoformat(),
            "minutesAfterWarning": minutes_after_warning(at),
            "windMph": row["windMph"],
            "gustMph": row["gustMph"],
            "windFromDegrees": row["windFromDegrees"],
            "visibilityMiles": row["visibilityMiles"],
            "temperatureF": row["temperatureF"],
            "windChillF": row["windChillF"],
            "presentWeather": row["presentWeather"],
            "stormSnowfallInches": total,
            "snowfallInchesPerHour": round(total - hour_ago, 2),
        })
    return series


def daily_snow_depth() -> list[dict]:
    days = json.loads((CITY / "kbuf-daily.json").read_text())["days"]
    return [{"date": d["date"], "snowDepthInches": d["snowDepthInches"], "snowfallInches": d["snowfallInches"]} for d in days]


def with_minutes(event: dict | None) -> dict | None:
    if event is None:
        return None
    return {**event, "minutesAfterWarning": minutes_after_warning(local(event["at"]))}


def street_classes(reported: dict) -> list[dict]:
    keys = ("closed", "impassable", "firstPass", "reopened", "legallyOpen")
    return [
        {k: v for k, v in street.items() if k not in keys} | {k: with_minutes(street.get(k)) for k in keys if k in street}
        for street in reported["roadStatusByStreetClass"]["classes"]
    ]


def outages(reported: dict) -> list[dict]:
    return [
        {**point, "minutesAfterWarning": minutes_after_warning(local(point["at"]))}
        for point in reported["cityOutagesNationalGrid"]["points"]
    ]


def frame_ring() -> list[list[float]]:
    w, s, e, n = FRAME["west"], FRAME["south"], FRAME["east"], FRAME["north"]
    return [[w, s], [e, s], [e, n], [w, n], [w, s]]


def seed_ring() -> list[list[float]]:
    lng = round((FRAME["west"] + FRAME["east"]) / 2, 6)
    lat = round((FRAME["south"] + FRAME["north"]) / 2, 6)
    d = 0.00001
    return [[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]


# lib/ink-map/fire-field.ts ramps points deep inside the first front up to 30 minutes earlier than its
# minute. A one-metre seed front at the same minute makes the whole frame read exactly minute 330.
def fronts() -> dict:
    minute = minutes_after_warning(UNREACHABLE_AT)
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {"minutesAfterWarning": minute, "meaning": "seed so the arrival field holds 330 inside the frame", "label": LABEL},
            "geometry": {"type": "Polygon", "coordinates": [seed_ring()]},
        }, {
            "type": "Feature",
            "properties": {
                "minutesAfterWarning": minutes_after_warning(UNREACHABLE_AT),
                "clockTime": UNREACHABLE_AT.isoformat(),
                "meaning": "unreachable by ordinary vehicles: whiteout stopped road operations in Buffalo",
                "label": LABEL,
            },
            "geometry": {"type": "Polygon", "coordinates": [frame_ring()]},
        }],
    }


def main() -> None:
    reported = json.loads((CITY / "reported.json").read_text())
    hourly = hourly_series(reported)
    scenario = {
        "id": "buffalo",
        "label": LABEL,
        "basis": "KBUF hourly observations (Iowa Environmental Mesonet), NWS Buffalo snowfall reports and winter summary, "
        "the NYU Wagner review commissioned by the City of Buffalo, and New York State's after-action review.",
        "minuteZero": {"at": MINUTE_ZERO.isoformat(), "what": "Erie County travel ban takes effect"},
        "frame": FRAME,
        "fronts": fronts(),
        "series": {
            "hourlyKBUF": hourly,
            "dailySnowDepthKBUF": daily_snow_depth(),
            "streetClasses": street_classes(reported),
            "cityCustomersWithoutPower": outages(reported),
        },
        "deaths": reported["deaths"],
        "emergencyResponse": reported["emergencyResponse"],
    }
    OUTPUT.write_text(json.dumps(scenario, indent=1) + "\n")
    blizzard = [h for h in hourly if (h["visibilityMiles"] or 9) <= 0.25]
    print(f"{len(hourly)} hours, {len(blizzard)} at <= 1/4 mile, storm total {hourly[-1]['stormSnowfallInches']} in, front at minute {minutes_after_warning(UNREACHABLE_AT)}")


if __name__ == "__main__":
    main()
