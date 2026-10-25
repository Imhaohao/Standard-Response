import * as THREE from "three";
import { InkMapData, terrainHeight } from "./data";
import type { FireField } from "./fire-field";

// Flames as objects standing in the town: rows of licking tongues along every burning edge,
// and a scatter of smaller ones over ground that burned in the last few minutes. They are real
// geometry, so they stand up from the hills, hide behind houses and look different from every
// angle. Each one is a flat card turned along the fire line, with the tongues drawn on it; the set is
// re-placed only when the fire's minute changes.

const MOST_FLAMES = 12000;
const FLAME_SPACING_METERS = 8;
const MOST_PER_CROSSING = 24;
const FLANK_SCALE = 0.65;
const HEAD_MINUTES = 6;
const STILL_BURNING_MINUTES = 15;
const INSIDE_SHARE = 0.12;

export const FLAME_VERTEX = `
precision highp float;
in vec3 position;
in vec2 uv;
in vec3 iOffset;
in vec2 iSize;
in float iPhase;
in float iAngle;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec2 vUv;
flat out float vPhase;
void main() {
  // The card lies along the fire line: its width runs in the line's direction on the map.
  vec2 along = vec2(cos(iAngle), sin(iAngle)) * position.x * iSize.x;
  vec3 world = iOffset + vec3(along.x, position.y * iSize.y, -along.y);
  vUv = uv;
  vPhase = iPhase;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

// The map's flame tongues, drawn on each card: the card is cut into columns, each a tongue whose
// height is noise that scrolls upward, so it licks and breaks apart instead of pulsing as one shape.
// A pixel is fire when it is under its column's height and inside the column's taper, hot at the
// root and red at the tip. Anything the town puts in front of a flame hides it.
export const FLAME_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
flat in float vPhase;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uTime;
out vec4 fragColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

const float COLUMNS = 3.0;
// The card is drawn in coarse pixels, a grid of these across and up, so the tongues come out
// blocky and stepped like the rest of the printed map rather than as smooth triangles.
const vec2 PIXELS = vec2(COLUMNS * 6.0, 18.0);
const float SHADES = 5.0;

void main() {
  float scene = texture(tDepth, gl_FragCoord.xy / uResolution).r;
  if (gl_FragCoord.z > scene + 2e-5) discard;
  vec2 cell = (floor(vUv * PIXELS) + 0.5) / PIXELS;
  float across = cell.x * COLUMNS;
  float column = floor(across) + vPhase * 97.0;
  float profile = 1.0 - abs(fract(across) - 0.5) * 2.0;
  float t = cell.y;
  float flicker = valueNoise(vec2(column * 1.7, uTime * 4.0 - t * 3.0)) * valueNoise(vec2(column * 0.31, uTime * 0.7));
  float height = 0.12 + 1.6 * flicker;
  float rise = t / max(height, 1e-3);
  if (rise > 1.0 || rise > profile) discard;
  float f = ceil((1.0 - rise) * SHADES) / SHADES;
  vec3 hot = vec3(1.0, 0.9, 0.62);
  vec3 color = f < 0.7 ? mix(uRed, uEmber, f / 0.7) : mix(uEmber, hot, (f - 0.7) / 0.3);
  fragColor = vec4(color, 1.0);
}
`;

// One upright card a metre wide and a metre tall, standing on its bottom edge. Each instance turns
// it to run along the fire line, so the row of tongues reads as the line of fire itself.
function flameCard() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  return geometry;
}

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// `angle` is the direction the card runs on the map, in radians from east.
type Flame = { x: number; y: number; width: number; height: number; phase: number; angle: number };

type Grid = { field: FireField; cellX: number; cellY: number; minutes: number };

const centre = (grid: Grid, col: number, row: number) => [grid.field.region.x0 + (col + 0.5) * grid.cellX, grid.field.region.y0 + (row + 0.5) * grid.cellY];

// The arrival minute anywhere in the field, blended between the four nearest cells.
function sampleField(grid: Grid, x: number, y: number) {
  const { field } = grid;
  const u = Math.min(field.width - 1.001, Math.max(0, (x - field.region.x0) / grid.cellX - 0.5));
  const v = Math.min(field.height - 1.001, Math.max(0, (y - field.region.y0) / grid.cellY - 0.5));
  const [c, r] = [Math.floor(u), Math.floor(v)];
  const [fu, fv] = [u - c, v - r];
  const at = (cc: number, rr: number) => field.minutes[rr * field.width + cc];
  return (at(c, r) * (1 - fu) + at(c + 1, r) * fu) * (1 - fv) + (at(c, r + 1) * (1 - fu) + at(c + 1, r + 1) * fu) * fv;
}

// The direction the fire line runs at a point: across the way arrival time changes fastest. Falls
// back to `fallback` where the field gives no clear slope (NaN, or flat).
function lineDirection(grid: Grid, x: number, y: number, fallback: [number, number]): [number, number] {
  const gx = sampleField(grid, x + grid.cellX, y) - sampleField(grid, x - grid.cellX, y);
  const gy = sampleField(grid, x, y + grid.cellY) - sampleField(grid, x, y - grid.cellY);
  const length = Math.hypot(gx, gy);
  return Number.isFinite(length) && length > 1e-6 ? [-gy / length, gx / length] : fallback;
}

