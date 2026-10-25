import type { Point } from "./data";

// Fronts drawn onto the fire field's grid: which cells a front holds, and how far each cell is from a
// front's edge. Scanline fill and a two-pass chamfer distance keep this linear in the number of cells,
// so a front with hundreds of islands costs no more than a smooth ellipse.

export type Raster = { width: number; height: number; region: { x0: number; y0: number; x1: number; y1: number } };

// Each polygon is its outer ring followed by its holes.
export type FrontShape = Point[][][];

function crossingsAt(rings: Point[][], y: number) {
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
  }
  return xs.sort((a, b) => a - b);
}

function rowSpan(raster: Raster, rings: Point[][]) {
  const cellY = (raster.region.y1 - raster.region.y0) / raster.height;
  let low = Infinity;
  let high = -Infinity;
  for (const [, y] of rings[0]) [low, high] = [Math.min(low, y), Math.max(high, y)];
  const first = Math.max(0, Math.floor((low - raster.region.y0) / cellY - 0.5));
  const last = Math.min(raster.height - 1, Math.ceil((high - raster.region.y0) / cellY - 0.5));
  return { first, last, cellY };
}

// Fills one polygon, holes left out, by the even-odd rule over its rings.
function fillPolygon(mask: Uint8Array, raster: Raster, rings: Point[][]) {
  const { first, last, cellY } = rowSpan(raster, rings);
  const cellX = (raster.region.x1 - raster.region.x0) / raster.width;
  for (let row = first; row <= last; row++) {
    const xs = crossingsAt(rings, raster.region.y0 + (row + 0.5) * cellY);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k] - raster.region.x0) / cellX - 0.5));
      const to = Math.min(raster.width - 1, Math.floor((xs[k + 1] - raster.region.x0) / cellX - 0.5));
      mask.fill(1, row * raster.width + from, row * raster.width + to + 1);
    }
  }
}

// The cells whose centres the front holds. Overlapping polygons add up rather than cancel.
export function frontMask(shape: FrontShape, raster: Raster) {
  const mask = new Uint8Array(raster.width * raster.height);
  for (const rings of shape) if (rings[0]?.length >= 3) fillPolygon(mask, raster, rings);
  return mask;
}

type Step = { dc: number; dr: number; cost: number };

function sweep(distance: Float32Array, raster: Raster, steps: Step[], forward: boolean) {
  const { width, height } = raster;
  for (let n = 0; n < width * height; n++) {
    const index = forward ? n : width * height - 1 - n;
    const row = Math.floor(index / width);
    const col = index - row * width;
    let best = distance[index];
    for (const { dc, dr, cost } of steps) {
      const c = col + (forward ? dc : -dc);
      const r = row + (forward ? dr : -dr);
      if (c < 0 || r < 0 || c >= width || r >= height) continue;
      best = Math.min(best, distance[r * width + c] + cost);
    }
    distance[index] = best;
  }
}

// Metres from each cell to the nearest cell whose mask value is `target` (0 on those cells), or
// Infinity everywhere when no cell has it.
export function distanceTo(mask: Uint8Array, target: 0 | 1, raster: Raster) {
  const cellX = (raster.region.x1 - raster.region.x0) / raster.width;
  const cellY = (raster.region.y1 - raster.region.y0) / raster.height;
  const diagonal = Math.hypot(cellX, cellY);
  const distance = Float32Array.from(mask, (value) => (value === target ? 0 : Infinity));
  const behind: Step[] = [
    { dc: -1, dr: 0, cost: cellX },
    { dc: -1, dr: -1, cost: diagonal },
    { dc: 0, dr: -1, cost: cellY },
    { dc: 1, dr: -1, cost: diagonal },
  ];
  sweep(distance, raster, behind, true);
  sweep(distance, raster, behind, false);
  return distance;
}
