import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { AREA_KIND, Building, InkMapData, MINOR_ROAD_CLASS, Point, ROAD_WIDTH, ROOF, Road, terrainHeight } from "./data";

// Surface codes the composite shader styles. Keep in sync with SURFACE in shaders.ts.
export const SURFACE = { terrain: 0, wall: 1, roof: 2, road: 3, tree: 4 } as const;

// Object ids drive the ink outlines: an outline appears wherever the id changes.
export const OBJECT_ID = { terrain: 1, road: 2, landuseBase: 10, building: 1_000, tree: 100_000 } as const;

export type Region = { x0: number; y0: number; x1: number; y1: number };

const inRegion = (region: Region, [x, y]: Point, pad = 0) =>
  x >= region.x0 - pad && x <= region.x1 + pad && y >= region.y0 - pad && y <= region.y1 + pad;

// Map space is meters east (x) and north (y). Three space is x east, y up, z south.
const worldZ = (north: number) => -north;

class GeometryWriter {
  positions: number[] = [];
  normals: number[] = [];
  surfaces: number[] = [];
  ids: number[] = [];

  triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, surface: number, id: number, normal?: THREE.Vector3) {
    const n = normal ?? new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const p of [a, b, c]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(n.x, n.y, n.z);
      this.surfaces.push(surface);
      this.ids.push(id);
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, surface: number, id: number) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    this.triangle(a, b, c, surface, id, n);
    this.triangle(a, c, d, surface, id, n);
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute("surface", new THREE.Float32BufferAttribute(this.surfaces, 1));
    geometry.setAttribute("objectId", new THREE.Float32BufferAttribute(this.ids, 1));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const v3 = (x: number, height: number, north: number) => new THREE.Vector3(x, height, worldZ(north));

// ---- Terrain ----

// Normals from the whole height grid, not from one chunk's triangles, so neighbouring chunks agree
// along their shared edge and no seam shows in the shading.
function terrainNormals(t: InkMapData["terrain"], c0: number, r0: number, cols: number, rows: number, stride: number) {
  const height = (c: number, r: number) => t.heights[Math.min(t.rows - 1, Math.max(0, r)) * t.cols + Math.min(t.cols - 1, Math.max(0, c))];
  const normals = new Float32Array(cols * rows * 3);
  const span = 2 * stride * t.cell;
  const normal = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tc = c0 + c * stride;
      const tr = r0 + r * stride;
      const east = (height(tc + stride, tr) - height(tc - stride, tr)) / span;
      const north = (height(tc, tr + stride) - height(tc, tr - stride)) / span;
      // The grid's triangles wind facing down, and the G-buffer flips the normal of any face seen
      // from behind, so the normal points down with the winding and comes out up on screen.
      normal.set(east, -1, -north).normalize().toArray(normals, (r * cols + c) * 3);
    }
  }
  return normals;
}

const TERRAIN_CHUNK_CELLS = 96;

// The terrain in square chunks, so the camera skips every chunk outside the view.
export function terrainChunks(data: InkMapData, region: Region, stride = 1) {
  const t = data.terrain;
  const x0 = Math.max(region.x0, t.x0);
  const y0 = Math.max(region.y0, t.y0);
  const x1 = Math.min(region.x1, t.x0 + (t.cols - 1) * t.cell);
  const y1 = Math.min(region.y1, t.y0 + (t.rows - 1) * t.cell);
  const size = TERRAIN_CHUNK_CELLS * t.cell;
  const chunks: THREE.BufferGeometry[] = [];
  for (let y = y0; y < y1; y += size) {
    for (let x = x0; x < x1; x += size) chunks.push(terrainGeometry(data, { x0: x, y0: y, x1: Math.min(x1, x + size), y1: Math.min(y1, y + size) }, stride));
  }
  return chunks;
}

