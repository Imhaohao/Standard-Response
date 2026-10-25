// Turns the cached OSM and terrain inputs into the files the ink map loads:
//   public/map/altadena.json  buildings, streets, areas, trees and the road graph, in decimeters from ORIGIN
//   public/map/terrain.bin    a Uint16 elevation grid in decimeters
// Run after fetch.mjs: `node scripts/map/bake.mjs`.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { CACHE, DETAIL, ORIGIN, OUT, TERRAIN, TERRAIN_CELL_METERS, TERRAIN_ZOOM, tileCoords, toLatLng, toLocal } from "./frame.mjs";
import {
  SpatialGrid,
  centroid,
  cleanRing,
  counterClockwise,
  distanceToSegment,
  mulberry32,
  orientedBox,
  pointInRing,
  ringArea,
} from "./geometry.mjs";

const dm = (meters) => Math.round(meters * 10);
const readJson = async (name) => JSON.parse(await readFile(join(CACHE, `${name}.json`), "utf8")).elements;
const localRing = (geometry) => geometry.map(({ lat, lon }) => toLocal(lat, lon));

// ---- Terrain ----

async function loadTiles() {
  const dir = join(CACHE, "terrain");
  const tiles = new Map();
  for (const file of await readdir(dir)) {
    const [, x, y] = file.replace(".png", "").split("-").map(Number);
    tiles.set(`${x},${y}`, PNG.sync.read(await readFile(join(dir, file))));
  }
  return tiles;
}

function elevationAtPixel(tiles, px, py) {
  const tx = Math.floor(px / 256);
  const ty = Math.floor(py / 256);
  const png = tiles.get(`${tx},${ty}`);
  const i = ((Math.floor(py) - ty * 256) * 256 + (Math.floor(px) - tx * 256)) * 4;
  return png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
}

function elevationAt(tiles, lat, lng) {
  const { x, y } = tileCoords(lat, lng, TERRAIN_ZOOM);
  const px = x * 256 - 0.5;
  const py = y * 256 - 0.5;
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const fx = px - x0;
  const fy = py - y0;
  const top = elevationAtPixel(tiles, x0, y0) * (1 - fx) + elevationAtPixel(tiles, x0 + 1, y0) * fx;
  const bottom = elevationAtPixel(tiles, x0, y0 + 1) * (1 - fx) + elevationAtPixel(tiles, x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

async function bakeTerrain() {
  const tiles = await loadTiles();
  const [x0, y0] = toLocal(TERRAIN.south, TERRAIN.west);
  const [x1, y1] = toLocal(TERRAIN.north, TERRAIN.east);
  const cols = Math.floor((x1 - x0) / TERRAIN_CELL_METERS) + 1;
  const rows = Math.floor((y1 - y0) / TERRAIN_CELL_METERS) + 1;
  const grid = new Uint16Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { lat, lng } = toLatLng(x0 + c * TERRAIN_CELL_METERS, y0 + r * TERRAIN_CELL_METERS);
      grid[r * cols + c] = dm(elevationAt(tiles, lat, lng));
    }
  }
  await writeFile(join(OUT, "terrain.bin"), Buffer.from(grid.buffer));
  return { cols, rows, cell: TERRAIN_CELL_METERS, x0: Math.round(x0), y0: Math.round(y0) };
}

// ---- Buildings ----

const KIND = { house: 0, apartments: 1, outbuilding: 2, commercial: 3, civic: 4 };
const KIND_BY_TAG = {
  house: KIND.house, detached: KIND.house, residential: KIND.house, yes: KIND.house, bungalow: KIND.house, semidetached_house: KIND.house,
  apartments: KIND.apartments, dormitory: KIND.apartments, terrace: KIND.apartments,
  garage: KIND.outbuilding, garages: KIND.outbuilding, shed: KIND.outbuilding, roof: KIND.outbuilding, carport: KIND.outbuilding, greenhouse: KIND.outbuilding,
  retail: KIND.commercial, commercial: KIND.commercial, industrial: KIND.commercial, office: KIND.commercial, warehouse: KIND.commercial,
  school: KIND.civic, hospital: KIND.civic, college: KIND.civic, church: KIND.civic, public: KIND.civic, civic: KIND.civic,
};
const DEFAULT_HEIGHT = [4.2, 8, 2.8, 6, 8];
const ROOF = { flat: 0, gable: 1, hip: 2 };

