import * as THREE from "three";
import { InkMapData, terrainHeight } from "../../data";
import type { Barrier } from "./roads";
import { keepTargetAlpha, SCENE_DEPTH_GLSL } from "./streets";

// The barriers across closed streets where they meet an open one: one small hatched bar on two stubs,
// standing across the closed street's mouth, springing up when the closed street shuts or the other
// reopens (barrierStands in roads.ts). They belong to the close-ups; at the overview the erased
// streets say it, so the bars fade out as the view pulls back.

const FAR_MINUTES = 1e9;
const finite = (minutes: number) => (Number.isFinite(minutes) ? minutes : FAR_MINUTES);

const CARD_VERTEX = `
precision highp float;
in vec3 position;
in vec2 uv;
in vec3 aAt;
in vec2 aAcross;
in float aWidth;
in vec2 aWindow;
in vec2 aCrossing;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uMinutes;
out vec2 vUv;
out float vViewDepth;
// A barrier springs up over the four minutes after its street closes, overshooting a little.
float popIn(float since) {
  float t = clamp(since / 4.0, 0.0, 1.0) - 1.0;
  return step(0.0, since) * (1.0 + 2.70158 * t * t * t + 1.70158 * t * t);
}

void main() {
  vec4 anchor = viewMatrix * vec4(aAt, 1.0);
  float metersPerPixel = -anchor.z * 2.0 / (projectionMatrix[1][1] * uResolution.y);
  float closeUp = 1.0 - smoothstep(0.9, 1.4, metersPerPixel);
  float crossingOpen = 1.0 - step(aCrossing.x, uMinutes) * (1.0 - step(aCrossing.y, uMinutes));
  float crossingReopened = aCrossing.y <= uMinutes ? aCrossing.y : -1e9;
  float since = uMinutes - max(aWindow.x, crossingReopened);
  float shown = popIn(since) * (1.0 - step(aWindow.y, uMinutes)) * step(aWindow.x, uMinutes) * crossingOpen * closeUp;
  float width = max(aWidth, 10.0 * uPixelRatio * metersPerPixel) * shown;
  vec3 across = vec3(aAcross.x, 0.0, -aAcross.y);
  vec3 world = aAt + across * position.x * width + vec3(0.0, position.y * width * 0.32, 0.0);
  vec4 view = viewMatrix * vec4(world, 1.0);
  vUv = uv;
  vViewDepth = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

const CARD_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in float vViewDepth;
out vec4 fragColor;
${SCENE_DEPTH_GLSL}
uniform vec3 uPaper;
uniform vec3 uInk;

float box(vec2 p, vec2 lo, vec2 hi) {
  vec2 d = max(lo - p, p - hi);
  return max(d.x, d.y);
}

void main() {
  if (hiddenByTown(vViewDepth)) discard;
  // Card units: x across 0..1, y up 0..0.32.
  vec2 p = vec2(vUv.x, vUv.y * 0.32);
  float px = max(fwidth(p.x), 1e-4);
  float bar = box(p, vec2(0.02, 0.09), vec2(0.98, 0.31));
  float stubs = min(box(p, vec2(0.14, 0.0), vec2(0.2, 0.09)), box(p, vec2(0.8, 0.0), vec2(0.86, 0.09)));
  if (min(bar, stubs) > px * 0.5) discard;
  float stripes = step(0.55, fract((p.x + p.y) * 5.0));
  float frame = step(-px * 0.9, bar);
  vec3 color = bar < 0.0 ? mix(uPaper, uInk, max(stripes, frame) * 0.9) : uInk;
  fragColor = vec4(color, 1.0);
}
`;

function card() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  return geometry;
}

export function barrierCards(data: InkMapData, barriers: Barrier[], uniforms: Record<string, THREE.IUniform>) {
  const geometry = card();
  const at = new Float32Array(barriers.length * 3);
  const across = new Float32Array(barriers.length * 2);
  const widths = new Float32Array(barriers.length);
  const windows = new Float32Array(barriers.length * 2);
  const crossings = new Float32Array(barriers.length * 2);
  barriers.forEach((barrier, i) => {
    const [x, y] = barrier.at;
    at.set([x, terrainHeight(data.terrain, x, y) + 0.3, -y], i * 3);
    across.set([-Math.sin(barrier.angle), Math.cos(barrier.angle)], i * 2);
    widths[i] = barrier.width;
    windows.set([finite(barrier.window.closedAt), finite(barrier.window.reopensAt)], i * 2);
    crossings.set([finite(barrier.crossing.closedAt), finite(barrier.crossing.reopensAt)], i * 2);
  });
  geometry.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 3));
  geometry.setAttribute("aAcross", new THREE.InstancedBufferAttribute(across, 2));
  geometry.setAttribute("aWidth", new THREE.InstancedBufferAttribute(widths, 1));
  geometry.setAttribute("aWindow", new THREE.InstancedBufferAttribute(windows, 2));
  geometry.setAttribute("aCrossing", new THREE.InstancedBufferAttribute(crossings, 2));
  geometry.instanceCount = barriers.length;
  const material = keepTargetAlpha(
    new THREE.RawShaderMaterial({ vertexShader: CARD_VERTEX, fragmentShader: CARD_FRAGMENT, uniforms, glslVersion: THREE.GLSL3, side: THREE.DoubleSide }),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
