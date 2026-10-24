"""Write data/population.json (simulator ground truth) and data/census/base_rates.json (need-model prior).

  1. Block groups whose interior point lies in west Altadena (north of the Pasadena line, west of Lake Ave).
  2. IPF of real PUMS households to each block group's ACS controls and each tract's 65+ disability count.
  3. Draw whole households per block group in proportion to the fitted weights.
  4. Place each on a real residential building in its block group; households with a member 75+ and a
     disability are drawn three times as strongly toward buildings within 400 m of senior and care facilities.
  5. Map ACS flags to the evacuation record (rollcall_d.population states every assumed rate).

The population evaluates policies in simulation; it doesn't describe real people. Run fetch_census.py first.
"""

import json
import random
import sys
from pathlib import Path

import numpy as np
from shapely.geometry import Point, shape

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.geo import meters_between  # noqa: E402
from rollcall_d.paths import CENSUS, DATA, OSM  # noqa: E402
from rollcall_d.population import Record, evacuation_record, ipf, needs_help  # noqa: E402

SEED = 13
WEST_ALTADENA = {"south": 34.176, "north": 34.212, "west": -118.180, "east": -118.130}
FACILITY_RADIUS_METERS = 400
FACILITY_PULL = 3.0
APARTMENT_UNITS_PER_LEVEL = 4


def in_area(geometry) -> bool:
    p = geometry.representative_point()
    box = WEST_ALTADENA
    return box["south"] < p.y < box["north"] and box["west"] < p.x < box["east"]


def building_capacity(building: dict) -> float:
    return APARTMENT_UNITS_PER_LEVEL * max(building["levels"], 1) if building["kind"] == "apartments" else 1.0


def main() -> None:
    rng = random.Random(SEED)
    features = json.loads((CENSUS / "blockgroups.geojson").read_text())["features"]
    selected = [(f["properties"], shape(f["geometry"])) for f in features if f["properties"]["households"] > 0 and in_area(shape(f["geometry"]))]
    blockgroups = [props for props, _ in selected]
    tracts = json.loads((CENSUS / "tracts.json").read_text())
    records = [Record(r["serial"], r["weight"], r["people"], r["vehicles"], r["spanish"], r["persons"])
               for r in json.loads((CENSUS / "pums_households.json").read_text())]
    weights, fit = ipf(records, blockgroups, tracts)
    evac = [evacuation_record(r, random.Random(f"{SEED}-{r.serial}")) for r in records]
    need = np.array([needs_help(e) for e in evac], dtype=float)

    buildings = json.loads((OSM / "buildings.json").read_text())
    facilities = [f for f in json.loads((OSM / "facilities.json").read_text()) if f["kind"] in ("nursing_home", "assisted_living", "group_home")]
    near_facility = [any(meters_between((b["lat"], b["lng"]), (f["lat"], f["lng"])) < FACILITY_RADIUS_METERS for f in facilities) for b in buildings]

    population, base_rates = [], []
    for g, (props, geometry) in enumerate(selected):
        inside = [i for i, b in enumerate(buildings) if geometry.contains(Point(b["lng"], b["lat"]))]
        count = props["households"]
        base_rates.append({"geoid": props["GEOID"], "households": count, "needRate": round(float(weights[g] @ need / max(weights[g].sum(), 1e-9)), 4),
                           "geometry": json.loads(json.dumps(features[[f["properties"]["GEOID"] for f in features].index(props["GEOID"])]["geometry"]))})
        if weights[g].sum() <= 0:
            continue
        drawn = rng.choices(range(len(records)), weights=weights[g].tolist(), k=count)
        for h in drawn:
            vulnerable = any(p["age"] >= 75 and p["disability"] for p in records[h].persons)
            lat, lng = place(rng, buildings, inside, near_facility, vulnerable, geometry)
            population.append({"id": f"H-{len(population) + 1:05d}", "lat": lat, "lng": lng, **{k: v for k, v in evac[h].items() if k != "hearingDifficulty"},
                               "hearingDifficulty": evac[h]["hearingDifficulty"], "blockGroup": props["GEOID"], "pumsSerial": records[h].serial})

    (DATA / "population.json").write_text(json.dumps(population, separators=(",", ":")))
    (CENSUS / "base_rates.json").write_text(json.dumps({"label": "Share of households that need help evacuating, by block group: real PUMS records reweighted to ACS 2019-2023 controls, mapped by stated assumptions.", "blockGroups": base_rates}, separators=(",", ":")))
    needing = sum(needs_help(p) for p in population)
    meta = {
        "label": "Synthetic population for simulation. Real ACS PUMS household records reweighted to real block-group and tract totals; not real people.",
        "source": "ACS 2019-2023 5-year: PUMS (PUMAs 03709, 03718), B11001, B11007, B25044 by block group, B18101 by tract. OSM buildings and care facilities.",
        "blockGroups": len(selected), "households": len(population), "needHelp": needing,
        "ipfWorstRelativeError": fit, "seed": SEED,
        "assumptions": "ACS has no wheelchair, bed or oxygen variables; see rollcall_d/population.py for the mapping and its rates.",
    }
    (DATA / "population-meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps(meta, indent=1))


def place(rng, buildings, inside, near_facility, vulnerable, geometry) -> tuple[float, float]:
    if not inside:
        minx, miny, maxx, maxy = geometry.bounds
        while True:
            p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
            if geometry.contains(p):
                return round(p.y, 6), round(p.x, 6)
    pull = [building_capacity(buildings[i]) * (FACILITY_PULL if vulnerable and near_facility[i] else 1.0) for i in inside]
    b = buildings[rng.choices(inside, weights=pull, k=1)[0]]
    jitter = 0.00004 if b["kind"] == "apartments" else 0.0
    return round(b["lat"] + rng.uniform(-jitter, jitter), 6), round(b["lng"] + rng.uniform(-jitter, jitter), 6)


if __name__ == "__main__":
    main()
