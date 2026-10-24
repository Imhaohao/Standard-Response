import type { Point } from "./data";
import type { FireField } from "./fire-field";

// How fast and which way the front moves, read off the arrival-time field. Arrival time T(x, y) rises
// in the direction the fire travels, and a front that covers d metres in dt minutes has |∇T| = dt/d,
// so the spread velocity is ∇T / |∇T|² metres a minute.

export type SpreadVector = { at: Point; direction: Point; metersPerMinute: number };

const DIFFERENCE_CELLS = 3;
const SAMPLE_STRIDE_CELLS = 3;

function cellSize(field: FireField) {
  return {
    dx: (field.region.x1 - field.region.x0) / field.width,
    dy: (field.region.y1 - field.region.y0) / field.height,
  };
}

const minutesAt = (field: FireField, col: number, row: number) =>
  field.minutes[Math.min(field.height - 1, Math.max(0, row)) * field.width + Math.min(field.width - 1, Math.max(0, col))];

function spreadAtCell(field: FireField, col: number, row: number): Omit<SpreadVector, "at"> | null {
  const { dx, dy } = cellSize(field);
  const k = DIFFERENCE_CELLS;
  const gx = (minutesAt(field, col + k, row) - minutesAt(field, col - k, row)) / (2 * k * dx);
  const gy = (minutesAt(field, col, row + k) - minutesAt(field, col, row - k)) / (2 * k * dy);
  const slope = Math.hypot(gx, gy);
  if (slope < 1e-6) return null;
  return { direction: [gx / slope, gy / slope], metersPerMinute: 1 / slope };
}

function cellCenter(field: FireField, col: number, row: number): Point {
  const { dx, dy } = cellSize(field);
  return [field.region.x0 + (col + 0.5) * dx, field.region.y0 + (row + 0.5) * dy];
}

function onFront(field: FireField, col: number, row: number, minutes: number) {
  const s = SAMPLE_STRIDE_CELLS;
  if (minutesAt(field, col, row) > minutes) return false;
  return [minutesAt(field, col + s, row), minutesAt(field, col - s, row), minutesAt(field, col, row + s), minutesAt(field, col, row - s)].some(
    (neighbour) => neighbour > minutes,
  );
}

function thinned(points: SpreadVector[], spacingMeters: number) {
  const kept: SpreadVector[] = [];
  for (const point of points) {
    if (kept.every(({ at }) => Math.hypot(at[0] - point.at[0], at[1] - point.at[1]) >= spacingMeters)) kept.push(point);
  }
  return kept;
}

// Spread vectors spaced along the front as it stands at `minutes` after the warning.
export function frontSpread(field: FireField, minutes: number, spacingMeters = 160): SpreadVector[] {
  const found: SpreadVector[] = [];
  for (let row = 0; row < field.height; row += SAMPLE_STRIDE_CELLS) {
    for (let col = 0; col < field.width; col += SAMPLE_STRIDE_CELLS) {
      if (!onFront(field, col, row, minutes)) continue;
      const spread = spreadAtCell(field, col, row);
      if (spread) found.push({ at: cellCenter(field, col, row), ...spread });
    }
  }
  return thinned(found, spacingMeters);
}

// Ground already burned by `minutes`, coarsely sampled, for hit-testing the pointer against the fire.
export function burnedPoints(field: FireField, minutes: number, strideCells = 4): Point[] {
  const points: Point[] = [];
  for (let row = 0; row < field.height; row += strideCells) {
    for (let col = 0; col < field.width; col += strideCells) {
      if (minutesAt(field, col, row) <= minutes) points.push(cellCenter(field, col, row));
    }
  }
  return points;
}
