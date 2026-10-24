"""Write data/hazard/scenario-earthquake.geojson: check-deadline bands around the Sierra Madre fault.

Scenario input, not a forecast and not a ShakeMap. The fault traces come from the USGS Quaternary
Fault and Fold Database (Sierra Madre fault zone, sections B and C), which runs along the north edge
of Altadena at the foot of the San Gabriels. Minute zero is the main shock.

An earthquake gives no warning, so each band means something different from a fire front: homes
inside it should be reached by that many minutes after the shock. Distance to the rupture stands in
for shaking, and so for the chance that someone is trapped or the home is unsafe, so the bands nearest
the fault get the earliest deadlines. Band distances are a stated assumption. The output keeps the
fire scenario's shape (nested polygons with minutesAfterWarning), so every reader works unchanged.
"""

import json
import sys
from pathlib import Path

import requests
from shapely.geometry import LineString
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.geo import metric_to_geojson, to_xy  # noqa: E402
from rollcall_d.hazard import LABEL  # noqa: E402
from rollcall_d.paths import HAZARD  # noqa: E402

OUTPUT = HAZARD / "scenario-earthquake.geojson"
QFAULTS = "https://earthquake.usgs.gov/arcgis/rest/services/haz/Qfaults/MapServer/21/query"
BBOX = (-118.20, 34.17, -118.08, 34.24)  # west, south, east, north around Altadena
FAULT = "Sierra Madre fault zone"
# (minutes after the shock, meters from the fault trace)
BANDS = [(0, 250), (30, 750), (60, 1500), (90, 2500), (120, 3500), (150, 5000)]


def fault_traces() -> list[LineString]:
    params = {
        "where": f"fault_name = '{FAULT}'",
        "geometry": ",".join(str(value) for value in BBOX),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "fault_name,section_name",
        "outSR": 4326,
        "f": "geojson",
    }
    response = requests.get(QFAULTS, params=params, timeout=60)
    response.raise_for_status()
    traces = [
        LineString([to_xy(lat, lng) for lng, lat in feature["geometry"]["coordinates"]])
        for feature in response.json()["features"]
        if feature["geometry"]["type"] == "LineString"
    ]
    if not traces:
        raise SystemExit(f"USGS returned no {FAULT} traces in {BBOX}")
    return traces


def main() -> None:
    rupture = unary_union(fault_traces())
    features = [
        {
            "type": "Feature",
            "properties": {"minutesAfterWarning": minutes, "metersFromFault": meters, "label": LABEL},
            "geometry": metric_to_geojson(rupture.buffer(meters, quad_segs=16).simplify(10)),
        }
        for minutes, meters in BANDS
    ]
    collection = {
        "type": "FeatureCollection",
        "metadata": {
            "name": "Sierra Madre fault earthquake scenario",
            "hazard": "earthquake",
            "label": LABEL,
            "generator": "scripts/build_earthquake.py (distance bands from the USGS fault trace)",
            "basis": "Fault traces from the USGS Quaternary Fault and Fold Database, Sierra Madre fault zone. Bands are check deadlines by distance to the fault, a stated assumption, not a ShakeMap.",
            "source": QFAULTS,
            "neverMarksSafe": "Homes outside every band get an extrapolated deadline, never 'safe'.",
        },
        "features": features,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(collection, indent=1))
    print(f"wrote {OUTPUT} with {len(features)} bands")


if __name__ == "__main__":
    main()