function wallHeight(tags, kind) {
  const height = parseFloat(tags.height);
  if (Number.isFinite(height) && height > 1.5) return Math.min(height, 60);
  const levels = parseInt(tags["building:levels"], 10);
  if (Number.isFinite(levels) && levels > 0) return levels * 3.1 + 0.6;
  return DEFAULT_HEIGHT[kind];
}

function roofFor(ring, kind, random) {
  const area = Math.abs(ringArea(ring));
  const box = orientedBox(ring);
  const pitchable = (kind === KIND.house || kind === KIND.outbuilding) && area < 520 && area > 12;
  if (!pitchable || area / box.area < 0.86) return { roof: ROOF.flat, ring };
  const corners = [
    [-box.halfU, -box.halfV],
    [box.halfU, -box.halfV],
    [box.halfU, box.halfV],
    [-box.halfU, box.halfV],
  ].map(([u, v]) => [box.cx + u * Math.cos(box.angle) - v * Math.sin(box.angle), box.cy + u * Math.sin(box.angle) + v * Math.cos(box.angle)]);
  return { roof: random() < 0.55 ? ROOF.hip : ROOF.gable, ring: corners };
}

// OSM heights are to the roof top. A pitched roof takes its rise out of the wall height.
function splitHeight(total, roof, ring) {
  if (roof === ROOF.flat) return { walls: total, rise: 0 };
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const shortSide = Math.min(Math.hypot(xs[1] - xs[0], ys[1] - ys[0]), Math.hypot(xs[2] - xs[1], ys[2] - ys[1]));
  const rise = Math.min(Math.max(shortSide * 0.24, 1.2), 3.2);
  return { walls: Math.max(total - rise * 0.6, 2.4), rise };
}

function bakeBuilding(element, random) {
  const tags = { building: element.tags?.["destroyed:building"], ...element.tags };
  const raw = cleanRing(localRing(element.geometry ?? []));
  if (raw.length < 3 || Math.abs(ringArea(raw)) < 6) return null;
  const kind = KIND_BY_TAG[tags.building] ?? KIND.house;
  const { roof, ring } = roofFor(counterClockwise(raw), kind, random);
  const { walls, rise } = splitHeight(wallHeight(tags, kind), roof, ring);
  return { kind, roof, walls, rise, ring };
}

// ---- Streets and areas ----

const ROAD_CLASS = {
  motorway: 0, motorway_link: 0, trunk: 0,
  primary: 1, primary_link: 1, secondary: 2, secondary_link: 2, tertiary: 3, tertiary_link: 3,
  residential: 4, unclassified: 4, living_street: 4,
  service: 5, track: 6, footway: 7, path: 7, steps: 7, cycleway: 7, pedestrian: 7, bridleway: 7,
};
export const ROAD_WIDTH = [20, 15, 13, 11, 8, 4.5, 3, 1.6];

const AREA_KIND = { park: 0, grass: 1, water: 2, school: 3, parking: 4, cemetery: 5, golf: 6, pitch: 7, wild: 8 };
const AREA_BY_TAG = {
  park: AREA_KIND.park, garden: AREA_KIND.park, nature_reserve: AREA_KIND.wild, playground: AREA_KIND.park, recreation_ground: AREA_KIND.park,
  grass: AREA_KIND.grass, meadow: AREA_KIND.grass, grassland: AREA_KIND.grass, disc_golf_course: AREA_KIND.park,
  water: AREA_KIND.water, reservoir: AREA_KIND.water, basin: AREA_KIND.water,
  school: AREA_KIND.school, religious: AREA_KIND.school,
  parking: AREA_KIND.parking, cemetery: AREA_KIND.cemetery, grave_yard: AREA_KIND.cemetery,
  golf_course: AREA_KIND.golf, pitch: AREA_KIND.pitch,
  wood: AREA_KIND.wild, forest: AREA_KIND.wild, scrub: AREA_KIND.wild, bare_rock: AREA_KIND.wild,
};

const areaTag = (tags) => tags.leisure ?? tags.landuse ?? tags.amenity ?? tags.natural ?? tags.water;