export function terrainGeometry(data: InkMapData, region: Region, stride = 1) {
  const t = data.terrain;
  const c0 = Math.max(0, Math.floor((region.x0 - t.x0) / t.cell));
  const c1 = Math.min(t.cols - 1, Math.ceil((region.x1 - t.x0) / t.cell));
  const r0 = Math.max(0, Math.floor((region.y0 - t.y0) / t.cell));
  const r1 = Math.min(t.rows - 1, Math.ceil((region.y1 - t.y0) / t.cell));
  const cols = Math.floor((c1 - c0) / stride) + 1;
  const rows = Math.floor((r1 - r0) / stride) + 1;
  const positions = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tc = c0 + c * stride;
      const tr = r0 + r * stride;
      const i = (r * cols + c) * 3;
      positions[i] = t.x0 + tc * t.cell;
      positions[i + 1] = t.heights[tr * t.cols + tc];
      positions[i + 2] = worldZ(t.y0 + tr * t.cell);
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      indices.push(a, d, b, b, d, d + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(terrainNormals(t, c0, r0, cols, rows, stride), 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const count = cols * rows;
  geometry.setAttribute("surface", new THREE.BufferAttribute(new Float32Array(count).fill(SURFACE.terrain), 1));
  geometry.setAttribute("objectId", new THREE.BufferAttribute(new Float32Array(count).fill(OBJECT_ID.terrain), 1));
  return geometry;
}

// ---- Buildings ----

const OVERHANG = 0.35;

function baseAndTop(data: InkMapData, b: Building) {
  let low = Infinity;
  for (const [x, y] of b.ring) low = Math.min(low, terrainHeight(data.terrain, x, y));
  const ground = terrainHeight(data.terrain, b.center[0], b.center[1]);
  return { base: low - 0.4, top: ground + b.walls };
}

function walls(w: GeometryWriter, ring: Point[], base: number, top: number, id: number) {
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    w.quad(v3(ax, base, ay), v3(bx, base, by), v3(bx, top, by), v3(ax, top, ay), SURFACE.wall, id);
  }
}

function flatRoof(w: GeometryWriter, ring: Point[], top: number, id: number) {
  const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
  const up = new THREE.Vector3(0, 1, 0);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    w.triangle(v3(ring[a][0], top, ring[a][1]), v3(ring[c][0], top, ring[c][1]), v3(ring[b][0], top, ring[b][1]), SURFACE.roof, id, up);
  }
}

// The ring is an oriented rectangle (corners 0-3, counter-clockwise). The ridge runs along the long side.
function pitchedRoof(w: GeometryWriter, b: Building, top: number, id: number) {
  const ring = b.ring;
  const longFirst = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) >= Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]);
  const [c0, c1, c2, c3] = longFirst ? ring : [ring[1], ring[2], ring[3], ring[0]];
  const center: Point = [(c0[0] + c2[0]) / 2, (c0[1] + c2[1]) / 2];
  const grow = (p: Point): Point => {
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const length = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / length) * OVERHANG * 1.41, p[1] + (dy / length) * OVERHANG * 1.41];
  };
  const [e0, e1, e2, e3] = [c0, c1, c2, c3].map(grow);
  const longLength = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const shortLength = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const dir: Point = [(c1[0] - c0[0]) / longLength, (c1[1] - c0[1]) / longLength];
  const inset = b.roof === ROOF.hip ? Math.min(shortLength / 2, longLength / 2) : -OVERHANG;
  const mid03: Point = [(c3[0] + c0[0]) / 2 + dir[0] * inset, (c3[1] + c0[1]) / 2 + dir[1] * inset];
  const mid12: Point = [(c1[0] + c2[0]) / 2 - dir[0] * inset, (c1[1] + c2[1]) / 2 - dir[1] * inset];
  const ridge = top + b.rise;
  const eave = top - 0.15;
  const P = (p: Point, h: number) => v3(p[0], h, p[1]);
  w.quad(P(e0, eave), P(e1, eave), P(mid12, ridge), P(mid03, ridge), SURFACE.roof, id);
  w.quad(P(e2, eave), P(e3, eave), P(mid03, ridge), P(mid12, ridge), SURFACE.roof, id);
  if (b.roof === ROOF.hip) {
    w.triangle(P(e1, eave), P(e2, eave), P(mid12, ridge), SURFACE.roof, id);
    w.triangle(P(e3, eave), P(e0, eave), P(mid03, ridge), SURFACE.roof, id);
    return;
  }
  w.triangle(P(c1, top), P(c2, top), P(mid12, ridge), SURFACE.wall, id);
  w.triangle(P(c3, top), P(c0, top), P(mid03, ridge), SURFACE.wall, id);
}

