import type { BoundingBox, EvacuationRecord, Geometry } from "./types.js";

const normalizeCounty = (name: string) => name.trim().toLowerCase().replace(/\s+county$/, "");

export function matchesCounties(record: EvacuationRecord, counties: string[]) {
  if (counties.length === 0) return true;
  if (!record.county) return false;
  const wanted = new Set(counties.map(normalizeCounty));
  return wanted.has(normalizeCounty(record.county));
}

function* positions(geometry: Geometry): Generator<[number, number]> {
  switch (geometry.type) {
    case "Point":
      yield geometry.coordinates;
      return;
    case "LineString":
      yield* geometry.coordinates;
      return;
    case "Polygon":
      for (const ring of geometry.coordinates) yield* ring;
      return;
    case "MultiPolygon":
      for (const polygon of geometry.coordinates) for (const ring of polygon) yield* ring;
  }
}

export function boundsOf(geometry: Geometry): BoundingBox | null {
  let bounds: BoundingBox | null = null;
  for (const [lng, lat] of positions(geometry)) {
    bounds = bounds
      ? { west: Math.min(bounds.west, lng), east: Math.max(bounds.east, lng), south: Math.min(bounds.south, lat), north: Math.max(bounds.north, lat) }
      : { west: lng, east: lng, south: lat, north: lat };
  }
  return bounds;
}

const boxesOverlap = (a: BoundingBox, b: BoundingBox) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

export function touchesBox(record: EvacuationRecord, box: BoundingBox | undefined) {
  if (!box) return true;
  const bounds = boundsOf(record.geometry);
  return bounds !== null && boxesOverlap(bounds, box);
}

export function applyFilters(records: EvacuationRecord[], counties: string[], box: BoundingBox | undefined) {
  return records.filter((record) => matchesCounties(record, counties) && touchesBox(record, box));
}

// Cal OES ids look like US-CA-XTU-PVL-E044 and CAL FIRE ids like PVL-E044. Both name the same county zone.
const zoneKey = (record: EvacuationRecord) => `${(record.county ?? "").toLowerCase()}|${record.id.replace(/^US-CA-[A-Z]+-/, "").toLowerCase()}`;

// The two statewide layers overlap. Keep the first record seen for each zone, so list Cal OES first.
export function dedupeZones(records: EvacuationRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (record.kind !== "evacuation_zone") return true;
    const key = zoneKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
