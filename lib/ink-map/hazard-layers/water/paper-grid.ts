import type { InkMapData, Point } from "../../data";
import type { FireField } from "../../fire-field";
import { isolines, type Grid } from "../../isolines";
import { frontArrival } from "./impact";
import { groundAt, surfaceAt, type WaterModel } from "./model";
import { cellCentre, isStandingWater, SHELF, shoreDistanceAt, type ShoreGrid } from "./shore";

// The flat map's water, worked out on a coarse grid of its own and traced into outlines: the standing
// water before the disaster, how much of it the sea has drawn back, and the flood's depth bands now.

const PAPER_CELLS_ACROSS = 180;
const DRY = 1e6;

type Region = { x0: number; y0: number; x1: number; y1: number };

function coarseGrid(region: Region, cellsAcross: number) {
  const width = cellsAcross;
  const height = Math.max(2, Math.round((cellsAcross * (region.y1 - region.y0)) / (region.x1 - region.x0)));
  const raster = { width, height, region };
  const points = Array.from({ length: width * height }, (_, index) => cellCentre(raster, index));
  return { ...raster, points, at: (col: number, row: number) => points[row * width + col] };
}

export type DepthCells = ReturnType<typeof depthCells>;

// The ground, arrival and standing water at every cell over the reached area, worked out once.
export function depthCells(data: InkMapData, field: FireField, shore: ShoreGrid) {
  const grid = coarseGrid(field.region, Math.min(PAPER_CELLS_ACROSS, field.width));
  return {
    ...grid,
    ground: Float32Array.from(grid.points, (point) => groundAt(data, point)),
    arrival: Float32Array.from(grid.points, (point) => frontArrival(field, point) ?? Infinity),
    standing: Uint8Array.from(grid.points, (point) => (isStandingWater(shore, point) ? 1 : 0)),
  };
}

// Outlines of ground the water stands at least `depth` deep over at a minute, one per depth asked for.
export function depthOutlines(cells: DepthCells, model: WaterModel, minutes: number, depths: number[]): Point[][][] {
  const negativeDepth = new Float32Array(cells.points.length);
  for (let index = 0; index < negativeDepth.length; index++) {
    const reached = cells.arrival[index] <= minutes && !cells.standing[index];
    negativeDepth[index] = reached ? cells.ground[index] - surfaceAt(model, cells.points[index], minutes) : DRY;
  }
  const grid: Grid = { values: negativeDepth, width: cells.width, height: cells.height, at: cells.at };
  return depths.map((depth) => isolines(grid, -depth));
}

export type StandingCells = ReturnType<typeof standingCells>;

// The shore grid shrunk to the flat map's size: how far out over the water each cell is (negative inland).
export function standingCells(shore: ShoreGrid) {
  const grid = coarseGrid(shore.region, Math.min(PAPER_CELLS_ACROSS, shore.width));
  const negativeOffshore = Float32Array.from(grid.points, (point) => -Math.max(-1e4, Math.min(1e4, shoreDistanceAt(shore, point))));
  return { ...grid, negativeOffshore };
}

// The standing water at least `offshore` metres out from its old shore: zero for all of it, more to leave
// the bared seabed out when the sea has drawn back.
export function standingOutline(cells: StandingCells, offshore: number) {
  const grid: Grid = { values: cells.negativeOffshore, width: cells.width, height: cells.height, at: cells.at };
  return isolines(grid, -offshore);
}

// How far out the sea has drawn back at a level below rest: the same shelf the shader gives a sea the
// terrain draws flat (glsl.ts bedAt).
export const drawnBackMeters = (level: number) => Math.max(0, (-level - SHELF.shore) / SHELF.slope);
