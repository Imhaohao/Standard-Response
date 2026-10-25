import { AREA_KIND, areaRings, type InkMapData, type Point } from "../../data";
import { distanceTo, frontMask, type Raster } from "../../front-raster";
import { groundAt } from "./ground";
import type { WaterKind } from "./model";

// Where water lies before the disaster: the canals, rivers and ponds the map's land use draws as water,
// and for a coast the sea, filled from the edge of the terrain over ground at or below sea level. The
// Lower Ninth Ward sits below sea level, so a flood never fills from the edge: it would drown the ward
// before the levee broke.

export const SEA_LEVEL_METERS = 0.3;

// The bed of standing water the terrain draws flat: 0.6 m deep at the shore, 1.5 m deeper every 100 m
// out, to 12 m at most. Real bathymetry, where the terrain has some, is used instead wherever it is deeper.
export const SHELF = { shore: 0.6, slope: 0.015, deepest: 12 };
const MOST_CELLS_ACROSS = 1024;

export type ShoreGrid = Raster & {
  // 1 where water lies before the disaster.
  water: Uint8Array;
  // Metres to the shore: positive out over the water, negative inland.
  distance: Float32Array;
  // The direction from the sea toward the land on the map (a unit vector), for waves that come ashore.
  onshore: Point;
};

function terrainRaster({ terrain }: InkMapData): Raster {
  const x1 = terrain.x0 + (terrain.cols - 1) * terrain.cell;
  const y1 = terrain.y0 + (terrain.rows - 1) * terrain.cell;
  const cell = Math.max(terrain.cell, Math.max(x1 - terrain.x0, y1 - terrain.y0) / MOST_CELLS_ACROSS);
  return {
    width: Math.max(2, Math.round((x1 - terrain.x0) / cell)),
    height: Math.max(2, Math.round((y1 - terrain.y0) / cell)),
    region: { x0: terrain.x0, y0: terrain.y0, x1, y1 },
  };
}

export function cellCentre(raster: Raster, index: number): Point {
  const col = index % raster.width;
  const row = Math.floor(index / raster.width);
  const { x0, y0, x1, y1 } = raster.region;
  return [x0 + ((col + 0.5) / raster.width) * (x1 - x0), y0 + ((row + 0.5) / raster.height) * (y1 - y0)];
}

function edgeCells({ width, height }: Raster) {
  const cells: number[] = [];
  for (let col = 0; col < width; col++) cells.push(col, (height - 1) * width + col);
  for (let row = 1; row < height - 1; row++) cells.push(row * width, row * width + width - 1);
  return cells;
}

const neighbours = (index: number, { width, height }: Raster) => {
  const col = index % width;
  const row = (index - col) / width;
  const out: number[] = [];
  if (col > 0) out.push(index - 1);
  if (col < width - 1) out.push(index + 1);
  if (row > 0) out.push(index - width);
  if (row < height - 1) out.push(index + width);
  return out;
};

// Every cell at or below sea level joined to the edge of the terrain through other such cells.
export function seaFromEdges(raster: Raster, ground: Float32Array, water: Uint8Array) {
  const low = (index: number) => ground[index] <= SEA_LEVEL_METERS;
  const queue = edgeCells(raster).filter(low);
  for (const index of queue) water[index] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const next of neighbours(queue[head], raster)) {
      if (water[next] || !low(next)) continue;
      water[next] = 1;
      queue.push(next);
    }
  }
}

function signedDistance(water: Uint8Array, raster: Raster) {
  const toLand = distanceTo(water, 0, raster);
  const toWater = distanceTo(water, 1, raster);
  return Float32Array.from(water, (wet, index) => (wet ? toLand[index] : -toWater[index]));
}

// From the middle of the sea toward the middle of the land; south to north when there is no sea.
function onshoreDirection(raster: Raster, water: Uint8Array): Point {
  const sums = { water: [0, 0, 0], land: [0, 0, 0] };
  water.forEach((wet, index) => {
    const [x, y] = cellCentre(raster, index);
    const sum = wet ? sums.water : sums.land;
    sum[0] += x;
    sum[1] += y;
    sum[2] += 1;
  });
  if (sums.water[2] === 0 || sums.land[2] === 0) return [0, 1];
  const dx = sums.land[0] / sums.land[2] - sums.water[0] / sums.water[2];
  const dy = sums.land[1] / sums.land[2] - sums.water[1] / sums.water[2];
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

export function shoreGrid(data: InkMapData, { sea }: { sea: boolean }): ShoreGrid {
  const raster = terrainRaster(data);
  const waterAreas = data.areas.filter((area) => area.kind === AREA_KIND.water && area.ring.length >= 3).map(areaRings);
  const water = frontMask(waterAreas, raster);
  if (sea) {
    const ground = new Float32Array(raster.width * raster.height);
    for (let index = 0; index < ground.length; index++) ground[index] = groundAt(data, cellCentre(raster, index));
    seaFromEdges(raster, ground, water);
  }
  const distance = signedDistance(water, raster);
  return { ...raster, water, distance, onshore: onshoreDirection(raster, water) };
}

// Metres per step of the distance channel: a byte holds 127 steps, about a kilometre, either side of the shore.
export const SHORE_METERS_PER_STEP = 8;

// Two bytes a cell for the shader: red is the water, green the distance to the shore centred on 128.
export function shoreBytes(grid: ShoreGrid) {
  const bytes = new Uint8Array(grid.water.length * 2);
  for (let index = 0; index < grid.water.length; index++) {
    const steps = Math.max(-127, Math.min(127, Math.round(grid.distance[index] / SHORE_METERS_PER_STEP)));
    bytes[index * 2] = grid.water[index] ? 255 : 0;
    bytes[index * 2 + 1] = 128 + (Number.isFinite(steps) ? steps : -127);
  }
  return bytes;
}

// The grid cell under a map point, held to the grid's edge.
function cellAt(grid: ShoreGrid, [x, y]: Point) {
  const { x0, y0, x1, y1 } = grid.region;
  const col = Math.min(grid.width - 1, Math.max(0, Math.floor(((x - x0) / (x1 - x0)) * grid.width)));
  const row = Math.min(grid.height - 1, Math.max(0, Math.floor(((y - y0) / (y1 - y0)) * grid.height)));
  return row * grid.width + col;
}

// Whether water lay at a map point before the disaster.
export const isStandingWater = (grid: ShoreGrid, point: Point) => grid.water[cellAt(grid, point)] === 1;

// Metres from a map point to the old shore, positive out over the water; ±Infinity on a map with no
// water at all, or no land.
export const shoreDistanceAt = (grid: ShoreGrid, point: Point) => grid.distance[cellAt(grid, point)];

const shores = new WeakMap<InkMapData, Map<boolean, ShoreGrid>>();

// The shore is the same for the 3D map and the flat one, and costs a flood fill over the terrain, so it
// is worked out once per map. Only a coast fills from the edge.
export function shoreFor(data: InkMapData, kind: WaterKind) {
  const sea = kind !== "flood";
  const byKind = shores.get(data) ?? new Map<boolean, ShoreGrid>();
  shores.set(data, byKind);
  const known = byKind.get(sea);
  if (known) return known;
  const grid = shoreGrid(data, { sea });
  byKind.set(sea, grid);
  return grid;
}
