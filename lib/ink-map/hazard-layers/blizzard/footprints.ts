import type { Building, Point } from "../../data";

// Where the buildings stand, as a one-byte grid over the ground the camera sees: 255 inside a
// footprint, 0 outside. The snow shader walks it downwind from every patch of ground to find the
// wall a drift piles against, and upwind to find the house whose lee keeps the ground bare.

export type Region = { x0: number; y0: number; x1: number; y1: number };
export type FootprintMask = { cells: Uint8Array; width: number; height: number; region: Region; cellMeters: number };

// A one-byte texel each: three million is 3 MB of GPU memory.
export const MOST_MASK_CELLS = 3_000_000;
const FINEST_CELL_METERS = 1;
const MOST_MASK_SIDE = 4096;

export function maskShape(region: Region, mostCells = MOST_MASK_CELLS) {
  const widthMeters = Math.max(1, region.x1 - region.x0);
  const heightMeters = Math.max(1, region.y1 - region.y0);
  const byCount = Math.sqrt((widthMeters * heightMeters) / mostCells);
  const bySide = Math.max(widthMeters, heightMeters) / MOST_MASK_SIDE;
  const cellMeters = Math.max(FINEST_CELL_METERS, byCount, bySide);
  return { cellMeters, width: Math.ceil(widthMeters / cellMeters), height: Math.ceil(heightMeters / cellMeters) };
}

const overlaps = (ring: Point[], region: Region) =>
  ring.some(([x, y]) => x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1);

// Fills one row of a polygon: the cells whose centres fall between pairs of edge crossings.
function fillRow(mask: FootprintMask, ring: Point[], row: number) {
  const y = mask.region.y0 + (row + 0.5) * mask.cellMeters;
  const crossings: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y) crossings.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
  }
  crossings.sort((a, b) => a - b);
  for (let k = 0; k + 1 < crossings.length; k += 2) {
    const c0 = Math.max(0, Math.ceil((crossings[k] - mask.region.x0) / mask.cellMeters - 0.5));
    const c1 = Math.min(mask.width - 1, Math.floor((crossings[k + 1] - mask.region.x0) / mask.cellMeters - 0.5));
    mask.cells.fill(255, row * mask.width + c0, row * mask.width + c1 + 1);
  }
}

// Small sheds and houses narrower than a cell still mark the cell under their centre, so a house
// never disappears from the mask at a coarse scale.
function markCentre(mask: FootprintMask, [x, y]: Point) {
  const col = Math.floor((x - mask.region.x0) / mask.cellMeters);
  const row = Math.floor((y - mask.region.y0) / mask.cellMeters);
  if (col >= 0 && row >= 0 && col < mask.width && row < mask.height) mask.cells[row * mask.width + col] = 255;
}

export function footprintMask(buildings: Building[], region: Region, mostCells = MOST_MASK_CELLS): FootprintMask {
  const { cellMeters, width, height } = maskShape(region, mostCells);
  const mask: FootprintMask = { cells: new Uint8Array(width * height), width, height, region, cellMeters };
  for (const building of buildings) {
    if (!overlaps(building.ring, region)) continue;
    const ys = building.ring.map((point) => point[1]);
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - region.y0) / cellMeters));
    const r1 = Math.min(height - 1, Math.ceil((Math.max(...ys) - region.y0) / cellMeters));
    for (let row = r0; row <= r1; row++) fillRow(mask, building.ring, row);
    markCentre(mask, building.center);
  }
  return mask;
}
