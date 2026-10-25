import type { LatLng } from "@/lib/geo";
import type { Point } from "./data";

// The hazard scenario: nested fire fronts, each tagged with the minute after the warning it is reached.
export type ScenarioFront = { minutes: number; ring: Point[] };
export type FireField = {
  fronts: ScenarioFront[];
  minutes: Float32Array;
  width: number;
  height: number;
  region: { x0: number; y0: number; x1: number; y1: number };
};

export const NEVER_BURNS = 1e4;
const FRONT_SPACING_MINUTES = 30;

type Ring = number[][];
type GeoJsonFeature = {
  properties: { minutesAfterWarning: number };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
};

// A front's outline: the outer ring of the polygon, or of the largest polygon when a band comes in
// several pieces.
function outerRing(geometry: GeoJsonFeature["geometry"]): Ring {
  if (geometry.type === "Polygon") return geometry.coordinates[0];
  return geometry.coordinates.map((polygon) => polygon[0]).reduce((largest, ring) => (ring.length > largest.length ? ring : largest));
}
export type ScenarioGeoJson = { features: GeoJsonFeature[] };

export function scenarioFronts(geojson: ScenarioGeoJson, toLocal: (p: LatLng) => Point): ScenarioFront[] {
  return geojson.features
    .map((f) => ({
      minutes: f.properties.minutesAfterWarning,
      ring: outerRing(f.geometry).map(([lng, lat]) => toLocal({ lat, lng })),
    }))
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

// Arrival minute at a point: interpolated by distance between the last front that misses it and the first that holds it.
export function arrivalAt(fronts: ScenarioFront[], x: number, y: number) {
  const index = fronts.findIndex((f) => contains(f.ring, x, y));
  if (index < 0) return NEVER_BURNS;
  if (index === 0) return fronts[0].minutes - Math.min(distanceToRing(fronts[0].ring, x, y) / 25, FRONT_SPACING_MINUTES);
  const outer = fronts[index];
  const inner = fronts[index - 1];
  const toInner = distanceToRing(inner.ring, x, y);
  const toOuter = distanceToRing(outer.ring, x, y);
  return inner.minutes + ((outer.minutes - inner.minutes) * toInner) / (toInner + toOuter || 1);
}

export function buildFireField(fronts: ScenarioFront[], width = 320): FireField {
  const last = fronts[fronts.length - 1].ring;
  const pad = 200;
  const region = {
    x0: Math.min(...last.map((p) => p[0])) - pad,
    y0: Math.min(...last.map((p) => p[1])) - pad,
    x1: Math.max(...last.map((p) => p[0])) + pad,
    y1: Math.max(...last.map((p) => p[1])) + pad,
  };
  const height = Math.round((width * (region.y1 - region.y0)) / (region.x1 - region.x0));
  const minutes = new Float32Array(width * height);
  // Points no front reaches ramp gently past the last front instead of jumping, so filtering stays smooth.
  const beyond = fronts[fronts.length - 1].minutes + 45;
  for (let row = 0; row < height; row++) {
    const y = region.y0 + ((row + 0.5) / height) * (region.y1 - region.y0);
    for (let col = 0; col < width; col++) {
      const x = region.x0 + ((col + 0.5) / width) * (region.x1 - region.x0);
      minutes[row * width + col] = Math.min(arrivalAt(fronts, x, y), beyond);
    }
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
