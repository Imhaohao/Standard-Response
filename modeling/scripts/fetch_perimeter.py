"""Download CAL FIRE's final heat perimeter for the Eaton Fire and save it as data/eaton/perimeter-eaton.geojson.

LA County Public Works republishes CAL FIRE's perimeter (agency CDF, 14,056 GIS acres, as of January 21,
2025, ten days before full containment). It is the input to scripts/build_eaton_fire.py.
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.paths import DATA  # noqa: E402

LAYER = (
    "https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/"
    "Palisades_and_Eaton_Dissolved_Fire_Perimeters_as_of_20250121/FeatureServer/0"
)


def main():
    params = {"where": "FIRE_NAME='EATON'", "outFields": "FIRE_NAME,AGENCY,GIS_ACRES,type", "outSR": "4326", "f": "geojson"}
    with urllib.request.urlopen(f"{LAYER}/query?{urllib.parse.urlencode(params)}", timeout=120) as response:
        collection = json.loads(response.read())
    (feature,) = collection["features"]
    target = DATA / "eaton" / "perimeter-eaton.geojson"
    target.write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {"source": LAYER, "terms": "CAL FIRE perimeter via LA County Public Works, published without warranty"},
        "features": [feature],
    }, separators=(",", ":")) + "\n")
    print(f"wrote {feature['properties']['GIS_ACRES']} acres to {target}")


if __name__ == "__main__":
    main()
