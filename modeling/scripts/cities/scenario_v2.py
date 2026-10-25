"""Write public/scenarios/paradise.json and public/scenarios/buffalo.json in scenario file v2.

The format is defined in lib/ink-map/scenario.ts. Every time is minutes after `clock.warningAt`.
Inputs are the intermediate files under data/cities/<id>/, built by the other scripts in this folder.

    cd modeling && uv run python scripts/cities/scenario_v2.py
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CITIES = REPO / "data" / "cities"
PUBLIC = REPO / "public" / "scenarios"
MPH_TO_MPS = 0.44704
MILES_TO_M = 1609.344
INCH_TO_CM = 2.54
SNOW_DEPTH_HOUR = "07:00"


def write(city: str, scenario: dict) -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)
    path = PUBLIC / f"{city}.json"
    path.write_text(json.dumps(scenario, separators=(",", ":")) + "\n")
    print(f"{path.relative_to(REPO)}: {len(scenario['fronts']['features'])} fronts, {path.stat().st_size // 1024} KB")


def bare_fronts(collection: dict) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"minutesAfterWarning": f["properties"]["minutesAfterWarning"]}, "geometry": f["geometry"]}
            for f in collection["features"]
        ],
    }


def paradise() -> dict:
    fronts = json.loads((CITIES / "paradise" / "fronts.geojson").read_text())
    meta = fronts["metadata"]
    return {
        "version": 2,
        "city": "paradise",
        "kind": "wildfire",
        "label": "Scenario input from the 2018 record, not a forecast",
        "basis": "Fronts drawn from NIST's 2,159 timed fire observations of 8 November 2018 (NIST TN 2135, Appendix F), "
        "clipped to CAL FIRE's final perimeter. Minute 0 is 07:46, the first evacuation order inside Paradise (NIST TN 2252). "
        f"Between observations the fire is assumed to spread {meta['speedMetersPerMinute']:g} m a minute.",
        "sources": [
            {"label": "NIST TN 2135, A Case Study of the Camp Fire: Fire Progression Timeline (2021)", "url": "https://doi.org/10.6028/NIST.TN.2135"},
            {"label": "NIST TN 2252, Camp Fire: Notification, Evacuation, Traffic, and Temporary Refuge Areas (2023)", "url": "https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2252.pdf"},
            {"label": "CAL FIRE final Camp Fire perimeter, via NIFC InterAgency Fire Perimeter History", "url": meta["clippedTo"]["source"]},
            {"label": "CAL FIRE ECC Camp Incident Chronology, 8 November 2018", "url": "https://www.nist.gov/system/files/documents/2020/11/16/ECC%20Camp%20Inc%20Chronology%20of%20events_Redacted.pdf"},
            {"label": "Butte County District Attorney, The Camp Fire Public Report (2020)", "url": "https://web.archive.org/web/20210903004619/http://www.buttecounty.net/Portals/30/CFReport/PGE-THE-CAMP-FIRE-PUBLIC-REPORT.pdf"},
            {"label": "Every source and assumption: data/cities/paradise/sources.md"},
        ],
        "clock": {"warningAt": meta["warningClock"], "minutesShown": fronts["features"][-1]["properties"]["minutesAfterWarning"]},
        "fronts": bare_fronts(fronts),
        # NIST TN 2135 Sec. 5.3 and 16.3.2: northeast winds drove the fire west and southwest through Paradise.
        "series": {"headingDegrees": 225, "headSpreadMetersPerMinute": meta["speedMetersPerMinute"]},
    }


def minutes_between(warning_at: datetime, at: str) -> int:
    return round((datetime.fromisoformat(at) - warning_at).total_seconds() / 60)


def snow_depth_cm_at(depths: list[tuple[datetime, float]], at: datetime) -> float:
    if at <= depths[0][0]:
        return depths[0][1]
    for (t0, d0), (t1, d1) in zip(depths, depths[1:]):
        if t0 <= at <= t1:
            return d0 + (d1 - d0) * (at - t0) / (t1 - t0)
    return depths[-1][1]


def daily_depths(intermediate: dict) -> list[tuple[datetime, float]]:
    return [
        (datetime.fromisoformat(f"{day['date']}T{SNOW_DEPTH_HOUR}:00-05:00"), day["snowDepthInches"] * INCH_TO_CM)
        for day in intermediate["series"]["dailySnowDepthKBUF"]
        if day["snowDepthInches"] is not None
    ]


def blizzard_series(intermediate: dict, warning_at: datetime) -> dict:
    hours = [h for h in intermediate["series"]["hourlyKBUF"] if h["windMph"] is not None and h["visibilityMiles"] is not None]
    depths = daily_depths(intermediate)
    snow = [
        {
            "minutes": h["minutesAfterWarning"],
            "rateCmPerHour": round(h["snowfallInchesPerHour"] * INCH_TO_CM, 2),
            "depthCm": round(snow_depth_cm_at(depths, datetime.fromisoformat(h["at"])), 1),
        }
        for h in hours
    ]
    wind = [
        {
            "minutes": h["minutesAfterWarning"],
            "fromDegrees": h["windFromDegrees"] or 0,
            "metersPerSecond": round(h["windMph"] * MPH_TO_MPS, 1),
            **({"gustMetersPerSecond": round(h["gustMph"] * MPH_TO_MPS, 1)} if h["gustMph"] is not None else {}),
        }
        for h in hours
    ]
    visibility = [{"minutes": h["minutesAfterWarning"], "meters": round(h["visibilityMiles"] * MILES_TO_M)} for h in hours]
    return {"snow": snow, "wind": wind, "visibility": visibility, "roadClosures": road_closures(intermediate)}


def road_closures(intermediate: dict) -> list[dict]:
    closures = []
    for street in intermediate["series"]["streetClasses"]:
        closed = street.get("closed") or street.get("impassable")
        reopened = street.get("reopened") or street.get("firstPass")
        closures.append({
            "road": f"{street['class'].capitalize()}s ({street['examples']})" if "examples" in street else "Side streets",
            "closedAtMinutes": closed["minutesAfterWarning"],
            "reopensAtMinutes": reopened["minutesAfterWarning"],
        })
    return closures


def buffalo() -> dict:
    intermediate = json.loads((CITIES / "buffalo" / "scenario.json").read_text())
    warning_at = datetime.fromisoformat(intermediate["minuteZero"]["at"])
    arterial_plowed = next(s["firstPass"]["minutesAfterWarning"] for s in intermediate["series"]["streetClasses"] if s["class"] == "arterial")
    return {
        "version": 2,
        "city": "buffalo",
        "kind": "blizzard",
        "label": "Scenario input from the 2022 record, not a forecast",
        "basis": "Hourly weather at Buffalo Niagara Airport (KBUF), NWS Buffalo snowfall reports, and the street, power and 911 "
        "timeline in the NYU Wagner review for the City of Buffalo. Minute 0 is 09:30 on 23 December, when Erie County's travel "
        "ban took effect. The front is 15:00, when whiteout stopped road operations and the East Side became unreachable.",
        "sources": [
            {"label": "KBUF hourly observations, Iowa Environmental Mesonet ASOS archive", "url": "https://mesonet.agron.iastate.edu/request/download.phtml?network=NY_ASOS"},
            {"label": "KBUF daily snowfall and snow depth, NOAA NCEI GHCN-Daily USW00014733", "url": "https://www.ncei.noaa.gov/access/services/data/v1?dataset=daily-summaries&stations=USW00014733&startDate=2022-12-20&endDate=2023-01-02&units=standard&format=csv"},
            {"label": "NWS Buffalo Public Information Statements, 21 to 31 December 2022", "url": "https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=PNSBUF&sdate=2022-12-21&edate=2022-12-31&limit=100&fmt=text"},
            {"label": "NWS Buffalo Winter Summary 2022-23", "url": "https://www.weather.gov/media/buf/Winter_Summary_2022_23.pdf"},
            {"label": "NYU Wagner, Lessons Learned from the Buffalo Blizzard (2023)", "url": "https://wagner.nyu.edu/files/faculty/publications/NYU%20Buffalo%20Blizzard%20Report%20-%20June2023_0.pdf"},
            {"label": "NYS DHSES after-action review of the Buffalo blizzard response (2023)", "url": "https://www.dhses.ny.gov/system/files/documents/2023/08/nys-aar-on-buffalo-blizzard-response.pdf"},
            {"label": "Every source and assumption: data/cities/buffalo/sources.md"},
        ],
        "clock": {"warningAt": warning_at.isoformat(), "minutesShown": arterial_plowed},
        "fronts": bare_fronts(intermediate["fronts"]),
        "series": blizzard_series(intermediate, warning_at),
    }


def main() -> None:
    write("paradise", paradise())
    write("buffalo", buffalo())


if __name__ == "__main__":
    main()
