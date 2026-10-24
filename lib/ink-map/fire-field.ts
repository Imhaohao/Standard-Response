import type { LatLng } from "@/lib/geo";
import type { Point } from "./data";

// Track D's scenario: nested fire fronts, each tagged with the minute after the warning it is reached.
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

type GeoJsonFeature = { properties: { minutesAfterWarning: number }; geometry: { coordinates: number[][][] } };
export type ScenarioGeoJson = { features: GeoJsonFeature[] };

export function scenarioFronts(geojson: ScenarioGeoJson, toLocal: (p: LatLng) => Point): ScenarioFront[] {
  return geojson.features
    .map((f) => ({
      minutes: f.properties.minutesAfterWarning,
      ring: f.geometry.coordinates[0].map(([lng, lat]) => toLocal({ lat, lng })),
    }))
    .sort((a, b) => a.minutes - b.minutes);
}

function contains(ring: Point[], x: number, y: number) {
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
