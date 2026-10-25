// The extent of the ink map. DETAIL is the town the map is about: the camera frames it and can't pan
// past it. Buildings, streets and trees cover EXTENT, a margin a few kilometres wider, so a tilted
// view near DETAIL's edge still looks out over the neighbouring towns instead of a cut-off edge.
// Terrain reaches further again, north to the San Gabriel ridges and south past Pasadena.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const CACHE = join(here, ".cache");
export const OUT = join(here, "..", "..", "public", "map");

// AREA's centre in convex/model.ts. Every baked coordinate is meters east and north of it.
export const ORIGIN = { lat: 34.189, lng: -118.154 };
export const DETAIL = { south: 34.17, north: 34.216, west: -118.178, east: -118.108 };
export const EXTENT = { south: 34.148, north: 34.232, west: -118.205, east: -118.08 };
export const TERRAIN = { south: 34.125, north: 34.275, west: -118.225, east: -118.065 };
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
