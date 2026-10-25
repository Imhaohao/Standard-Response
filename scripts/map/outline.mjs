// Turns a grid of filled cells into polygons: one ring per connected patch, its holes joined to it
// by a zero-width cut so it stays a single ring. The cut's two edges lie on top of each other, so an
// even-odd fill (the land-use raster) and a non-zero fill (the flat map's SVG) both leave it unfilled.

// Each side of a cell: the neighbour across it, and the side's two corners in the order that keeps
// the cell on the left.
const SIDES = [
  { across: [0, -1], from: [0, 0], to: [1, 0] },
  { across: [1, 0], from: [1, 0], to: [1, 1] },
  { across: [0, 1], from: [1, 1], to: [0, 1] },
  { across: [-1, 0], from: [0, 1], to: [0, 0] },
];

// Every cell side between a filled cell and an empty one, directed so the filled cell is on its
// left: outer rings run counter-clockwise, holes clockwise. Vertices are lattice points c + r * (cols + 1).
function boundaryEdges(grid, mask) {
  const { cols, rows } = grid;
  const filled = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && mask[r * cols + c] === 1;
  const at = (c, r, [dc, dr]) => (r + dr) * (cols + 1) + c + dc;
  const edges = new Map();
  for (let cell = 0; cell < mask.length; cell++) {
    if (mask[cell] !== 1) continue;
    const [c, r] = [cell % cols, Math.floor(cell / cols)];
    for (const side of SIDES) {
      if (filled(c + side.across[0], r + side.across[1])) continue;
      const from = at(c, r, side.from);
      edges.set(from, [...(edges.get(from) ?? []), at(c, r, side.to)]);
    }
  }
  return edges;
}

// Follows edges into closed loops. Where two cells touch only at a corner, a vertex has two ways
// out; taking either keeps every loop closed.
function loops(edges, cols) {
  const point = (v) => [v % (cols + 1), Math.floor(v / (cols + 1))];
  const rings = [];
  for (const start of edges.keys()) {
    while (edges.get(start)?.length) {
      const ring = [];
      let v = start;
      do {
        ring.push(point(v));
        const outs = edges.get(v);
        const next = outs.pop();
        if (outs.length === 0) edges.delete(v);
        v = next;
      } while (v !== start);
      rings.push(ring);
    }
  }
  return rings;
}

function perpendicular([px, py], [ax, ay], [bx, by]) {
  const [dx, dy] = [bx - ax, by - ay];
  const length = Math.hypot(dx, dy);
  return length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((px - ax) * dy - (py - ay) * dx) / length;
}

// Douglas-Peucker on an open line, keeping both ends: the cell staircase along a coast becomes a few
// straight runs within `tolerance` cells of it.
function simplifyLine(points, tolerance) {
  if (points.length < 3) return points;
  let [index, far] = [0, 0];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], points[0], points[points.length - 1]);
    if (d > far) [index, far] = [i, d];
  }
  if (far <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplifyLine(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplifyLine(points.slice(index), tolerance)];
}

// A closed ring split at its first vertex and the vertex farthest from it, each half simplified.
function simplifyRing(ring, tolerance) {
  let far = 0;
  ring.forEach(([x, y], i) => {
    if (Math.hypot(x - ring[0][0], y - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i;
  });
  if (far === 0) return ring;
  const first = simplifyLine(ring.slice(0, far + 1), tolerance);
  const second = simplifyLine([...ring.slice(far), ring[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

const signedArea = (ring) => ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0) / 2;

function inside([x, y], ring) {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [[xi, yi], [xj, yj]] = [ring[i], ring[j]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

const nearestVertex = (ring, [x, y]) =>
  ring.reduce((best, [vx, vy], i) => (Math.hypot(vx - x, vy - y) < Math.hypot(ring[best][0] - x, ring[best][1] - y) ? i : best), 0);

// Splices a hole into its outer ring through the outer ring's vertex nearest the hole's first vertex.
function joinHole(outer, hole) {
  const at = nearestVertex(outer, hole[0]);
  return [...outer.slice(0, at + 1), ...hole, hole[0], ...outer.slice(at)];
}

// Patches of `mask` (1 = filled) on `grid`, as rings in grid units with their holes joined in.
export function outlineCells(grid, mask, tolerance = 0.7) {
  const rings = loops(boundaryEdges(grid, mask), grid.cols)
    .map((ring) => simplifyRing(ring, tolerance))
    .filter((ring) => ring.length >= 3);
  const outers = rings.filter((ring) => signedArea(ring) > 0).map((ring) => ({ ring, holes: [] }));
  for (const hole of rings.filter((ring) => signedArea(ring) < 0)) {
    const probe = [hole[0][0] + 0.25, hole[0][1] + 0.25];
    const owner = outers.find(({ ring }) => inside(hole[0], ring) || inside(probe, ring));
    owner?.holes.push(hole);
  }
  return outers.map(({ ring, holes }) => holes.reduce(joinHole, ring));
}
