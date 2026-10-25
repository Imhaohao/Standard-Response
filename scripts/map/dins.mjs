// Buildings for a town OpenStreetMap hadn't traced before it burned, from CAL FIRE's damage
// inspections (DINS): one record, with a point and a structure type, for every structure the fire
// reached. Each becomes a rectangle of a size set by its type (FOOTPRINTS below), centred on the
// point and turned to face the nearest street. They are stand-ins, not traced footprints: the
// count, the position and the kind of every building are real, the outline is not.
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { distanceToSegment, pointInRing, SpatialGrid } from "./geometry.mjs";

const DINS_LAYER = "https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/POSTFIRE_MASTER_DATA_SHARE/FeatureServer/0";
const PAGE = 2000;
const STREET_REACH_METERS = 80;

// First match wins: [pattern on STRUCTURETYPE, OSM building tag, length m, width m, levels].
const FOOTPRINTS = [
  [/Mobile Home Single Wide/, "house", 20, 4.5, 1],
  [/Mobile Home Double Wide/, "house", 20, 8.5, 1],
  [/Mobile Home Triple Wide/, "house", 20, 12, 1],
  [/Motor Home/, "shed", 10, 3, 1],
  [/Single Fam\w+ Residence Multi Story/, "house", 12, 10, 2],
  [/Single Fam\w+ Residence/, "house", 15, 11, 1],
  [/Multi Family Residence Multi Story/, "apartments", 24, 14, 2],
  [/Multi Family Residence/, "apartments", 24, 14, 1],
  [/Mixed Commercial/, "commercial", 22, 16, 2],
  [/Commercial Building Multi Story/, "commercial", 26, 18, 2],
  [/Commercial|Agriculture|Infrastructure/, "commercial", 24, 16, 1],
  [/School|Hospital/, "school", 30, 18, 1],
  [/Church/, "church", 22, 14, 1],
  [/Utility Misc Structure/, "shed", 6, 5, 1],
];

export const DINS_FOOTPRINT_RULE =
  "Buildings are CAL FIRE DINS structure points with stand-in rectangles by structure type (single-story house 15x11 m, " +
  "two-story 12x10 m, mobile homes 20 m long and 4.5, 8.5 or 12 m wide, outbuildings 6x5 m), turned to the nearest street.";

const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

export async function fetchDins(cache, bounds, incident, userAgent) {
  const path = join(cache, "dins.json");
  if (await exists(path)) return console.log("dins: cached");
  const where =
    `INCIDENTNAME='${incident}' AND LATITUDE>${bounds.south} AND LATITUDE<${bounds.north} ` +
    `AND LONGITUDE>${bounds.west} AND LONGITUDE<${bounds.east}`;
  const records = [];
  for (let offset = 0; ; offset += PAGE) {
    const query = new URLSearchParams({
      where,
      outFields: "OBJECTID,STRUCTURETYPE,STRUCTURECATEGORY,DAMAGE,LATITUDE,LONGITUDE",
      returnGeometry: "false",
      orderByFields: "OBJECTID",
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: "json",
    });
    const response = await fetch(`${DINS_LAYER}/query?${query}`, { headers: { "User-Agent": userAgent } });
    if (!response.ok) throw new Error(`dins: ${response.status}`);
    const page = (await response.json()).features.map((feature) => feature.attributes);
    records.push(...page);
    if (page.length < PAGE) break;
  }
  await writeFile(path, JSON.stringify(records));
  console.log(`dins: ${records.length} structures`);
}

function streetIndex(roadElements, toLocal) {
  const grid = new SpatialGrid(50);
  for (const road of roadElements) {
    const path = (road.geometry ?? []).map(({ lat, lon }) => toLocal(lat, lon));
    for (let i = 1; i < path.length; i++) {
      const [[ax, ay], [bx, by]] = [path[i - 1], path[i]];
      grid.insert({ ax, ay, bx, by }, Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    }
  }
  return grid;
}

// The direction of the nearest street within reach, so a house lines up with its road; 0 when none is near.
function streetAngle(streets, x, y) {
  let best = { distance: STREET_REACH_METERS, angle: 0 };
  for (let dy = -STREET_REACH_METERS; dy <= STREET_REACH_METERS; dy += 50) {
    for (let dx = -STREET_REACH_METERS; dx <= STREET_REACH_METERS; dx += 50) {
      for (const s of streets.near(x + dx, y + dy)) {
        const distance = distanceToSegment(x, y, s.ax, s.ay, s.bx, s.by);
        if (distance < best.distance) best = { distance, angle: Math.atan2(s.by - s.ay, s.bx - s.ax) };
      }
    }
  }
  return best.angle;
}

function rectangle([x, y], length, width, angle) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [
    [-length / 2, -width / 2],
    [length / 2, -width / 2],
    [length / 2, width / 2],
    [-length / 2, width / 2],
  ].map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
}

function tracedIndex(traced, toLocal) {
  const grid = new SpatialGrid(50);
  for (const element of traced) {
    const ring = (element.geometry ?? []).map(({ lat, lon }) => toLocal(lat, lon));
    if (ring.length < 3) continue;
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    grid.insert(ring, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  return (x, y) => grid.near(x, y).some((ring) => pointInRing(x, y, ring));
}

// OSM-shaped elements bake.mjs takes like any other building. A structure inside a building OSM
// already traced is left to the traced one.
export async function dinsBuildingElements(cache, { roads, traced }, toLocal, toLatLng) {
  const records = JSON.parse(await readFile(join(cache, "dins.json"), "utf8"));
  const streets = streetIndex(roads, toLocal);
  const isTraced = tracedIndex(traced, toLocal);
  return records.flatMap((record) => {
    const footprint = FOOTPRINTS.find(([pattern]) => pattern.test(record.STRUCTURETYPE ?? ""));
    const centre = toLocal(record.LATITUDE, record.LONGITUDE);
    if (!footprint || isTraced(...centre)) return [];
    const [, building, length, width, levels] = footprint;
    const ring = rectangle(centre, length, width, streetAngle(streets, ...centre));
    const geometry = [...ring, ring[0]].map(([x, y]) => toLatLng(x, y)).map(({ lat, lng }) => ({ lat, lon: lng }));
    return [{ type: "way", id: -record.OBJECTID, tags: { building, "building:levels": String(levels) }, geometry }];
  });
}
