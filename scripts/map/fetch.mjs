// Downloads the raw inputs for the ink map into scripts/map/.cache. Run once: `node scripts/map/fetch.mjs`.
// The baked output in public/map is committed, so nobody else needs the network.
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { CACHE, DETAIL, TERRAIN, TERRAIN_ZOOM, tileRange } from "./frame.mjs";

const OVERPASS = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "rollcall-calhacks/0.1 (evacuation coordination map)";
const box = ({ south, west, north, east }) => `${south},${west},${north},${east}`;
const DETAIL_BOX = box(DETAIL);

// Buildings come from before the January 2025 Eaton Fire, so the scenario plays out over the town as it stood.
const BEFORE_EATON_FIRE = '[date:"2024-12-15T00:00:00Z"]';

const QUERIES = {
  buildings: `way["building"](${DETAIL_BOX});out geom tags;`,
  // Homes the fire destroyed that mappers only traced afterwards. Merged back in by bake.mjs.
  destroyed: `way["destroyed:building"](${DETAIL_BOX});out geom tags;`,
  roads: `way["highway"](${DETAIL_BOX});out geom tags;`,
  areas:
    `(way["leisure"~"park|golf_course|pitch|playground|nature_reserve|garden"](${DETAIL_BOX});` +
    `way["landuse"~"cemetery|grass|recreation_ground|forest|meadow|religious|reservoir|basin"](${DETAIL_BOX});` +
    `way["amenity"~"school|grave_yard|parking"](${DETAIL_BOX});` +
    `way["natural"~"wood|scrub|water|bare_rock|grassland"](${DETAIL_BOX});` +
    `relation["leisure"="golf_course"](${DETAIL_BOX});relation["landuse"="cemetery"](${DETAIL_BOX}););out geom tags;`,
  trees: `node["natural"="tree"](${DETAIL_BOX});out;`,
};

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
