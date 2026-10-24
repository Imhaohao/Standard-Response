"""Repository paths. Everything is resolved from this file, so scripts run from any directory."""

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"
OSM = DATA / "osm"
HAZARD = DATA / "hazard"
CENSUS = DATA / "census"
