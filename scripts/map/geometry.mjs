// Small 2D helpers for footprints and polylines, all in local meters.

export function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return sum / 2;
}

export function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(ring) {
  const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

// Drops the closing duplicate and any vertex closer than minGap to the one before it.
export function cleanRing(points, minGap = 0.3) {
  const ring = [];
  for (const p of points) {
    const last = ring[ring.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minGap) ring.push(p);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) < minGap) ring.pop();
  return ring;
}

export const counterClockwise = (ring) => (ringArea(ring) < 0 ? [...ring].reverse() : ring);

function hullCross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function convexHull(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && hullCross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

// Minimum-area oriented rectangle, by rotating calipers over the hull's edge directions.
export function orientedBox(ring) {
  const hull = convexHull(ring);
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const box = boxAlong(hull, angle);
    if (!best || box.area < best.area) best = box;
  }
  return best;
}

function boxAlong(points, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const [x, y] of points) {
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2;
  const cv = (minV + maxV) / 2;
  return {
    cx: cu * cos - cv * sin,
    cy: cu * sin + cv * cos,
    angle,
    halfU: (maxU - minU) / 2,
    halfV: (maxV - minV) / 2,
    area: (maxU - minU) * (maxV - minV),
  };
}

export function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Seeded random, so every bake places the same trees.
export function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A uniform grid of buckets for nearby-feature lookups.
export class SpatialGrid {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  key(cx, cy) {
    return `${cx},${cy}`;
  }

  insert(item, minX, minY, maxX, maxY) {
    const s = this.cellSize;
    for (let cx = Math.floor(minX / s); cx <= Math.floor(maxX / s); cx++) {
      for (let cy = Math.floor(minY / s); cy <= Math.floor(maxY / s); cy++) {
        const k = this.key(cx, cy);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(item);
      }
    }
  }

  near(x, y) {
    return this.cells.get(this.key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize))) ?? [];
  }
}
