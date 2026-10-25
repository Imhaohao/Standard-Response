# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "scipy>=1.11", "rasterio>=1.3", "shapely>=2.0", "requests>=2.31", "pillow>=10"]
# ///
"""Build a water scenario for one city and write it as public/scenarios/<id>.json (scenario file v2).

    uv run modeling/scripts/cities/water_fetch_inputs.py --city fort-myers-beach   # once, needs the network
    uv run modeling/scripts/cities/build_water_scenario.py --city fort-myers-beach [--preview out.png]

Each city module (water_lower_ninth.py, water_fort_myers_beach.py, water_hilo.py) holds the city's box, its
source water and the water level at the source by minute, read from data/cities/<id>/timeline.json and the
series files beside it. Their provenance is data/cities/<id>/sources.md. This script applies the connected
bathtub in water_flood.py to USGS 3DEP ground, simplifies each front and writes the v2 file. The format is
lib/ink-map/scenario.ts.
"""

import argparse
import importlib
import json
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from water_flood import flooded_by, polygonize, rounded_geojson, tidy, vertex_count  # noqa: E402
from water_terrain import load_terrain  # noqa: E402

REPO = HERE.parents[2]
CITY_MODULES = {"lower-ninth": "water_lower_ninth", "fort-myers-beach": "water_fort_myers_beach", "hilo": "water_hilo"}
MAX_VERTICES_PER_FRONT = 400


def build_fronts(city, terrain) -> tuple[list[dict], list[np.ndarray]]:
    setup = city.flood_setup(terrain)
    reached = np.zeros(terrain.shape, dtype=bool)
    fronts, masks = [], []
    for step in city.front_steps(terrain):
        step_setup = replace(setup, source_water=setup.source_water | step["sources"]) if "sources" in step else setup
        reached = flooded_by(step_setup, step["level"], reached, step.get("gate"))
        shown = tidy(reached, city.MIN_PART_CELLS)
        geometry = polygonize(terrain, shown, MAX_VERTICES_PER_FRONT)
        if geometry is None:
            continue
        fronts.append({
            "minutesAfterWarning": step["minute"],
            "areaKm2": round(float(reached.sum() * terrain.cell_area_m2 / 1e6), 3),
            "note": step["note"],
            "vertices": vertex_count(geometry),
            "geometry": rounded_geojson(geometry),
        })
        masks.append(shown)
    return fronts, masks


def as_v2(city_id: str, city, fronts: list[dict], terrain) -> dict:
    parts = city.scenario_parts(fronts, terrain)
    return {
        "version": 2,
        "city": city_id,
        "kind": parts["kind"],
        "label": parts["label"],
        "basis": parts["basis"],
        "sources": city.SOURCES,
        "clock": parts["clock"],
        "fronts": {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"minutesAfterWarning": f["minutesAfterWarning"]}, "geometry": f["geometry"]}
                for f in fronts
            ],
        },
        "series": parts["series"],
    }


def write_preview(terrain, masks: list[np.ndarray], path: Path) -> None:
    from PIL import Image

    elevation = np.nan_to_num(terrain.elevation, nan=-5)
    shade = np.clip((elevation + 3) / 12, 0, 1) * 200 + 30
    rgb = np.stack([shade] * 3, axis=-1)
    for index, mask in enumerate(masks):
        warmth = index / max(len(masks) - 1, 1)
        edge = (mask & ~np.roll(mask, 1, axis=0)) | (mask & ~np.roll(mask, 1, axis=1))
        rgb[edge] = [40 + 210 * warmth, 80, 230 - 200 * warmth]
    Image.fromarray(rgb.astype(np.uint8)).save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--city", required=True, choices=sorted(CITY_MODULES))
    parser.add_argument("--preview", type=Path, help="write a PNG of the front outlines over the ground here")
    args = parser.parse_args()

    city = importlib.import_module(CITY_MODULES[args.city])
    terrain = load_terrain(city.BOX, city.CELL_METERS, REPO / "modeling" / "cache" / "cities" / args.city)
    fronts, masks = build_fronts(city, terrain)

    out = REPO / "public" / "scenarios" / f"{args.city}.json"
    out.write_text(json.dumps(as_v2(args.city, city, fronts, terrain), separators=(",", ":")) + "\n")
    print(f"{out.relative_to(REPO)}: {len(fronts)} fronts, at most {max(f['vertices'] for f in fronts)} vertices, {out.stat().st_size // 1024} KB")
    for front in fronts:
        print(f"  minute {front['minutesAfterWarning']:>5}  {front['areaKm2']:>7} km2  {front['note']}")
    if args.preview:
        write_preview(terrain, masks, args.preview)


if __name__ == "__main__":
    main()