export function buildingGeometry(data: InkMapData, region: Region) {
  const w = new GeometryWriter();
  for (const b of data.buildings) {
    if (!inRegion(region, b.center)) continue;
    const { base, top } = baseAndTop(data, b);
    const id = OBJECT_ID.building + b.id;
    walls(w, b.ring, base, top, id);
    if (b.roof === ROOF.flat) flatRoof(w, b.ring, top, id);
    else pitchedRoof(w, b, top, id);
  }
  return w.build();
}

// ---- Roads ----

const ROAD_LIFT = 0.3;
const MAX_SEGMENT = 8;

function densify(path: Point[]) {
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / MAX_SEGMENT));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  return out;
}

function sideNormal(path: Point[], i: number): Point {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

function roadCap(w: GeometryWriter, data: InkMapData, [x, y]: Point, radius: number, lift: number) {
  const h = terrainHeight(data.terrain, x, y) + lift;
  const up = new THREE.Vector3(0, 1, 0);
  const steps = 10;
  for (let s = 0; s < steps; s++) {
    const a0 = (s / steps) * Math.PI * 2;
    const a1 = ((s + 1) / steps) * Math.PI * 2;
    w.triangle(v3(x, h, y), v3(x + Math.cos(a1) * radius, h, y + Math.sin(a1) * radius), v3(x + Math.cos(a0) * radius, h, y + Math.sin(a0) * radius), SURFACE.road, OBJECT_ID.road, up);
  }
}

function roadRibbon(w: GeometryWriter, data: InkMapData, road: Road) {
  const path = densify(road.path);
  const half = ROAD_WIDTH[road.roadClass] / 2;
  const lift = ROAD_LIFT + (MINOR_ROAD_CLASS - Math.min(road.roadClass, MINOR_ROAD_CLASS)) * 0.02;
  const up = new THREE.Vector3(0, 1, 0);
  const edges = path.map((p, i) => {
    const [nx, ny] = sideNormal(path, i);
    const h = terrainHeight(data.terrain, p[0], p[1]) + lift;
    return { left: v3(p[0] + nx * half, h, p[1] + ny * half), right: v3(p[0] - nx * half, h, p[1] - ny * half) };
  });
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1];
    const b = edges[i];
    w.triangle(a.right, b.left, a.left, SURFACE.road, OBJECT_ID.road, up);
    w.triangle(a.right, b.right, b.left, SURFACE.road, OBJECT_ID.road, up);
  }
  roadCap(w, data, path[0], half, lift - 0.01);
  roadCap(w, data, path[path.length - 1], half, lift - 0.01);
}

export function roadGeometry(data: InkMapData, region: Region, maxClass: number) {
  const w = new GeometryWriter();
  for (const road of data.roads) {
    if (road.tunnel || road.roadClass > maxClass || road.path.length < 2) continue;
    if (!road.path.some((p) => inRegion(region, p, 40))) continue;
    roadRibbon(w, data, road);
  }
  return w.build();
}

// ---- Trees ----

// A tree is an ink blob. Shared vertices let the GPU shade each corner once instead of once per
// triangle; the plain icosahedron stands in where a tree is only a few pixels across.
function treeBlob(detail: 0 | 1) {
  const raw = new THREE.IcosahedronGeometry(1, detail);
  raw.deleteAttribute("normal");
  raw.deleteAttribute("uv");
  const blob = mergeVertices(raw);
  raw.dispose();
  blob.computeVertexNormals();
  blob.setAttribute("surface", new THREE.BufferAttribute(new Float32Array(blob.attributes.position.count).fill(SURFACE.tree), 1));
  return blob;
}

const TREE_TILE_METERS = 600;

type TreePlacement = { index: number; matrix: THREE.Matrix4 };

