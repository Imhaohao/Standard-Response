// USGS 3DEP elevation as 32-bit floats in metres (NAVD88), for the other cities' terrain.
// The Terrain Tiles Altadena uses flatten everything below sea level to exactly 0 m: a quarter of
// the Lower Ninth Ward reads 0.00 there, where 3DEP has -1.5 to -2.4 m. A flood is level minus
// ground, so the cities a flood, surge or tsunami crosses read 3DEP first and fall back to the tiles
// only where 3DEP has no data (open sea).
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage";
const MOST_PIXELS = 8000;
const TILE = 500;
const NO_DATA = -9999;

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

// One sample per terrain cell. Asked for finer than about 10 m, the service switches to a source with
// holes (a quarter of the Lower Ninth came back as 1e-38) and a different datum.
function requestSize(bounds, cellMeters) {
  const metersPerDegLng = 111_320 * Math.cos((((bounds.south + bounds.north) / 2) * Math.PI) / 180);
  const width = Math.ceil(((bounds.east - bounds.west) * metersPerDegLng) / cellMeters);
  const height = Math.ceil(((bounds.north - bounds.south) * 110_574) / cellMeters);
  return { width: Math.min(width, MOST_PIXELS), height: Math.min(height, MOST_PIXELS) };
}

async function fetchTile(bounds, width, height, userAgent) {
  const query = new URLSearchParams({
    bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`,
    bboxSR: "4326",
    imageSR: "4326",
    size: `${width},${height}`,
    format: "bsq",
    pixelType: "F32",
    noData: String(NO_DATA),
    interpolation: "RSP_BilinearInterpolation",
    f: "image",
  });
  const response = await fetch(`${SERVICE}?${query}`, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`3dep: ${response.status}`);
  // The band comes first; a one-bit validity mask follows it.
  const bytes = Buffer.from(await response.arrayBuffer());
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + width * height * 4));
}

// Large requests come back with holes too, so the grid comes down in tiles of at most TILE pixels
// a side and is stitched here.
export async function fetchDep(cache, bounds, cellMeters, userAgent) {
  const path = join(cache, "dep.bin");
  if (await exists(path)) return console.log("3dep: cached");
  const { width, height } = requestSize(bounds, cellMeters);
  const grid = new Float32Array(width * height);
  const degX = (bounds.east - bounds.west) / width;
  const degY = (bounds.north - bounds.south) / height;
  for (let row0 = 0; row0 < height; row0 += TILE) {
    for (let col0 = 0; col0 < width; col0 += TILE) {
      const [w, h] = [Math.min(TILE, width - col0), Math.min(TILE, height - row0)];
      const tileBounds = { west: bounds.west + col0 * degX, east: bounds.west + (col0 + w) * degX, north: bounds.north - row0 * degY, south: bounds.north - (row0 + h) * degY };
      const tile = await fetchTile(tileBounds, w, h, userAgent);
      for (let r = 0; r < h; r++) grid.set(tile.subarray(r * w, (r + 1) * w), (row0 + r) * width + col0);
    }
  }
  await writeFile(path, Buffer.from(grid.buffer));
  await writeFile(join(cache, "dep.json"), JSON.stringify({ width, height, bounds }));
  console.log(`3dep: ${width}x${height}`);
}

// A sampler (lat, lng) => metres, or null where 3DEP has nothing; null when no grid was fetched.
export async function loadDep(cache) {
  if (!(await exists(join(cache, "dep.bin")))) return null;
  const { width, height, bounds } = JSON.parse(await readFile(join(cache, "dep.json"), "utf8"));
  const raw = await readFile(join(cache, "dep.bin"));
  const grid = new Float32Array(raw.buffer, raw.byteOffset, width * height);
  const valid = (value) => Number.isFinite(value) && value > NO_DATA + 1 && Math.abs(value) > 1e-30;
  const at = (col, row) => grid[Math.min(height - 1, Math.max(0, row)) * width + Math.min(width - 1, Math.max(0, col))];
  return (lat, lng) => {
    const fx = ((lng - bounds.west) / (bounds.east - bounds.west)) * width - 0.5;
    const fy = ((bounds.north - lat) / (bounds.north - bounds.south)) * height - 0.5;
    const [c, r] = [Math.floor(fx), Math.floor(fy)];
    const [tx, ty] = [fx - c, fy - r];
    const corners = [at(c, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1)];
    if (!corners.every(valid)) return null;
    return (corners[0] * (1 - tx) + corners[1] * tx) * (1 - ty) + (corners[2] * (1 - tx) + corners[3] * tx) * ty;
  };
}
