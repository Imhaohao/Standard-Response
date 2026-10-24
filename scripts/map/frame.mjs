// The extent of the ink map. Buildings and streets cover DETAIL; terrain reaches further north so the
// San Gabriel foothills close off the top of the frame.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(here, ".cache");
export const OUT = join(here, "..", "..", "public", "map");

// AREA's centre in convex/model.ts. Every baked coordinate is meters east and north of it.
export const ORIGIN = { lat: 34.189, lng: -118.154 };
export const DETAIL = { south: 34.17, north: 34.216, west: -118.178, east: -118.108 };
export const TERRAIN = { south: 34.16, north: 34.275, west: -118.21, east: -118.07 };
export const TERRAIN_ZOOM = 14;
export const TERRAIN_CELL_METERS = 15;

const METERS_PER_DEG_LAT = 110_574;
const METERS_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const toLocal = (lat, lng) => [(lng - ORIGIN.lng) * METERS_PER_DEG_LNG, (lat - ORIGIN.lat) * METERS_PER_DEG_LAT];
export const toLatLng = (x, y) => ({ lat: ORIGIN.lat + y / METERS_PER_DEG_LAT, lng: ORIGIN.lng + x / METERS_PER_DEG_LNG });

const lngToTileX = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const latToTileY = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};

export const tileCoords = (lat, lng, z) => ({ x: lngToTileX(lng, z), y: latToTileY(lat, z) });

export function tileRange(bounds, z) {
  return {
    xMin: Math.floor(lngToTileX(bounds.west, z)),
    xMax: Math.floor(lngToTileX(bounds.east, z)),
    yMin: Math.floor(latToTileY(bounds.north, z)),
    yMax: Math.floor(latToTileY(bounds.south, z)),
  };
}
