"""Download the public census inputs for the synthetic population and save compact extracts in data/census.

No API key: the Census Data API now requires one, so this reads the bulk files on www2.census.gov
(ACS 2019-2023 5-year table-based summary files and PUMS CSVs) and TIGERweb geometries. Large downloads
are cached in modeling/cache/census (git-ignored); only the small extracts are committed.

  blockgroups.geojson   block groups touching the study area, with ACS household controls
  tracts.json           tract disability counts for people 65+ (ACS B18101 is published down to tracts)
  pums_households.json  every PUMS household in the PUMAs covering the study area, with its people
"""

import csv
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.area import EAST, NORTH, SOUTH, WEST  # noqa: E402
from rollcall_d.paths import CENSUS  # noqa: E402

CACHE = Path(__file__).resolve().parents[1] / "cache" / "census"
WWW2 = "https://www2.census.gov/programs-surveys/acs"
SUMMARY = f"{WWW2}/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-{{table}}.dat"
PUMS = f"{WWW2}/data/pums/2023/5-Year/csv_{{kind}}ca.zip"
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/MapServer"
ENVELOPE = f"geometry={WEST},{SOUTH},{EAST},{NORTH}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"

# Household controls by block group (estimates, suffix E).
BG_COLUMNS = {
    "households": "B11001_E001",
    "hasMember65": "B11007_E002",
    "alone65": "B11007_E003",
    "noVehicleOwner": "B25044_E003",
    "noVehicleRenter": "B25044_E010",
}
# People 65+ with a disability, and all people 65+, by tract (B18101: sex by age by disability status).
TRACT_DISABLED_65 = ["B18101_E016", "B18101_E019", "B18101_E035", "B18101_E038"]
TRACT_ALL_65 = ["B18101_E015", "B18101_E018", "B18101_E034", "B18101_E037"]


def cached(url: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / url.rsplit("/", 1)[1]
    if not path.exists():
        print(f"downloading {url}")
        urllib.request.urlretrieve(url, path)
    return path


def tiger_geojson(layer: int, fields: str) -> dict:
    url = f"{TIGER}/{layer}/query?{ENVELOPE}&outFields={fields}&returnGeometry=true&outSR=4326&f=geojson"
    with urllib.request.urlopen(url, timeout=120) as response:
        return json.loads(response.read())


def summary_rows(table: str, geo_ids: set[str]) -> dict[str, dict[str, str]]:
    """Rows of a table-based summary file for the given GEO_IDs (e.g. 1500000US060374608001)."""
    rows = {}
    with cached(SUMMARY.format(table=table)).open() as handle:
        reader = csv.DictReader(handle, delimiter="|")
        for row in reader:
            if row["GEO_ID"] in geo_ids:
                rows[row["GEO_ID"]] = row
    return rows


def pums_rows(kind: str, pumas: set[str], columns: list[str]):
    with zipfile.ZipFile(cached(PUMS.format(kind=kind))) as archive:
        name = next(n for n in archive.namelist() if n.endswith(".csv"))
        with archive.open(name) as raw:
            for row in csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8")):
                if row["PUMA"].zfill(5) in pumas:
                    yield {c: row[c] for c in columns}


def number(value: str) -> int:
    return int(value) if value not in ("", None) else 0


def main() -> None:
    CENSUS.mkdir(parents=True, exist_ok=True)
    blockgroups = tiger_geojson(10, "GEOID")
    pumas = {f["properties"]["GEOID"][2:] for f in tiger_geojson(0, "GEOID")["features"]}
    bg_ids = {f"1500000US{f['properties']['GEOID']}": f for f in blockgroups["features"]}
    tract_ids = {f"1400000US{g[9:20]}" for g in bg_ids}

    bg_values: dict[str, dict] = {g: {} for g in bg_ids}
    for table in ("b11001", "b11007", "b25044"):
        for geo, row in summary_rows(table, set(bg_ids)).items():
            for key, column in BG_COLUMNS.items():
                if column in row:
                    bg_values[geo][key] = number(row[column])
    for geo, feature in bg_ids.items():
        values = bg_values[geo]
        feature["properties"].update({
            "households": values.get("households", 0),
            "hasMember65": values.get("hasMember65", 0),
            "alone65": values.get("alone65", 0),
            "noVehicle": values.get("noVehicleOwner", 0) + values.get("noVehicleRenter", 0),
            "tract": geo[9:20],
        })
    (CENSUS / "blockgroups.geojson").write_text(json.dumps(blockgroups, separators=(",", ":")))

    tracts = {}
    for geo, row in summary_rows("b18101", tract_ids).items():
        tracts[geo[9:]] = {"disabled65": sum(number(row[c]) for c in TRACT_DISABLED_65), "people65": sum(number(row[c]) for c in TRACT_ALL_65),
                           "hasMember65": 0}
    # Tract-wide households with a member 65+, over every block group in the tract, including those outside
    # the study area, so a tract's disability count can be split by the share of it that lies inside.
    with cached(SUMMARY.format(table="b11007")).open() as handle:
        for row in csv.DictReader(handle, delimiter="|"):
            geo = row["GEO_ID"]
            if geo.startswith("1500000US") and geo[9:20] in tracts:
                tracts[geo[9:20]]["hasMember65"] += number(row["B11007_E002"])
    (CENSUS / "tracts.json").write_text(json.dumps(tracts, indent=1))

    households = {}
    for row in pums_rows("h", pumas, ["SERIALNO", "PUMA", "WGTP", "NP", "VEH", "HHL", "TYPEHUGQ"]):
        if row["TYPEHUGQ"] == "1" and number(row["NP"]) > 0:  # housing units with people, not group quarters
            households[row["SERIALNO"]] = {"serial": row["SERIALNO"], "puma": row["PUMA"].zfill(5), "weight": number(row["WGTP"]),
                                           "people": number(row["NP"]), "vehicles": number(row["VEH"]),
                                           "spanish": row["HHL"] == "2", "persons": []}
    for row in pums_rows("p", pumas, ["SERIALNO", "PUMA", "SPORDER", "AGEP", "DIS", "DPHY", "DOUT", "DDRS", "DEAR"]):
        household = households.get(row["SERIALNO"])
        if household:
            household["persons"].append({"age": number(row["AGEP"]), "disability": row["DIS"] == "1", "ambulatory": row["DPHY"] == "1",
                                         "independentLiving": row["DOUT"] == "1", "selfCare": row["DDRS"] == "1", "hearing": row["DEAR"] == "1"})
    records = [h for h in households.values() if h["persons"] and h["weight"] > 0]
    (CENSUS / "pums_households.json").write_text(json.dumps(records, separators=(",", ":")))
    print(f"{len(bg_ids)} block groups, {len(tracts)} tracts, PUMAs {sorted(pumas)}, {len(records)} PUMS households")


if __name__ == "__main__":
    main()
