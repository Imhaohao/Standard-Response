import type { LatLng } from "../geo";
import type { Point } from "./data";
import { distanceTo, frontMask, FrontShape, Raster } from "./front-raster";

// The hazard scenario: nested fire fronts, each tagged with the minute after the warning it is reached.
// `ring` is the outline of the front's largest piece, for anything that needs one shape. `polygons`, when
// present, is the whole front: every piece, each with the unburned islands inside it as holes.
export type ScenarioFront = { minutes: number; ring: Point[]; polygons?: FrontShape };
export type FireField = {
  fronts: ScenarioFront[];
  minutes: Float32Array;
  width: number;
  height: number;
  region: { x0: number; y0: number; x1: number; y1: number };
};

export const NEVER_BURNS = 1e4;
const FRONT_SPACING_MINUTES = 30;
// How fast the fire is taken to have grown into its first front, for points inside it.
const FIRST_FRONT_METERS_PER_MINUTE = 25;

type Ring = number[][];
type GeoJsonFeature = {
  properties: { minutesAfterWarning: number };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
};
export type ScenarioGeoJson = { features: GeoJsonFeature[] };

function ringArea(ring: Point[]) {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(twice / 2);
}

const largestOuterRing = (polygons: FrontShape) => polygons.map((rings) => rings[0]).reduce((largest, ring) => (ringArea(ring) > ringArea(largest) ? ring : largest));

export function scenarioFronts(geojson: ScenarioGeoJson, toLocal: (p: LatLng) => Point): ScenarioFront[] {
  const local = (ring: Ring) => ring.map(([lng, lat]) => toLocal({ lat, lng }));
  return geojson.features
    .map((f) => {
      const pieces = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      const polygons = pieces.map((rings) => rings.map(local));
      return { minutes: f.properties.minutesAfterWarning, ring: largestOuterRing(polygons), polygons };
    })
    .sort((a, b) => a.minutes - b.minutes);
}

export function contains(ring: Point[], x: number, y: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const shapeOf = (front: ScenarioFront): FrontShape => front.polygons ?? [[front.ring]];

// Whether the front has burned a point: inside one of its pieces and not on one of that piece's islands.
export function holds(front: ScenarioFront, x: number, y: number) {
  return shapeOf(front).some(([outer, ...holes]) => contains(outer, x, y) && !holes.some((hole) => contains(hole, x, y)));
}

function distanceToRing(ring: Point[], x: number, y: number) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

// Distance to the nearest edge of a front, island shores included.
function distanceToEdge(front: ScenarioFront, x: number, y: number) {
  let best = Infinity;
  for (const rings of shapeOf(front)) for (const ring of rings) best = Math.min(best, distanceToRing(ring, x, y));
  return best;
}

// Arrival minute at a point: interpolated by distance between the last front that misses it and the first that holds it.
export function arrivalAt(fronts: ScenarioFront[], x: number, y: number) {
  const index = fronts.findIndex((f) => holds(f, x, y));
  if (index < 0) return NEVER_BURNS;
  if (index === 0) return fronts[0].minutes - Math.min(distanceToEdge(fronts[0], x, y) / FIRST_FRONT_METERS_PER_MINUTE, FRONT_SPACING_MINUTES);
  const outer = fronts[index];
  const inner = fronts[index - 1];
  const toInner = distanceToEdge(inner, x, y);
  const toOuter = distanceToEdge(outer, x, y);
  return inner.minutes + ((outer.minutes - inner.minutes) * toInner) / (toInner + toOuter || 1);
}

function regionAround(front: ScenarioFront, pad: number) {
  const outlines = shapeOf(front).map((rings) => rings[0]);
  const xs = outlines.flatMap((ring) => ring.map((p) => p[0]));
  const ys = outlines.flatMap((ring) => ring.map((p) => p[1]));
  return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
}

type Band = { inner: { minutes: number; outside: Float32Array } | null; minutes: number; inside: Float32Array };

// The same interpolation as arrivalAt, with distances measured on the grid instead of to every edge.
function bandMinutes(band: Band, index: number) {
  const toOuter = band.inside[index];
  if (!band.inner || !Number.isFinite(band.inner.outside[index])) {
    const spacing = band.inner ? band.minutes - band.inner.minutes : FRONT_SPACING_MINUTES;
    return band.minutes - Math.min(toOuter / FIRST_FRONT_METERS_PER_MINUTE, spacing);
  }
  const toInner = band.inner.outside[index];
  return band.inner.minutes + ((band.minutes - band.inner.minutes) * toInner) / (toInner + toOuter || 1);
}

export function buildFireField(fronts: ScenarioFront[], width = 320): FireField {
  const region = regionAround(fronts[fronts.length - 1], 200);
  const height = Math.round((width * (region.y1 - region.y0)) / (region.x1 - region.x0));
  const raster: Raster = { width, height, region };
  // Points no front reaches ramp gently past the last front instead of jumping, so filtering stays smooth.
  const minutes = new Float32Array(width * height).fill(fronts[fronts.length - 1].minutes + 45);
  const settled = new Uint8Array(width * height);
  let inner: Band["inner"] = null;
  for (const front of fronts) {
    const held = frontMask(shapeOf(front), raster);
    const band: Band = { inner, minutes: front.minutes, inside: distanceTo(held, 0, raster) };
    for (let index = 0; index < held.length; index++) {
      if (!held[index] || settled[index]) continue;
      minutes[index] = bandMinutes(band, index);
      settled[index] = 1;
    }
    inner = { minutes: front.minutes, outside: distanceTo(held, 1, raster) };
  }
  return { fronts, minutes, width, height, region };
}

// Where a point stands against the fire right now: inside the burning edge, behind it in the burned
// ground, or not reached. Read from the precomputed field, so markers can ask every frame.
export type FireState = "burning" | "burned" | null;
const BURNING_MINUTES = 12;

export function fireStateAt(field: FireField, [x, y]: Point, minutes: number): FireState {
  const { region, width, height } = field;
  const col = Math.floor(((x - region.x0) / (region.x1 - region.x0)) * width);
  const row = Math.floor(((y - region.y0) / (region.y1 - region.y0)) * height);
  if (col < 0 || row < 0 || col >= width || row >= height) return null;
  const arrival = field.minutes[row * width + col];
  if (arrival > minutes) return null;
  return minutes - arrival <= BURNING_MINUTES ? "burning" : "burned";
}

// The minute after the warning the fire reaches a point, or null where it never does in this scenario.
export function arrivalMinutesAt(field: FireField, [x, y]: Point): number | null {
  const { region, width, height } = field;
  const col = Math.floor(((x - region.x0) / (region.x1 - region.x0)) * width);
  const row = Math.floor(((y - region.y0) / (region.y1 - region.y0)) * height);
  if (col < 0 || row < 0 || col >= width || row >= height) return null;
  const arrival = field.minutes[row * width + col];
  return arrival >= NEVER_BURNS ? null : arrival;
}

// The field as a grid for tracing outlines (isolines.ts): each cell's arrival minute at its centre.
export function fieldGrid(field: FireField) {
  const cellX = (field.region.x1 - field.region.x0) / field.width;
  const cellY = (field.region.y1 - field.region.y0) / field.height;
  return {
    values: field.minutes,
    width: field.width,
    height: field.height,
    at: (col: number, row: number): Point => [field.region.x0 + (col + 0.5) * cellX, field.region.y0 + (row + 0.5) * cellY],
  };
}
