import type { Point } from "./model";

// Reads the bodies the "California evacuation status" Apify Actor posts: { zones: [...] } and
// { closures: [...] }, with GeoJSON geometry.
// Pure functions only, so the HTTP action and its tests share one definition of a usable zone.

export type AlertStatus = "warning" | "order";

export type ParsedZone = {
  key: string;
  name: string;
  status: AlertStatus;
  rings: Point[][];
  drill: boolean;
};

export type ParsedPayload = {
  zones: ParsedZone[];
  ignored: number;
};

const MIN_RING_POINTS = 3;
const MAX_RINGS_PER_ZONE = 50;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isAlertStatus = (value: unknown): value is AlertStatus => value === "warning" || value === "order";
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

function pointFrom(position: unknown): Point | null {
  if (!Array.isArray(position)) return null;
  const [lng, lat] = position;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  const inRange = Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
  return inRange ? { lat, lng } : null;
}

function ringFrom(positions: unknown): Point[] | null {
  if (!Array.isArray(positions)) return null;
  const points = positions.map(pointFrom);
  if (points.some((point) => point === null)) return null;
  const ring = points as Point[];
  return ring.length >= MIN_RING_POINTS ? ring : null;
}

// The outer ring of a polygon. Holes are ignored, so a household in a hole still counts as covered.
const outerRing = (polygon: unknown) => (Array.isArray(polygon) ? ringFrom(polygon[0]) : null);

function polygonsOf(type: unknown, coordinates: unknown[]): unknown[] {
  if (type === "Polygon") return [coordinates];
  if (type === "MultiPolygon") return coordinates;
  return [];
}

function ringsFrom(geometry: unknown): Point[][] {
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return [];
  const polygons = polygonsOf(geometry.type, geometry.coordinates);
  const rings = polygons.map(outerRing).filter((ring): ring is Point[] => ring !== null);
  return rings.slice(0, MAX_RINGS_PER_ZONE);
}

function zoneFrom(raw: unknown): ParsedZone | null {
  if (!isRecord(raw) || !isAlertStatus(raw.status)) return null;
  if (raw.kind !== undefined && raw.kind !== "evacuation_zone") return null;
  if (!nonEmptyString(raw.source) || !nonEmptyString(raw.id)) return null;
  const rings = ringsFrom(raw.geometry);
  if (rings.length === 0) return null;
  return {
    key: `${raw.source}:${raw.id}`,
    name: nonEmptyString(raw.name) ? raw.name.trim() : raw.id,
    status: raw.status,
    rings,
    drill: raw.drill === true,
  };
}

export function parsePayload(body: unknown): ParsedPayload | null {
  if (!isRecord(body) || !Array.isArray(body.zones)) return null;
  const parsed = body.zones.map(zoneFrom);
  const zones = parsed.filter((zone): zone is ParsedZone => zone !== null);
  return { zones, ignored: parsed.length - zones.length };
}

// Road closures the Actor posts to /apify/road-closures: { closures: [...] }. "closed" carries the
// closure's GeoJSON line or point; "lifted" names one sent before that the source no longer reports.
export type ParsedClosure =
  | { key: string; name: string; status: "closed"; path: Point[]; drill: boolean }
  | { key: string; name: string; status: "lifted" };

export type ParsedClosures = {
  closures: ParsedClosure[];
  ignored: number;
};

const MAX_PATH_POINTS = 500;

function pathFrom(geometry: unknown): Point[] | null {
  if (!isRecord(geometry)) return null;
  if (geometry.type === "Point") {
    const point = pointFrom(geometry.coordinates);
    return point ? [point] : null;
  }
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) return null;
  const points = geometry.coordinates.slice(0, MAX_PATH_POINTS).map(pointFrom);
  if (points.length < 2 || points.some((point) => point === null)) return null;
  return points as Point[];
}

function closureFrom(raw: unknown): ParsedClosure | null {
  if (!isRecord(raw) || (raw.kind !== undefined && raw.kind !== "road_closure")) return null;
  if (!nonEmptyString(raw.source) || !nonEmptyString(raw.id)) return null;
  const key = `${raw.source}:${raw.id}`;
  const name = nonEmptyString(raw.name) ? raw.name.trim() : raw.id;
  if (raw.status === "lifted") return { key, name, status: "lifted" };
  if (raw.status !== "closed") return null;
  const path = pathFrom(raw.geometry);
  return path ? { key, name, status: "closed", path, drill: raw.drill === true } : null;
}

export function parseClosures(body: unknown): ParsedClosures | null {
  if (!isRecord(body) || !Array.isArray(body.closures)) return null;
  const parsed = body.closures.map(closureFrom);
  const closures = parsed.filter((closure): closure is ParsedClosure => closure !== null);
  return { closures, ignored: parsed.length - closures.length };
}

export function secretMatches(provided: string | null, expected: string | undefined) {
  if (!expected || !provided) return false;
  if (!/^Bearer\s+/i.test(provided)) return false;
  const token = provided.replace(/^Bearer\s+/i, "");
  if (token.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < token.length; i += 1) difference |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
