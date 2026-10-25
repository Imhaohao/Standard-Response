"""Hourly and daily weather at Buffalo Niagara International Airport (KBUF), 22-31 December 2022.

Hourly: routine METARs from the Iowa Environmental Mesonet ASOS archive (temperature, sustained wind,
gust, direction, visibility, liquid precipitation, present weather, wind chill), in local time.
Daily: NOAA NCEI GHCN-Daily for station USW00014733 (snowfall, snow depth, max/min, fastest winds).

Writes data/cities/buffalo/kbuf-hourly.json and data/cities/buffalo/kbuf-daily.json.

    cd modeling && uv run python scripts/cities/buffalo_weather.py
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import requests

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "data" / "cities" / "buffalo"
HOURLY_URL = (
    "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=BUF"
    "&data=tmpf&data=sknt&data=gust&data=drct&data=vsby&data=p01i&data=wxcodes&data=feel"
    "&year1=2022&month1=12&day1=22&year2=2022&month2=12&day2=31&tz=America%2FNew_York"
    "&format=onlycomma&latlon=no&missing=M&trace=T&direct=no&report_type=3"
)
DAILY_URL = (
    "https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00014733"
    "&startDate=2022-12-20&endDate=2023-01-02&dataTypes=SNOW,SNWD,TMAX,TMIN,AWND,WSF2,WSF5,PRCP"
    "&units=standard&format=csv"
)
KNOTS_TO_MPH = 1.150779


def number(value: str) -> float | None:
    if value in ("M", ""):
        return None
    if value == "T":
        return 0.0
    return float(value)


def mph(knots: str) -> float | None:
    value = number(knots)
    return None if value is None else round(value * KNOTS_TO_MPH, 1)


def hourly_rows(text: str) -> list[dict]:
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        rows.append({
            "at": row["valid"].replace(" ", "T") + ":00",
            "temperatureF": number(row["tmpf"]),
            "windChillF": number(row["feel"]),
            "windMph": mph(row["sknt"]),
            "gustMph": mph(row["gust"]),
            "windFromDegrees": number(row["drct"]),
            "visibilityMiles": number(row["vsby"]),
            "liquidPrecipInches": number(row["p01i"]),
            "presentWeather": None if row["wxcodes"] == "M" else row["wxcodes"],
        })
    return rows


def blizzard_hours(rows: list[dict]) -> list[str]:
    """Hours meeting the NWS blizzard criteria at the observation: wind or gust >= 35 mph and visibility <= 1/4 mile."""
    return [
        r["at"]
        for r in rows
        if r["visibilityMiles"] is not None
        and r["visibilityMiles"] <= 0.25
        and max(r["windMph"] or 0, r["gustMph"] or 0) >= 35
    ]


def daily_rows(text: str) -> list[dict]:
    keys = {"SNOW": "snowfallInches", "SNWD": "snowDepthInches", "TMAX": "maxF", "TMIN": "minF",
            "AWND": "averageWindMph", "WSF2": "fastest2MinWindMph", "WSF5": "fastest5SecGustMph", "PRCP": "liquidPrecipInches"}
    return [
        {"date": row["DATE"], **{name: number(row[key].strip()) for key, name in keys.items() if key in row}}
        for row in csv.DictReader(io.StringIO(text))
    ]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    hourly = hourly_rows(requests.get(HOURLY_URL, timeout=120).text)
    daily = daily_rows(requests.get(DAILY_URL, timeout=120).text)
    criteria_hours = blizzard_hours(hourly)
    (OUT / "kbuf-hourly.json").write_text(json.dumps({
        "source": HOURLY_URL,
        "station": "KBUF Buffalo Niagara International Airport (ASOS), routine hourly METARs",
        "timezone": "America/New_York (EST, UTC-5); 'at' is local time",
        "note": "Wind converted from knots. Visibility in statute miles. Snow depth is not reported hourly; see kbuf-daily.json.",
        "hoursMeetingBlizzardCriteria": len(criteria_hours),
        "firstBlizzardCriteriaHour": criteria_hours[0] if criteria_hours else None,
        "lastBlizzardCriteriaHour": criteria_hours[-1] if criteria_hours else None,
        "observations": hourly,
    }, indent=1) + "\n")
    (OUT / "kbuf-daily.json").write_text(json.dumps({
        "source": DAILY_URL,
        "station": "USW00014733 Buffalo Niagara International Airport, GHCN-Daily",
        "days": daily,
    }, indent=1) + "\n")
    print(f"{len(hourly)} hourly rows, {len(criteria_hours)} hours meeting blizzard criteria "
          f"({criteria_hours[0] if criteria_hours else '-'} to {criteria_hours[-1] if criteria_hours else '-'}); {len(daily)} days")


if __name__ == "__main__":
    main()