// Joins a relation's outer members end to end into closed rings.
function relationRings(element) {
  const pieces = (element.members ?? []).filter((m) => m.role === "outer" && m.geometry).map((m) => localRing(m.geometry));
  const rings = [];
  while (pieces.length) {
    let ring = pieces.shift();
    for (let joined = true; joined; ) {
      joined = false;
      const end = ring[ring.length - 1];
      const next = pieces.findIndex((p) => Math.hypot(p[0][0] - end[0], p[0][1] - end[1]) < 1 || Math.hypot(p.at(-1)[0] - end[0], p.at(-1)[1] - end[1]) < 1);
      if (next >= 0) {
        const piece = pieces.splice(next, 1)[0];
        const forward = Math.hypot(piece[0][0] - end[0], piece[0][1] - end[1]) < 1;
        ring = ring.concat(forward ? piece : [...piece].reverse());
        joined = true;
      }
    }
    rings.push(ring);
  }
  return rings;
}

function bakeAreas(elements) {
  const areas = [];
  for (const element of elements) {
    const kind = AREA_BY_TAG[areaTag(element.tags ?? {})];
    if (kind === undefined) continue;
    const rings = element.type === "relation" ? relationRings(element) : [localRing(element.geometry ?? [])];
    for (const ring of rings.map((r) => cleanRing(r, 1))) {
      if (ring.length >= 3) areas.push({ kind, ring, name: element.tags.name });
    }
  }
  return areas.sort((a, b) => Math.abs(ringArea(b.ring)) - Math.abs(ringArea(a.ring)));
}

function bakeRoads(elements) {
  const names = [];
  const nameIndex = new Map();
  const roads = [];
  for (const element of elements) {
    const roadClass = ROAD_CLASS[element.tags?.highway];
    if (roadClass === undefined || !element.geometry) continue;
    const name = element.tags.name ?? "";
    if (!nameIndex.has(name)) {
      nameIndex.set(name, names.length);
      names.push(name);
    }
    const tunnel = element.tags.tunnel === "yes" || element.tags.covered === "yes";
    roads.push({ roadClass, name: nameIndex.get(name), path: localRing(element.geometry), tunnel });
  }
  return { roads, names };
}

// ---- Trees ----

function buildingIndex(buildings) {
  const grid = new SpatialGrid(25);
  for (const b of buildings) {
    const xs = b.ring.map((p) => p[0]);
    const ys = b.ring.map((p) => p[1]);
    grid.insert(b, Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3);
  }
  return grid;
}

function roadIndex(roads) {
  const grid = new SpatialGrid(25);
  for (const road of roads) {
    const pad = ROAD_WIDTH[road.roadClass] / 2 + 2;
    for (let i = 1; i < road.path.length; i++) {
      const [ax, ay] = road.path[i - 1];
      const [bx, by] = road.path[i];
      grid.insert({ ax, ay, bx, by, pad }, Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad);
    }
  }
  return grid;
}

const OFFSETS = [[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]];
const onBuilding = (grid, x, y) => grid.near(x, y).some((b) => OFFSETS.some(([dx, dy]) => pointInRing(x + dx, y + dy, b.ring)));
const onRoad = (grid, x, y) => grid.near(x, y).some((s) => distanceToSegment(x, y, s.ax, s.ay, s.bx, s.by) < s.pad);
const nearHome = (grid, x, y) => grid.near(x, y).length > 0;

// Low-frequency value noise so trees clump into canopies and leave open yards.
function clumpNoise(x, y) {
  const s = Math.sin(x * 0.021 + Math.sin(y * 0.013) * 2.1) + Math.sin(y * 0.019 + Math.sin(x * 0.017) * 1.7);
  return s * 0.25 + 0.5;
}

function plantTrees(buildings, roads, osmTrees, areas) {
  const random = mulberry32(2025);
  const homes = buildingIndex(buildings);
  const streets = roadIndex(roads);
  const water = areas.filter((a) => a.kind === AREA_KIND.water || a.kind === AREA_KIND.parking || a.kind === AREA_KIND.pitch);
  const [x0, y0] = toLocal(DETAIL.south, DETAIL.west);
  const [x1, y1] = toLocal(DETAIL.north, DETAIL.east);
  const trees = osmTrees.map((t) => toLocal(t.lat, t.lon));
  const step = 7.5;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const px = x + (random() - 0.5) * step;
      const py = y + (random() - 0.5) * step;
      if (random() > clumpNoise(px, py) * 0.95) continue;
      if (!nearHome(homes, px, py) || onBuilding(homes, px, py) || onRoad(streets, px, py)) continue;
      if (water.some((a) => pointInRing(px, py, a.ring))) continue;
      trees.push([px, py]);
    }
  }
  return trees;
}

