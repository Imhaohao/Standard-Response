"""Census base rate of need by location.

data/census/base_rates.json (written by scripts/build_population.py) holds, per block group, the share
of households that need help evacuating, computed from real ACS PUMS records reweighted to that block
group's ACS totals. Until it exists, every location gets REGIONAL_DEFAULT.
"""

import json
from functools import lru_cache

from shapely.geometry import Point, shape

from .paths import CENSUS

BASE_RATES_FILE = CENSUS / "base_rates.json"
# Used only before the population build runs: roughly the share of Altadena households with a member
# 65+ who has an ambulatory difficulty (ACS 2019-2023), rounded. Stated so nobody mistakes it for a fit.
REGIONAL_DEFAULT = 0.12


@lru_cache(maxsize=1)
def _block_groups():
    if not BASE_RATES_FILE.exists():
        return []
    data = json.loads(BASE_RATES_FILE.read_text())
    return [(shape(bg["geometry"]), bg["needRate"], bg["geoid"]) for bg in data["blockGroups"]]


def base_rate(lat: float, lng: float) -> float:
    point = Point(lng, lat)
    for geometry, rate, _geoid in _block_groups():
        if geometry.covers(point):
            return rate
    return REGIONAL_DEFAULT
