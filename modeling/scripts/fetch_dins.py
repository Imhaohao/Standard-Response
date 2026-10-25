"""Download CAL FIRE's damage inspection (DINS) points for the Eaton Fire and save a compact copy.

Every structure CAL FIRE's inspectors visited, with its damage class. The public view has no inspection
times, so it says which homes the fire reached, not when. Saves data/eaton/dins-eaton.json, an input to
scripts/eaton_fire_field.py.
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.paths import DATA  # noqa: E402

LAYER = "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/DINS_2025_Eaton_Public_View/FeatureServer/0"
PAGE = 2000
DAMAGE_CODES = {
    "No Damage": 0,
    "Affected (1-9%)": 1,
    "Minor (10-25%)": 2,
    "Major (26-50%)": 3,
    "Destroyed (>50%)": 4,
    "Inaccessible": -1,
}


def page(offset: int) -> list[dict]:
    params = {
        "where": "1=1", "outFields": "DAMAGE", "returnGeometry": "true", "outSR": "4326",
        "resultOffset": offset, "resultRecordCount": PAGE, "orderByFields": "OBJECTID", "f": "geojson",
    }
    with urllib.request.urlopen(f"{LAYER}/query?{urllib.parse.urlencode(params)}", timeout=120) as response:
        return json.loads(response.read())["features"]


def all_points() -> list[list]:
    points, offset = [], 0
    while True:
        features = page(offset)
        for feature in features:
            lng, lat = feature["geometry"]["coordinates"][:2]
            points.append([round(lat, 6), round(lng, 6), DAMAGE_CODES[feature["properties"]["DAMAGE"]]])
        if len(features) < PAGE:
            return points
        offset += PAGE


def main():
    points = all_points()
    target = DATA / "eaton" / "dins-eaton.json"
    target.write_text(json.dumps({
        "source": LAYER,
        "terms": "CAL FIRE public view, published without warranty",
        "damageCodes": DAMAGE_CODES,
        "fields": ["lat", "lng", "damage"],
        "points": points,
    }, separators=(",", ":")) + "\n")
    print(f"wrote {len(points)} structures to {target}")


if __name__ == "__main__":
    main()