// ---- Road graph (data/osm/drive.graphml, so closures and edge keys match the dispatcher) ----

function graphmlKeys(xml) {
  const keys = {};
  for (const [, id, name] of xml.matchAll(/<key id="(d\d+)" for="(?:node|edge)" attr\.name="([^"]+)"/g)) keys[id] = name;
  return keys;
}

function dataFields(body, keys) {
  const fields = {};
  for (const [, key, value] of body.matchAll(/<data key="(d\d+)">([^<]*)<\/data>/g)) fields[keys[key]] = value;
  return fields;
}

async function bakeGraph() {
  const xml = await readFile(join(CACHE, "..", "..", "..", "data", "osm", "drive.graphml"), "utf8");
  const keys = graphmlKeys(xml);
  const nodes = new Map();
  for (const [, id, body] of xml.matchAll(/<node id="(\d+)">([\s\S]*?)<\/node>/g)) {
    const f = dataFields(body, keys);
    nodes.set(id, toLocal(parseFloat(f.y), parseFloat(f.x)));
  }
  const ids = [...nodes.keys()];
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const edges = [];
  for (const [, source, target, key, body] of xml.matchAll(/<edge source="(\d+)" target="(\d+)" id="(\d+)">([\s\S]*?)<\/edge>/g)) {
    const f = dataFields(body, keys);
    const shape = f.geometry
      ? [...f.geometry.matchAll(/(-?\d+\.\d+) (-?\d+\.\d+)/g)].map(([, lng, lat]) => toLocal(parseFloat(lat), parseFloat(lng)))
      : [nodes.get(source), nodes.get(target)];
    edges.push({ u: indexOf.get(source), v: indexOf.get(target), key: `${source}-${target}-${key}`, seconds: parseFloat(f.travel_time), shape });
  }
  return { ids, nodes: ids.map((id) => nodes.get(id)), edges };
}

// ---- Output ----

const flat = (points) => points.flatMap(([x, y]) => [dm(x), dm(y)]);

async function main() {
  await mkdir(OUT, { recursive: true });
  const random = mulberry32(7);
  const terrain = await bakeTerrain();
  const standing = await readJson("buildings");
  const known = new Set(standing.map((e) => e.id));
  const destroyed = (await readJson("destroyed")).filter((e) => !known.has(e.id));
  const buildings = [...standing, ...destroyed].map((e) => bakeBuilding(e, random)).filter(Boolean);
  const { roads, names } = bakeRoads(await readJson("roads"));
  const areas = bakeAreas(await readJson("areas"));
  const trees = plantTrees(buildings, roads, await readJson("trees"), areas);
  const graph = await bakeGraph();
  const [fx0, fy0] = toLocal(DETAIL.south, DETAIL.west);
  const [fx1, fy1] = toLocal(DETAIL.north, DETAIL.east);

  const out = {
    origin: ORIGIN,
    detail: [fx0, fy0, fx1, fy1].map(Math.round),
    terrain,
    buildings: buildings.map((b) => [b.kind, b.roof, dm(b.walls), dm(b.rise), ...flat(b.ring)]),
    roads: roads.map((r) => [r.roadClass, r.name, r.tunnel ? 1 : 0, ...flat(r.path)]),
    roadNames: names,
    areas: areas.map((a) => [a.kind, ...flat(a.ring)]),
    trees: flat(trees),
    graph: {
      nodes: flat(graph.nodes),
      edges: graph.edges.map((e) => [e.u, e.v, Math.round(e.seconds * 10), ...flat(e.shape)]),
      keys: graph.edges.map((e) => e.key),
    },
  };
  const json = JSON.stringify(out);
  await writeFile(join(OUT, "altadena.json"), json);
  const centre = centroid(buildings.map((b) => centroid(b.ring)));
  console.log(
    `buildings ${buildings.length}, roads ${roads.length}, areas ${areas.length}, trees ${trees.length}, ` +
      `graph ${graph.nodes.length}/${graph.edges.length}, terrain ${terrain.cols}x${terrain.rows}, ` +
      `json ${(json.length / 1e6).toFixed(2)} MB, building centre ${centre.map(Math.round)}`,
  );
}

await main();
