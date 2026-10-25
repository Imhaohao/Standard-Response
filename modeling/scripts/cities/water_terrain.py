"""Bare-earth elevation for a city box, from the USGS 3DEP 1/3 arc-second (about 10 m) seamless DEM.

3DEP publishes the DEM as one cloud-optimized GeoTIFF per 1-degree cell on Amazon S3, so we read only the
window over the box with HTTP range requests and resample it to our grid. Heights are meters. In the
conterminous US the vertical datum is NAVD88; in Hawaii, which NAVD88 doesn't cover, heights are relative
to local mean sea level. The crop is cached under modeling/cache/cities/<city>/ so a rebuild stays offline.
"""

import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.transform import from_bounds

TILE_URL = "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/{name}/USGS_13_{name}.tif"
METERS_PER_DEG_LAT = 110_574.0
NO_DATA = -9999.0


@dataclass(frozen=True)
class Box:
    south: float
    west: float
    north: float
    east: float

    @property
    def meters_per_deg_lng(self) -> float:
        return 111_320.0 * math.cos(math.radians((self.south + self.north) / 2))

    def grid_size(self, cell_meters: float) -> tuple[int, int]:
        width = round((self.east - self.west) * self.meters_per_deg_lng / cell_meters)
        height = round((self.north - self.south) * METERS_PER_DEG_LAT / cell_meters)
        return width, height


@dataclass(frozen=True)
class Terrain:
    elevation: np.ndarray  # meters, row 0 is the north edge
    box: Box

    @property
    def shape(self) -> tuple[int, int]:
        return self.elevation.shape

    def cell_of(self, lat: float, lng: float) -> tuple[int, int]:
        height, width = self.shape
        col = int((lng - self.box.west) / (self.box.east - self.box.west) * width)
        row = int((self.box.north - lat) / (self.box.north - self.box.south) * height)
        return min(max(row, 0), height - 1), min(max(col, 0), width - 1)

    @property
    def cell_area_m2(self) -> float:
        height, width = self.shape
        dx = (self.box.east - self.box.west) * self.box.meters_per_deg_lng / width
        dy = (self.box.north - self.box.south) * METERS_PER_DEG_LAT / height
        return dx * dy


def tile_names(box: Box) -> list[str]:
    """3DEP names each 1-degree tile by its north-west corner, e.g. n30w091 spans 29-30 N, 90-91 W."""
    names = []
    for north in range(math.floor(box.south) + 1, math.floor(box.north) + 2):
        for west in range(math.floor(box.west), math.floor(box.east) + 1):
            names.append(f"n{north:02d}w{-west:03d}")
    return names


def _download(box: Box, cell_meters: float, path: Path) -> None:
    width, height = box.grid_size(cell_meters)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        sources = [rasterio.open(f"/vsicurl/{TILE_URL.format(name=name)}") for name in tile_names(box)]
        mosaic, _ = merge(
            sources,
            bounds=(box.west, box.south, box.east, box.north),
            res=((box.east - box.west) / width, (box.north - box.south) / height),
            nodata=NO_DATA,
            resampling=Resampling.bilinear,
        )
        for source in sources:
            source.close()
    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "count": 1,
        "width": width,
        "height": height,
        "crs": "EPSG:4326",
        "transform": from_bounds(box.west, box.south, box.east, box.north, width, height),
        "nodata": NO_DATA,
        "compress": "deflate",
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, "w", **profile) as out:
        out.write(mosaic[0, :height, :width].astype("float32"), 1)


def load_terrain(box: Box, cell_meters: float, cache_dir: Path) -> Terrain:
    path = cache_dir / f"3dep13-{box.south}-{box.west}-{box.north}-{box.east}-{cell_meters}m.tif"
    if not path.exists():
        _download(box, cell_meters, path)
    with rasterio.open(path) as source:
        elevation = source.read(1).astype(np.float32)
    elevation[elevation <= NO_DATA + 1] = np.nan
    return Terrain(elevation=elevation, box=box)
