import { Point, Terrain } from "./data";

export type Region = { x0: number; y0: number; x1: number; y1: number };

// Marching squares over the baked height field, so the flat map keeps the shape of the hills
// without the 3D mesh. Segments are unjoined; the flat map draws them as one path.
export function terrainContours(terrain: Terrain, interval: number, region: Region): Point[][] {
  const c0 = Math.max(0, Math.floor((region.x0 - terrain.x0) / terrain.cell));
  const c1 = Math.min(terrain.cols - 2, Math.ceil((region.x1 - terrain.x0) / terrain.cell));
  const r0 = Math.max(0, Math.floor((region.y0 - terrain.y0) / terrain.cell));
  const r1 = Math.min(terrain.rows - 2, Math.ceil((region.y1 - terrain.y0) / terrain.cell));
  const at = (c: number, r: number) => terrain.heights[r * terrain.cols + c];
  const x = (c: number) => terrain.x0 + c * terrain.cell;
  const y = (r: number) => terrain.y0 + r * terrain.cell;
  const segments: Point[][] = [];

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const corners = [at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)];
      const low = Math.min(...corners);
      const high = Math.max(...corners);
      const positions: Point[] = [
        [x(c), y(r)],
        [x(c + 1), y(r)],
        [x(c + 1), y(r + 1)],
        [x(c), y(r + 1)],
      ];
      for (let level = Math.ceil(low / interval) * interval; level < high; level += interval) {
        const crossings: Point[] = [];
        for (let i = 0; i < 4; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          if (a < level === b < level) continue;
          const t = (level - a) / (b - a);
          const [ax, ay] = positions[i];
          const [bx, by] = positions[(i + 1) % 4];
          crossings.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
        }
        for (let i = 0; i + 1 < crossings.length; i += 2) segments.push([crossings[i], crossings[i + 1]]);
      }
    }
  }
  return segments;
}
