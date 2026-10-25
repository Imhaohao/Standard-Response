import * as THREE from "three";
import { InkMapData, Point, ROAD_WIDTH, terrainHeight } from "../../data";
import { NOISE_GLSL } from "../glsl";
import { MOST_STREET_CLASS, type ClosureWindow } from "./roads";

// Every street the snow can bury, as a ribbon just above the town's own. Once snow lies, an open (or
// ploughed) street is two dark tyre ruts on white, a single dark line when the street is only a pixel
// or two across. A street the scenario closes fills in over the hour and a half after it shuts and is
// then snow lying on the road: soft, broken curb lines and a wavy drift ridge across it every so often,
// only a faint ghost at the overview. The network thinning to a few dark lines is the town cut off.
// Drawn into the cached map, so it never costs a frame.

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
  sides: number[] = [];
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
        this.positions.push(point[0], height, -point[1]);
        this.sides.push(nx, -ny);
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
    geometry.setAttribute("aSide", new THREE.Float32BufferAttribute(this.sides, 2));
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
// town's: anything nearer the camera than this fragment (a house, a wall) hides it.
export const SCENE_DEPTH_GLSL = `
uniform sampler2D tDepth;
uniform sampler2D tShade;
uniform float uNear;
uniform float uFar;

float sceneDistance() {
  float z = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

// Tree crowns don't count: they fade under the snow, and a rut broken at every tree reads as dashes.
bool hiddenByTown(float viewDepth) {
  float surface = floor(texelFetch(tShade, ivec2(gl_FragCoord.xy), 0).g * 255.0 + 0.5);
  if (surface == 4.0) return false;
  float scene = sceneDistance();
  return viewDepth > scene + 0.8 + scene * 0.0004;
}
`;

// The centreline point moves out to its side by half the street's width, and never less than about
// a pixel, so a narrow street stays one unbroken line at the overview instead of breaking into dashes.
const STREET_VERTEX = `
precision highp float;
in vec3 position;
in vec2 aSide;
in vec4 aStreet;
in float aHalf;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uResolution;
out vec4 vStreet;
out float vHalf;
out float vViewDepth;
void main() {
  float centreDepth = -(viewMatrix * vec4(position, 1.0)).z;
  float metersPerPixel = centreDepth * 2.0 / (projectionMatrix[1][1] * uResolution.y);
  float halfWidth = max(aHalf, metersPerPixel * 1.1);
  vec4 view = viewMatrix * vec4(position + vec3(aSide.x, 0.0, aSide.y) * aStreet.x * halfWidth, 1.0);
  vStreet = aStreet;
  vHalf = halfWidth;
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

// Two tyre tracks, wandering a little as cars do.
float ruts(float across, float along, float metersPerPixel) {
  float wander = (valueNoise(vec2(along * 0.07, 3.0)) - 0.5) * 0.4;
  float rut = 0.0;
  for (int i = 0; i < 2; i++) {
    float d = abs(across - (i == 0 ? -0.38 : 0.38) * vHalf - wander);
    rut = max(rut, 1.0 - smoothstep(0.2, 0.2 + metersPerPixel, d));
  }
  return rut;
}

// Snow lying on a closed street: curbs softened to broken lines, and a drift ridge across the road
// every dozen metres or so, wavering and missing here and there.
float buriedRoad(float a, float along, float w, float metersPerPixel) {
  float curb = (1.0 - smoothstep(0.5, 1.5, abs(abs(a) - 0.9) / w)) * step(0.45, valueNoise(vec2(along * 0.12, sign(a) * 5.0)));
  float spacing = 13.0;
  float wave = sin(a * 2.4 + along * 0.05) * 1.2 + (valueNoise(vec2(a * 1.5, along * 0.1)) - 0.5) * 1.5;
  float u = (along + wave) / spacing;
  float kept = step(0.45, hash12(vec2(floor(u), 3.0)));
  float ridge = (1.0 - smoothstep(0.15, 0.15 + metersPerPixel, abs(fract(u) - 0.5) * spacing)) * kept * (1.0 - smoothstep(0.7, 0.9, abs(a)));
  return max(curb * 0.3, ridge * 0.45);
}

void main() {
  if (hiddenByTown(vViewDepth)) discard;
  float snowy = smoothstep(0.008, 0.03, uDepth);
  if (snowy < 0.01) discard;
  float closed = step(vStreet.z, uMinutes) * (1.0 - step(vStreet.w, uMinutes));
  float erased = closed * smoothstep(0.0, 90.0, uMinutes - vStreet.z);
  float a = vStreet.x;
  float w = max(fwidth(a), 1e-4);
  float metersPerPixel = w * vHalf;
  float fine = 1.0 - smoothstep(0.4, 0.9, metersPerPixel);
  float line = 1.0 - smoothstep(0.6 - w, 0.6 + w, abs(a));
  float open = mix(0.6 * line, 0.9 * ruts(a * vHalf, vStreet.y, metersPerPixel), fine);
  float buried = mix(0.1 * line, buriedRoad(a, vStreet.y, w, metersPerPixel), fine);
  float ink = mix(open, buried, erased);
  fragColor = vec4(mix(uPaper, uInk, ink * uInkStrength), snowy);
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
