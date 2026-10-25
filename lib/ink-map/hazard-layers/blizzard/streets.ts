import * as THREE from "three";
import { InkMapData, Point, ROAD_WIDTH, terrainHeight } from "../../data";
import { NOISE_GLSL } from "../glsl";
import { MOST_STREET_CLASS, type ClosureWindow } from "./roads";

// Every street the snow can bury, as a ribbon just above the town's own: while a street is open (or
// once it is ploughed) the ribbon draws the dark slush and tyre ruts of traffic between two white
// banks; when it closes, the ruts fill in over the next three quarters of an hour and the snow the
// cover pass laid over the street shows instead. Drawn into the cached map, so it never costs a frame.

const LIFT_METERS = 0.45;
const SAMPLE_METERS = 8;
// Never-closed and never-reopened stand in for infinity, which a vertex attribute can't carry everywhere.
const FAR_MINUTES = 1e9;

export type Region = { x0: number; y0: number; x1: number; y1: number };

const inside = (region: Region, [x, y]: Point, pad: number) => x >= region.x0 - pad && x <= region.x1 + pad && y >= region.y0 - pad && y <= region.y1 + pad;

function densify(path: Point[]) {
  const out: Point[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_METERS));
    for (let s = 1; s <= steps; s++) out.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  return out;
}

function sideNormal(path: Point[], i: number): Point {
  const a = path[Math.max(0, i - 1)];
  const b = path[Math.min(path.length - 1, i + 1)];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
}

const finite = (minutes: number) => (Number.isFinite(minutes) ? minutes : FAR_MINUTES);

class RibbonWriter {
  positions: number[] = [];
  streets: number[] = [];
  halves: number[] = [];
  indices: number[] = [];

  street(data: InkMapData, path: Point[], half: number, window: ClosureWindow) {
    const points = densify(path);
    let along = 0;
    points.forEach((point, i) => {
      if (i > 0) along += Math.hypot(point[0] - points[i - 1][0], point[1] - points[i - 1][1]);
      const [nx, ny] = sideNormal(points, i);
      const height = terrainHeight(data.terrain, point[0], point[1]) + LIFT_METERS;
      for (const side of [-1, 1]) {
        this.positions.push(point[0] + nx * half * side, height, -(point[1] + ny * half * side));
        this.streets.push(side, along, finite(window.closedAt), finite(window.reopensAt));
        this.halves.push(half);
      }
      if (i === 0) return;
      const base = this.positions.length / 3 - 4;
      this.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    });
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("aStreet", new THREE.Float32BufferAttribute(this.streets, 4));
    geometry.setAttribute("aHalf", new THREE.Float32BufferAttribute(this.halves, 1));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

export function streetRibbons(data: InkMapData, windows: ClosureWindow[], region: Region) {
  const writer = new RibbonWriter();
  data.roads.forEach((road, index) => {
    if (road.tunnel || road.roadClass > MOST_STREET_CLASS || road.path.length < 2) return;
    if (!road.path.some((point) => inside(region, point, 40))) return;
    writer.street(data, road.path, ROAD_WIDTH[road.roadClass] / 2, windows[index]);
  });
  return writer.build();
}

// Geometry drawn into the cached map has no depth buffer of its own, so it tests itself against the
// town's: anything nearer the camera than this fragment (a house, a tree) hides it.
export const SCENE_DEPTH_GLSL = `
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;

float sceneDistance() {
  float z = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

bool hiddenByTown(float viewDepth) {
  float scene = sceneDistance();
  return viewDepth > scene + 0.8 + scene * 0.0025;
}
`;

const STREET_VERTEX = `
precision highp float;
in vec3 position;
in vec4 aStreet;
in float aHalf;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec4 vStreet;
out float vHalf;
out float vViewDepth;
void main() {
  vec4 view = viewMatrix * vec4(position, 1.0);
  vStreet = aStreet;
  vHalf = aHalf;
  vViewDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const STREET_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec4 vStreet;
in float vHalf;
in float vViewDepth;
out vec4 fragColor;
${NOISE_GLSL}
${SCENE_DEPTH_GLSL}
uniform float uMinutes;
uniform float uDepth;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uInkStrength;

// Two tyre tracks a lane, wandering a little as cars do.
float ruts(float across, float along, float metersPerPixel) {
  float wander = (valueNoise(vec2(along * 0.07, 3.0)) - 0.5) * 0.5;
  float rut = 0.0;
  for (int i = 0; i < 4; i++) {
    float centre = (i < 2 ? -1.0 : 1.0) * (i == 0 || i == 3 ? 0.62 : 0.28) * vHalf;
    float d = abs(across - centre - wander);
    rut = max(rut, 1.0 - smoothstep(0.16, 0.16 + metersPerPixel, d));
  }
  return rut;
}

void main() {
  if (hiddenByTown(vViewDepth)) discard;
  float closed = step(vStreet.z, uMinutes) * (1.0 - step(vStreet.w, uMinutes));
  float traffic = mix(1.0, 1.0 - smoothstep(0.0, 45.0, uMinutes - vStreet.z), closed);
  float shown = traffic * smoothstep(0.008, 0.03, uDepth);
  if (shown < 0.01) discard;
  float a = vStreet.x;
  float w = max(fwidth(a), 1e-4);
  float metersPerPixel = w * vHalf;
  float fine = 1.0 - smoothstep(0.35, 0.8, metersPerPixel);
  float between = 1.0 - smoothstep(0.78 - w, 0.78 + w, abs(a));
  float bank = 1.0 - smoothstep(0.5, 1.5, abs(abs(a) - 0.8) / w);
  float detailed = max(max(ruts(a * vHalf, vStreet.y, metersPerPixel) * 0.85, 0.16 * between), bank * 0.55);
  float ink = mix(0.42 * between, detailed, fine);
  fragColor = vec4(mix(uPaper, uInk, ink * uInkStrength), shown * max(between, bank * fine));
}
`;

// Colour blends over the map; the map's alpha (the roofs' breathing) is left as it was.
export function keepTargetAlpha(material: THREE.Material) {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  return material;
}

export function streetMaterial(uniforms: Record<string, THREE.IUniform>) {
  return keepTargetAlpha(
    new THREE.RawShaderMaterial({ vertexShader: STREET_VERTEX, fragmentShader: STREET_FRAGMENT, uniforms, glslVersion: THREE.GLSL3, side: THREE.DoubleSide }),
  );
}