function placeTree(data: InkMapData, treeIndex: number): TreePlacement {
  const x = data.trees[treeIndex * 2];
  const y = data.trees[treeIndex * 2 + 1];
  const hash = Math.abs(Math.sin(treeIndex * 12.9898) * 43758.5453) % 1;
  const radius = 2.1 + hash * 2.6;
  const ground = terrainHeight(data.terrain, x, y);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash * 6.28);
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, ground + radius * 0.8 + 1.2, worldZ(y)), quaternion, new THREE.Vector3(radius, radius * 0.86, radius));
  return { index: treeIndex, matrix };
}

function instancedTrees(blob: THREE.BufferGeometry, material: THREE.Material, trees: TreePlacement[]) {
  const geometry = blob.clone();
  const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
  trees.forEach((tree, n) => mesh.setMatrixAt(n, tree.matrix));
  geometry.setAttribute("instanceObjectId", new THREE.InstancedBufferAttribute(new Float32Array(trees.map((tree) => OBJECT_ID.tree + tree.index)), 1));
  mesh.computeBoundingSphere();
  return mesh;
}

export type TreeTile = { near: THREE.InstancedMesh; far: THREE.InstancedMesh };

// Trees in square tiles, so the camera skips every tile outside the view, each tile in a detailed
// and a plain version (see TreeTile). All the trees in one mesh, plain, cast the shadows.
export function treeTiles(data: InkMapData, region: Region, material: THREE.Material, shadowMaterial: THREE.Material) {
  const tiles = new Map<string, TreePlacement[]>();
  const all: TreePlacement[] = [];
  for (let i = 0; i < data.trees.length; i += 2) {
    const point: Point = [data.trees[i], data.trees[i + 1]];
    if (!inRegion(region, point)) continue;
    const tree = placeTree(data, i / 2);
    const key = `${Math.floor(point[0] / TREE_TILE_METERS)},${Math.floor(point[1] / TREE_TILE_METERS)}`;
    const tile = tiles.get(key) ?? [];
    if (tile.length === 0) tiles.set(key, tile);
    tile.push(tree);
    all.push(tree);
  }
  const near = treeBlob(1);
  const far = treeBlob(0);
  const result = {
    tiles: [...tiles.values()].map((trees): TreeTile => ({ near: instancedTrees(near, material, trees), far: instancedTrees(far, material, trees) })),
    shadows: instancedTrees(far, shadowMaterial, all),
  };
  near.dispose();
  far.dispose();
  result.shadows.frustumCulled = false;
  return result;
}

// ---- Land use, rasterized for the terrain shader ----

export type LanduseTexture = { texture: THREE.DataTexture; region: Region };

// Scanline fill without antialiasing, so every texel holds exactly one land-use kind (0 = none).
function fillRing(pixels: Uint8Array, width: number, height: number, ring: Point[], region: Region, value: number) {
  const sx = width / (region.x1 - region.x0);
  const sy = height / (region.y1 - region.y0);
  const pts = ring.map(([x, y]) => [(x - region.x0) * sx, (y - region.y0) * sy]);
  const ys = pts.map((p) => p[1]);
  const yMin = Math.max(0, Math.floor(Math.min(...ys)));
  const yMax = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  for (let py = yMin; py <= yMax; py++) {
    const y = py + 0.5;
    const crossings: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y) crossings.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      // A span outside the texture gives to < from; on row 0 that end index would be negative,
      // which TypedArray.fill counts from the end of the array and floods the whole texture.
      if (to < from) continue;
      pixels.fill(value, py * width + from, py * width + to + 1);
    }
  }
}

// A land-use texel is one byte; 4096 square is 16 MB, enough for 1 m texels across a 4 km close-up.
const LANDUSE_MAX_SIZE = 4096;

export function landuseTexture(data: InkMapData, region: Region, pixelsPerMeter: number): LanduseTexture {
  const width = Math.min(LANDUSE_MAX_SIZE, Math.ceil((region.x1 - region.x0) * pixelsPerMeter));
  const height = Math.min(LANDUSE_MAX_SIZE, Math.ceil((region.y1 - region.y0) * pixelsPerMeter));
  const pixels = new Uint8Array(width * height);
  for (const area of data.areas) fillRing(pixels, width, height, area.ring, region, area.kind + 1);
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  // One byte per texel: rows are not 4-byte aligned, and WebGL's default alignment shears them.
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return { texture, region };
}

export const WILD_KIND = AREA_KIND.wild + 1;
