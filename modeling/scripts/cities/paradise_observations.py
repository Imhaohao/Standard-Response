"""Extract every dated, geolocated fire observation from NIST TN 2135, Appendix F.

NIST Technical Note 2135 (Maranghides et al. 2021, "A Case Study of the Camp Fire - Fire Progression
Timeline") lists about 2,200 observations of where fire was and when on 8-9 November 2018, each with a
latitude, longitude and local time (PST). This script downloads the report, reads Appendix F with
`pdftotext -layout`, and writes the rows to data/cities/paradise/nist-observations.json.

    cd modeling && uv run python scripts/cities/paradise_observations.py
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from pathlib import Path

import requests

REPORT_URL = "https://nvlpubs.nist.gov/nistpubs/TechnicalNotes/NIST.TN.2135.pdf"
APPENDIX_F_PDF_PAGES = (286, 397)
APPENDIX_B_PDF_PAGES = (196, 259)
REPO = Path(__file__).resolve().parents[3]
OUTPUT = REPO / "data" / "cities" / "paradise" / "nist-observations.json"
BURNOVERS = REPO / "data" / "cities" / "paradise" / "nist-burnovers.json"
CACHE = Path(tempfile.gettempdir()) / "standard-response-cities"

ROW = re.compile(
    r"(?P<date>11/\d{1,2})\s+(?P<time>\d\d:\d\d)\s+(?P<middle>.*?)\s"
    r"(?P<lat>3\d\.\d{4,})\s+(?P<lng>-12\d\.\d{4,})\s+(?P<rest>.*)$"
)
WINDOW = re.compile(r"\s(\d+)\s*$")
FIRE_TYPE = re.compile(r"\s(?P<type>[SVRCO])(?:\s+(?P<residual>x))?\s*$")
REGIONS = (
    "Concow", "Pentz Road", "Feather River Hospital", "Wagstaff Road", "Bille Road", "Elliott Road",
    "Pearson Road", "Clark Road", "Butte Creek Canyon", "Skyway", "Neal Road", "Valley View Drive",
    "Foothills", "Nelson Bar Road", "Magalia",
)


def download_report() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    pdf = CACHE / "NIST.TN.2135.pdf"
    if pdf.exists() and pdf.stat().st_size > 70_000_000:
        return pdf
    with requests.get(REPORT_URL, stream=True, timeout=120) as response:
        response.raise_for_status()
        with pdf.open("wb") as out:
            for chunk in response.iter_content(1 << 20):
                out.write(chunk)
    return pdf


def appendix_pages(pdf: Path, pages: tuple[int, int] = APPENDIX_F_PDF_PAGES) -> list[str]:
    first, last = pages
    text = subprocess.run(
        ["pdftotext", "-f", str(first), "-l", str(last), "-layout", str(pdf), "-"],
        check=True, capture_output=True, text=True,
    ).stdout
    return text.split("\f")


def region_of(page: str, previous: str) -> str:
    head = "\n".join(page.split("\n")[:8])
    for region in REGIONS:
        if region in head:
            return region
    return previous


def parse_row(match: re.Match[str], region: str) -> dict:
    window = WINDOW.search(" " + match["middle"])
    fire = FIRE_TYPE.search(match["rest"])
    hour, minute = (int(part) for part in match["time"].split(":"))
    day = int(match["date"].split("/")[1])
    return {
        "region": region,
        "date": f"2018-11-{day:02d}",
        "time": match["time"],
        "minutesAfterMidnight8Nov": (day - 8) * 1440 + hour * 60 + minute,
        "windowMinutes": int(window.group(1)) if window else None,
        "lat": float(match["lat"]),
        "lng": float(match["lng"]),
        "fireType": fire["type"] if fire else None,
        "residual": bool(fire and fire["residual"]),
        "sourcesAndObservation": FIRE_TYPE.sub("", match["rest"]).strip(),
    }


def observations(pages: list[str]) -> list[dict]:
    rows, seen, region = [], set(), REGIONS[0]
    for page in pages:
        region = region_of(page, region)
        for line in page.split("\n"):
            match = ROW.search(line)
            if not match:
                continue
            row = parse_row(match, region)
            key = (row["minutesAfterMidnight8Nov"], row["lat"], row["lng"], row["sourcesAndObservation"])
            if key not in seen:
                seen.add(key)
                rows.append(row)
    return sorted(rows, key=lambda r: r["minutesAfterMidnight8Nov"])


BURNOVER = re.compile(
    r"^\s*(?P<number>\d+)\. (?P<name>.+?)\s*\n\s*Date/Time:\s+(?P<when>.+?)\s*\n\s*Location:\s+(?P<location>.+?)\s*\n"
    r"\s*Coordinates:\s+\[(?P<lat>3\d\.\d+), (?P<lng>-12\d\.\d+)\]",
    re.MULTILINE,
)


def burnovers(pages: list[str]) -> list[dict]:
    """Appendix B: the 19 places where fire burned over a road, with when and where."""
    text = "\f".join(pages)
    return [
        {
            "number": int(m["number"]),
            "name": m["name"],
            "when": re.sub(r"\s+", " ", m["when"]).replace(",", ", ").replace(",  ", ", "),
            "location": m["location"],
            "lat": float(m["lat"]),
            "lng": float(m["lng"]),
        }
        for m in BURNOVER.finditer(text)
    ]


def main() -> None:
    pdf = download_report()
    roads = burnovers(appendix_pages(pdf, APPENDIX_B_PDF_PAGES))
    BURNOVERS.write_text(json.dumps({"source": REPORT_URL, "extractedFrom": "Appendix B. Burnover Data", "timezone": "PST (UTC-8)", "burnovers": roads}, indent=1) + "\n")
    print(f"{len(roads)} burnovers -> {BURNOVERS.relative_to(REPO)}")
    rows = observations(appendix_pages(pdf))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": REPORT_URL,
        "citation": "Maranghides A, Link E, Mell W, Hawks S, Wilson M, Brewer W, Brown C, Vihnaneck B, "
        "Walton WD (2021) A Case Study of the Camp Fire - Fire Progression Timeline. NIST Technical Note 2135. "
        "https://doi.org/10.6028/NIST.TN.2135",
        "extractedFrom": "Appendix F. Fire Spread Data (report pages 256-366)",
        "timezone": "America/Los_Angeles (PST, UTC-8)",
        "count": len(rows),
        "observations": rows,
    }
    lines = ",\n".join(json.dumps(row) for row in rows)
    header = json.dumps({k: v for k, v in payload.items() if k != "observations"}, indent=1)[:-2]
    OUTPUT.write_text(header + ',\n "observations": [\n' + lines + "\n ]\n}\n")
    print(f"{len(rows)} observations -> {OUTPUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