// A row of tongues standing on the edge where it crosses from a burned cell to an unburned
// neighbour, at the point the arrival minute passes the clock. Each card is turned along the fire
// line there, and the row is spread along it, so the line of fire is continuous and the flames
// face out of it however the line runs across the grid.
function flamesOnCrossing(grid: Grid, from: [number, number], to: [number, number], seed: number): Flame[] {
  const { field, minutes } = grid;
  const a = field.minutes[from[1] * field.width + from[0]];
  const b = field.minutes[to[1] * field.width + to[0]];
  const crossing = (minutes - a) / Math.max(1e-3, b - a);
  const t = Number.isFinite(crossing) ? Math.min(1, Math.max(0, crossing)) : 0.5;
  const [ax, ay] = centre(grid, ...from);
  const [bx, by] = centre(grid, ...to);
  const [dx, dy] = [bx - ax, by - ay];
  const length = Math.hypot(dx, dy);
  const [x, y] = [ax + dx * t, ay + dy * t];
  const [tx, ty] = lineDirection(grid, x, y, [-dy / length, dx / length]);
  const count = Math.min(MOST_PER_CROSSING, Math.ceil(length / FLAME_SPACING_METERS));
  const scale = minutes - a < HEAD_MINUTES ? 1 : FLANK_SCALE;
  return Array.from({ length: count }, (_, k) => {
    const s = seed + k * 1.91;
    const along = ((k + hash(s)) / count - 0.5) * length;
    return {
      x: x + tx * along,
      y: y + ty * along,
      width: (8 + hash(s + 1) * 4) * scale,
      height: (16 + hash(s + 2) * 14) * scale,
      phase: hash(s + 3),
      angle: Math.atan2(ty, tx),
    };
  });
}

// A low tongue now and then over ground the fire crossed in the last quarter hour.
function flameInside(grid: Grid, col: number, row: number, index: number): Flame[] {
  const since = grid.minutes - grid.field.minutes[index];
  if (since < 0 || since > STILL_BURNING_MINUTES || hash(index * 3.7) > INSIDE_SHARE) return [];
  const [x, y] = centre(grid, col, row);
  const seed = index * 7.13;
  return [{ x: x + (hash(seed) - 0.5) * grid.cellX, y: y + (hash(seed + 0.5) - 0.5) * grid.cellY, width: 4 + hash(seed + 1) * 2, height: 6 + hash(seed + 2) * 5, phase: hash(seed + 3), angle: hash(seed + 4) * Math.PI }];
}

const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function flamesInCell(grid: Grid, col: number, row: number): Flame[] {
  const { field, minutes } = grid;
  const index = row * field.width + col;
  // Written as "not at or before" so a cell with no arrival time (NaN) counts as never reached.
  if (!(field.minutes[index] <= minutes)) return [];
  const flames = flameInside(grid, col, row, index);
  NEIGHBOURS.forEach(([dc, dr], side) => {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= field.width || r >= field.height || field.minutes[r * field.width + c] <= minutes) return;
    flames.push(...flamesOnCrossing(grid, [col, row], [c, r], index * 5.3 + side));
  });
  return flames;
}

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

// Every flame over the map's own ground; past the most the GPU should draw, an even thinning.
function flamesAt(field: FireField, minutes: number, bounds: Bounds): Flame[] {
  const grid = { field, minutes, cellX: (field.region.x1 - field.region.x0) / field.width, cellY: (field.region.y1 - field.region.y0) / field.height };
  const flames: Flame[] = [];
  for (let row = 0; row < field.height; row++) {
    for (let col = 0; col < field.width; col++) flames.push(...flamesInCell(grid, col, row));
  }
  const onMap = flames.filter((flame) => flame.x >= bounds.x0 && flame.x <= bounds.x1 && flame.y >= bounds.y0 && flame.y <= bounds.y1);
  const step = Math.max(1, onMap.length / MOST_FLAMES);
  return step === 1 ? onMap : Array.from({ length: Math.floor(onMap.length / step) }, (_, i) => onMap[Math.floor(i * step)]);
}

export class FlameField {
  readonly scene = new THREE.Scene();
  readonly uniforms: Record<string, THREE.IUniform>;
  private geometry = flameCard();
  private offsets = new THREE.InstancedBufferAttribute(new Float32Array(MOST_FLAMES * 3), 3);
  private sizes = new THREE.InstancedBufferAttribute(new Float32Array(MOST_FLAMES * 2), 2);
  private phases = new THREE.InstancedBufferAttribute(new Float32Array(MOST_FLAMES), 1);
  private angles = new THREE.InstancedBufferAttribute(new Float32Array(MOST_FLAMES), 1);
  private material: THREE.RawShaderMaterial;
  private mesh: THREE.Mesh;

  constructor(
    private data: InkMapData,
    private bounds: Bounds,
    shared: Record<string, THREE.IUniform>,
  ) {
    this.uniforms = {
      tDepth: shared.tDepth,
      uResolution: shared.uResolution,
      uRed: shared.uRed,
      uEmber: shared.uEmber,
      uTime: shared.uTime,
    };
    for (const attribute of [this.offsets, this.sizes, this.phases, this.angles]) attribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("iOffset", this.offsets);
    this.geometry.setAttribute("iSize", this.sizes);
    this.geometry.setAttribute("iPhase", this.phases);
    this.geometry.setAttribute("iAngle", this.angles);
    this.geometry.instanceCount = 0;
    this.material = new THREE.RawShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: this.uniforms,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  get count() {
    return this.geometry.instanceCount;
  }

  place(field: FireField | null, minutes: number) {
    const flames = field ? flamesAt(field, minutes, this.bounds) : [];
    flames.forEach((flame, i) => {
      this.offsets.setXYZ(i, flame.x, terrainHeight(this.data.terrain, flame.x, flame.y) - 0.5, -flame.y);
      this.sizes.setXY(i, flame.width, flame.height);
      this.phases.setX(i, flame.phase);
      this.angles.setX(i, flame.angle);
    });
    for (const attribute of [this.offsets, this.sizes, this.phases, this.angles]) attribute.needsUpdate = true;
    this.geometry.instanceCount = flames.length;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
