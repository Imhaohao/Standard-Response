import type { Point } from "./data";

// Closed outlines where a gridded value crosses a level (marching squares). The flat map uses it to
// draw the fire's edge at the exact minute on the clock, from the same arrival times the 3D map
// shades, instead of stepping between the scenario's half-hourly fronts.

export type Grid = {
  values: ArrayLike<number>;
  width: number;
  height: number;
  // Map position of cell (col, row)'s centre.
  at: (col: number, row: number) => Point;
};

const OUTSIDE = Number.POSITIVE_INFINITY;

// A value off the grid, or missing, counts as never reached, so every outline closes on itself.
function valueAt(grid: Grid, col: number, row: number) {
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) return OUTSIDE;
  const value = grid.values[row * grid.width + col];
  return Number.isFinite(value) ? value : OUTSIDE;
}

type Crossing = { key: string; point: Point };

// Where the level crosses the edge between two neighbouring cells, by linear interpolation.
function crossing(grid: Grid, level: number, a: [number, number], b: [number, number], key: string): Crossing {
  const va = valueAt(grid, ...a);
  const vb = valueAt(grid, ...b);
  const t = Number.isFinite(va) && Number.isFinite(vb) && vb !== va ? (level - va) / (vb - va) : 0.5;
  const pa = grid.at(...a);
  const pb = grid.at(...b);
  return { key, point: [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t] };
}

// The square of four cell centres with (col, row) at its lower left: which of its four sides the
// level crosses, paired into segments. Saddles split by the value at the square's middle.
function squareSegments(grid: Grid, level: number, col: number, row: number): [Crossing, Crossing][] {
  const inside = (c: number, r: number) => valueAt(grid, c, r) <= level;
  const corners = [inside(col, row), inside(col + 1, row), inside(col + 1, row + 1), inside(col, row + 1)];
  const sides: (() => Crossing)[] = [
    () => crossing(grid, level, [col, row], [col + 1, row], `h${col},${row}`),
    () => crossing(grid, level, [col + 1, row], [col + 1, row + 1], `v${col + 1},${row}`),
    () => crossing(grid, level, [col, row + 1], [col + 1, row + 1], `h${col},${row + 1}`),
    () => crossing(grid, level, [col, row], [col, row + 1], `v${col},${row}`),
  ];
  const cut = [0, 1, 2, 3].filter((side) => corners[side] !== corners[(side + 1) % 4]);
  if (cut.length === 2) return [[sides[cut[0]](), sides[cut[1]]()]];
  if (cut.length !== 4) return [];
  const middle = (valueAt(grid, col, row) + valueAt(grid, col + 1, row) + valueAt(grid, col + 1, row + 1) + valueAt(grid, col, row + 1)) / 4;
  const pairs: [number, number][] = (middle <= level) === corners[0] ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
  return pairs.map(([a, b]) => [sides[a](), sides[b]()]);
}

// Joins segments that share a crossing into rings.
function joinRings(segments: [Crossing, Crossing][]): Point[][] {
  const byKey = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const key of [a.key, b.key]) byKey.set(key, [...(byKey.get(key) ?? []), i]);
  });
  const used = new Set<number>();
  const rings: Point[][] = [];
  segments.forEach((first, start) => {
    if (used.has(start)) return;
    used.add(start);
    const ring: Point[] = [first[0].point, first[1].point];
    let key = first[1].key;
    for (let next = nextSegment(byKey, key, used); next !== undefined; next = nextSegment(byKey, key, used)) {
      used.add(next);
      const [a, b] = segments[next];
      const forward = a.key === key;
      ring.push(forward ? b.point : a.point);
      key = forward ? b.key : a.key;
    }
    rings.push(ring);
  });
  return rings;
}

const nextSegment = (byKey: Map<string, number[]>, key: string, used: Set<number>) => byKey.get(key)?.find((i) => !used.has(i));

export function isolines(grid: Grid, level: number): Point[][] {
  const segments: [Crossing, Crossing][] = [];
  for (let row = -1; row < grid.height; row++) {
    for (let col = -1; col < grid.width; col++) segments.push(...squareSegments(grid, level, col, row));
  }
  return joinRings(segments);
}
