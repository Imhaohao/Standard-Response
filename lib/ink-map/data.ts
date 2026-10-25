import type { LatLng } from "../geo";

// The baked map from scripts/map/bake.mjs. Coordinates are decimeters east and north of `origin`.
type RawMap = {
  origin: LatLng;
  detail: [number, number, number, number];
  extent?: [number, number, number, number];
  terrain: { cols: number; rows: number; cell: number; x0: number; y0: number };
  buildings: number[][];
  roads: number[][];
  roadNames: string[];
  areas: number[][];
  trees: number[];
  graph: { nodes: number[]; edges: number[][]; keys: string[] };
};

export type Point = [number, number];

export const BUILDING_KIND = { house: 0, apartments: 1, outbuilding: 2, commercial: 3, civic: 4 } as const;
export const ROOF = { flat: 0, gable: 1, hip: 2 } as const;
export const AREA_KIND = { park: 0, grass: 1, water: 2, school: 3, parking: 4, cemetery: 5, golf: 6, pitch: 7, wild: 8 } as const;
export const ROAD_WIDTH = [20, 15, 13, 11, 8, 4.5, 3, 1.6];
export const MINOR_ROAD_CLASS = 5;

export type Building = { id: number; kind: number; roof: number; walls: number; rise: number; ring: Point[]; center: Point };
export type Road = { roadClass: number; name: string; tunnel: boolean; path: Point[] };
export type Area = { kind: number; ring: Point[] };
export type GraphEdge = { u: number; v: number; seconds: number; key: string; shape: Point[] };

export type Terrain = {
  cols: number;
  rows: number;
  cell: number;
  x0: number;
  y0: number;
  heights: Float32Array;
  base: number;
};

export type InkMapData = {
  origin: LatLng;
  // The town the camera frames and keeps to.
  detail: { x0: number; y0: number; x1: number; y1: number };
  // The wider ground buildings, streets and trees cover, so a view near the town's edge looks out
  // over its neighbours.
  extent: { x0: number; y0: number; x1: number; y1: number };
  terrain: Terrain;
  buildings: Building[];
  roads: Road[];
  areas: Area[];
  trees: Float32Array;
  graph: { nodes: Point[]; edges: GraphEdge[] };
};

const METERS_PER_DEG_LAT = 110_574;

export function createProjection(origin: LatLng) {
  const metersPerDegLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toLocal: ({ lat, lng }: LatLng): Point => [(lng - origin.lng) * metersPerDegLng, (lat - origin.lat) * METERS_PER_DEG_LAT],
    toLatLng: ([x, y]: Point): LatLng => ({ lat: origin.lat + y / METERS_PER_DEG_LAT, lng: origin.lng + x / metersPerDegLng }),
  };
}

function points(flat: number[], start: number): Point[] {
  const out: Point[] = [];
  for (let i = start; i + 1 < flat.length; i += 2) out.push([flat[i] / 10, flat[i + 1] / 10]);
  return out;
}

function ringCenter(ring: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

// Elevation in meters above the map's base, bilinear, matching how the terrain mesh is built.
export function terrainHeight(terrain: Terrain, x: number, y: number) {
  const fx = Math.min(Math.max((x - terrain.x0) / terrain.cell, 0), terrain.cols - 1.001);
  const fy = Math.min(Math.max((y - terrain.y0) / terrain.cell, 0), terrain.rows - 1.001);
  const c = Math.floor(fx);
  const r = Math.floor(fy);
  const tx = fx - c;
  const ty = fy - r;
  const at = (cc: number, rr: number) => terrain.heights[rr * terrain.cols + cc];
  const top = at(c, r) * (1 - tx) + at(c + 1, r) * tx;
  const bottom = at(c, r + 1) * (1 - tx) + at(c + 1, r + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function decodeTerrain(raw: RawMap["terrain"], buffer: ArrayBuffer): Terrain {
  const decimeters = new Uint16Array(buffer);
  let min = Infinity;
  for (const value of decimeters) min = Math.min(min, value);
  const heights = new Float32Array(decimeters.length);
  for (let i = 0; i < decimeters.length; i++) heights[i] = (decimeters[i] - min) / 10;
  return { ...raw, heights, base: min / 10 };
}

function decode(raw: RawMap, terrainBuffer: ArrayBuffer): InkMapData {
  const [x0, y0, x1, y1] = raw.detail;
  const [ex0, ey0, ex1, ey1] = raw.extent ?? raw.detail;
  return {
    origin: raw.origin,
    detail: { x0, y0, x1, y1 },
    extent: { x0: ex0, y0: ey0, x1: ex1, y1: ey1 },
    terrain: decodeTerrain(raw.terrain, terrainBuffer),
    buildings: raw.buildings.map((b, id) => {
      const ring = points(b, 4);
      return { id, kind: b[0], roof: b[1], walls: b[2] / 10, rise: b[3] / 10, ring, center: ringCenter(ring) };
    }),
    roads: raw.roads.map((r) => ({ roadClass: r[0], name: raw.roadNames[r[1]], tunnel: r[2] === 1, path: points(r, 3) })),
    areas: raw.areas.map((a) => ({ kind: a[0], ring: points(a, 1) })),
    trees: Float32Array.from(raw.trees, (v) => v / 10),
    graph: {
      nodes: points(raw.graph.nodes, 0),
      edges: raw.graph.edges.map((e, i) => ({ u: e[0], v: e[1], seconds: e[2] / 10, key: raw.graph.keys[i], shape: points(e, 3) })),
    },
  };
}

let pending: Promise<InkMapData> | null = null;

export function loadInkMapData() {
  pending ??= Promise.all([
    fetch("/map/altadena.json").then((r) => r.json() as Promise<RawMap>),
    fetch("/map/terrain.bin").then((r) => r.arrayBuffer()),
  ]).then(([raw, terrain]) => decode(raw, terrain));
  return pending;
}
