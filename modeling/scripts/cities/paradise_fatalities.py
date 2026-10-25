"""Where Camp Fire victims were found, as counts on a coarse grid, and how much time each place had.

The Butte County District Attorney published a Google Earth file with a placemark for each victim
alongside "The Camp Fire Public Report" (June 2020). This script reads that file, discards every name
and description, and keeps only how many victims were found in each 0.01-degree cell (about
0.9 km x 1.1 km) inside the Paradise frame. For each placemark it also measures the minutes from
minute 0 (07:46 PST) to the first NIST TN 2135 fire observation within 250 m, before rounding it away.

Writes data/cities/paradise/fatalities.json.

    cd modeling && uv run python scripts/cities/paradise_fatalities.py
"""

from __future__ import annotations

import io
import json
import math
import re
import zipfile
from collections import Counter
from pathlib import Path

import tempfile

import requests

REPO = Path(__file__).resolve().parents[3]
OBSERVATIONS = REPO / "data" / "cities" / "paradise" / "nist-observations.json"
OUTPUT = REPO / "data" / "cities" / "paradise" / "fatalities.json"
KMZ_URL = "https://web.archive.org/web/20220309060121/https://www.buttecounty.net/Portals/30/CFReport/Camp-Fire-Victim-Locations.kmz"
FRAME = {"west": -121.668, "south": 39.716, "east": -121.552, "north": 39.811}
CELL_DEGREES = 0.01
NEAR_M = 250.0
WARNING_MINUTES = 7 * 60 + 46


CACHED_KMZ = Path(tempfile.gettempdir()) / "standard-response-cities" / "Camp-Fire-Victim-Locations.kmz"


def kmz_bytes() -> bytes:
    if CACHED_KMZ.exists():
        return CACHED_KMZ.read_bytes()
    response = requests.get(KMZ_URL, timeout=120)
    response.raise_for_status()
    CACHED_KMZ.parent.mkdir(parents=True, exist_ok=True)
    CACHED_KMZ.write_bytes(response.content)
    return response.content


def placemark_points() -> list[tuple[float, float]]:
    with zipfile.ZipFile(io.BytesIO(kmz_bytes())) as archive:
        kml = next(archive.read(name).decode("utf-8", "replace") for name in archive.namelist() if name.endswith(".kml"))
    points = []
    for block in re.findall(r"<Point>.*?</Point>", kml, flags=re.S):
        lng, lat = (float(v) for v in re.search(r"<coordinates>\s*([-\d.]+),([-\d.]+)", block).groups())
        points.append((lng, lat))
    return points


def in_frame(lng: float, lat: float) -> bool:
    return FRAME["west"] <= lng <= FRAME["east"] and FRAME["south"] <= lat <= FRAME["north"]


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111_320 * math.cos(math.radians(39.76))
    dy = (a[1] - b[1]) * 110_540
    return math.hypot(dx, dy)


def minutes_to_fire(point: tuple[float, float], observations: list[dict]) -> int | None:
    times = [o["minutesAfterMidnight8Nov"] for o in observations if metres(point, (o["lng"], o["lat"])) <= NEAR_M]
    return min(times) - WARNING_MINUTES if times else None


def percentile(values: list[int], share: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(share * (len(ordered) - 1) + 0.5))]


def main() -> None:
    observations = [o for o in json.loads(OBSERVATIONS.read_text())["observations"] if o["date"] == "2018-11-08"]
    every_point = placemark_points()
    points = [p for p in every_point if in_frame(*p)]
    cells = Counter((math.floor(lng / CELL_DEGREES), math.floor(lat / CELL_DEGREES)) for lng, lat in points)
    lead = [m for m in (minutes_to_fire(p, observations) for p in points) if m is not None]
    payload = {
        "source": KMZ_URL,
        "publisher": "Butte County District Attorney, The Camp Fire Public Report (June 2020), victim locations file",
        "privacy": "Names, descriptions and exact points are discarded; only counts per 0.01-degree cell are kept.",
        "placemarksInFile": len(every_point),
        "victimsInFrame": len(points),
        "cellDegrees": CELL_DEGREES,
        "cells": [
            {"west": round(x * CELL_DEGREES, 2), "south": round(y * CELL_DEGREES, 2), "count": n}
            for (x, y), n in sorted(cells.items())
        ],
        "minutesFromFirstOrderToFireWithin250m": {
            "what": "Per victim location: first NIST TN 2135 observation within 250 m, minus 07:46 PST",
            "locationsWithAnObservation": len(lead),
            "min": min(lead),
            "p25": percentile(lead, 0.25),
            "median": percentile(lead, 0.5),
            "p75": percentile(lead, 0.75),
            "max": max(lead),
            "within30Minutes": sum(1 for m in lead if m <= 30),
            "within60Minutes": sum(1 for m in lead if m <= 60),
        },
    }
    OUTPUT.write_text(json.dumps(payload, indent=1) + "\n")
    print(json.dumps({k: v for k, v in payload.items() if k != "cells"}, indent=1))


if __name__ == "__main__":
    main()
