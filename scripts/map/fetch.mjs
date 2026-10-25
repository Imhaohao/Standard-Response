// Downloads the raw inputs for the ink map into scripts/map/.cache. Run once: `node scripts/map/fetch.mjs`.
// The baked output in public/map is committed, so nobody else needs the network.
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { fetchDep } from "./dep.mjs";
import { fetchDins } from "./dins.mjs";
import { CACHE, CITY, EXTENT, TERRAIN, TERRAIN_CELL_METERS, TERRAIN_ZOOM, tileRange } from "./frame.mjs";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "rollcall-calhacks/0.1 (evacuation coordination map)";
const box = ({ south, west, north, east }) => `${south},${west},${north},${east}`;
const EXTENT_BOX = box(EXTENT);

// Buildings come from before the January 2025 Eaton Fire, so the scenario plays out over the town as it stood.
// Another city bakes from its own snapshot, or from today's map when lib/cities.ts gives none.
const snapshot = (date) => (date ? `[date:"${date}"]` : "");
const BEFORE_EATON_FIRE = CITY ? snapshot(CITY.osmSnapshot) : '[date:"2024-12-15T00:00:00Z"]';

const QUERIES = {
  buildings: `way["building"](${EXTENT_BOX});out geom tags;`,
  // Homes the fire destroyed that mappers only traced afterwards. Merged back in by bake.mjs.
  destroyed: `way["destroyed:building"](${EXTENT_BOX});out geom tags;`,
  roads: `way["highway"](${EXTENT_BOX});out geom tags;`,
  areas:
    `(way["leisure"~"park|golf_course|pitch|playground|nature_reserve|garden"](${EXTENT_BOX});` +
    `way["landuse"~"cemetery|grass|recreation_ground|forest|meadow|religious|reservoir|basin"](${EXTENT_BOX});` +
    `way["amenity"~"school|grave_yard|parking"](${EXTENT_BOX});` +
    `way["natural"~"wood|scrub|water|bare_rock|grassland"](${EXTENT_BOX});` +
    `relation["leisure"="golf_course"](${EXTENT_BOX});relation["landuse"="cemetery"](${EXTENT_BOX}););out geom tags;`,
  trees: `node["natural"="tree"](${EXTENT_BOX});out;`,
};

// Floods, surges and tsunamis need to know where the water is. The sea comes as coastline ways
// (land on their left) that bake.mjs closes into polygons; rivers, canals and lakes as areas.
if (CITY) {
  QUERIES.water =
    `(way["natural"="coastline"](${EXTENT_BOX});way["natural"="water"](${EXTENT_BOX});` +
    `relation["natural"="water"](${EXTENT_BOX});way["waterway"="riverbank"](${EXTENT_BOX});` +
    `relation["waterway"="riverbank"](${EXTENT_BOX});way["landuse"="basin"](${EXTENT_BOX}););out geom;`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function overpassText(name, query, attempt = 1) {
  const response = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: `[out:json][timeout:240]${name === "buildings" ? BEFORE_EATON_FIRE : ""};${query}` }),
  });
  if (response.ok) return response.text();
  if (attempt >= 4) throw new Error(`${name}: Overpass answered ${response.status}`);
  console.log(`${name}: Overpass answered ${response.status}, retrying`);
  await wait(15_000 * attempt);
  return overpassText(name, query, attempt + 1);
}

async function overpass(name, query) {
  const path = join(CACHE, `${name}.json`);
  if (await exists(path)) return console.log(`${name}: cached`);
  const text = await overpassText(name, query);
  await writeFile(path, text);
  console.log(`${name}: ${JSON.parse(text).elements.length} elements`);
}

async function terrainTiles() {
  const dir = join(CACHE, "terrain");
  await mkdir(dir, { recursive: true });
  const { xMin, xMax, yMin, yMax } = tileRange(TERRAIN, TERRAIN_ZOOM);
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const path = join(dir, `${TERRAIN_ZOOM}-${x}-${y}.png`);
      if (await exists(path)) continue;
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TERRAIN_ZOOM}/${x}/${y}.png`;
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!response.ok) throw new Error(`terrain tile ${x},${y}: ${response.status}`);
      await writeFile(path, Buffer.from(await response.arrayBuffer()));
    }
  }
  console.log(`terrain: ${(xMax - xMin + 1) * (yMax - yMin + 1)} tiles`);
}

await mkdir(CACHE, { recursive: true });
for (const [name, query] of Object.entries(QUERIES)) await overpass(name, query);
await terrainTiles();
if (CITY) await fetchDep(CACHE, TERRAIN, TERRAIN_CELL_METERS, USER_AGENT);
if (CITY?.structures) await fetchDins(CACHE, EXTENT, CITY.structures.incident, USER_AGENT);
