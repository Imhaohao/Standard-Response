import * as THREE from "three";
import { InkMapData, terrainHeight } from "../../data";
import type { Barrier } from "./roads";
import { keepTargetAlpha, SCENE_DEPTH_GLSL } from "./streets";

// The barriers across closed streets: a striped board on two legs, standing upright across the
// street, never smaller than a few pixels so the overview can still read it. Each shows only while its
// street is shut, and once the snow is deep it wears a cap of it.

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
  float shown = popIn(uMinutes - aWindow.x) * (1.0 - step(aWindow.y, uMinutes));
  vec4 anchor = viewMatrix * vec4(aAt, 1.0);
  float metersPerPixel = -anchor.z * 2.0 / (projectionMatrix[1][1] * uResolution.y);
  float width = max(aWidth, 9.0 * uPixelRatio * metersPerPixel) * shown;
  vec3 across = vec3(aAcross.x, 0.0, -aAcross.y);
  vec3 world = aAt + across * position.x * width + vec3(0.0, position.y * width * 0.5, 0.0);
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
uniform float uDepth;

float box(vec2 p, vec2 lo, vec2 hi) {
  vec2 d = max(lo - p, p - hi);
  return max(d.x, d.y);
}

void main() {
  if (hiddenByTown(vViewDepth)) discard;
  // Card units: x across 0..1, y up 0..0.5.
  vec2 p = vec2(vUv.x, vUv.y * 0.5);
  float px = max(fwidth(p.x), 1e-4);
  float board = box(p, vec2(0.04, 0.2), vec2(0.96, 0.44));
  float legs = min(box(p, vec2(0.12, 0.0), vec2(0.19, 0.2)), box(p, vec2(0.81, 0.0), vec2(0.88, 0.2)));
  float capTop = 0.44 + clamp(uDepth * 0.14, 0.0, 0.06);
  float cap = uDepth > 0.08 ? box(p, vec2(0.02, 0.43), vec2(0.98, capTop)) : 1.0;
  float shape = min(min(board, legs), cap);
  if (shape > px * 0.5) discard;
  float stripes = step(0.5, fract((p.x + p.y) * 6.0));
  float frame = step(-px * 1.3, board);
  vec3 color = board < 0.0 ? mix(uPaper, uInk, max(stripes, frame)) : uInk;
  if (cap <= 0.0 && board > -px * 0.2) color = mix(uPaper, uInk, step(-px * 1.1, cap));
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
  barriers.forEach((barrier, i) => {
    const [x, y] = barrier.at;
    at.set([x, terrainHeight(data.terrain, x, y) + 0.3, -y], i * 3);
    across.set([-Math.sin(barrier.angle), Math.cos(barrier.angle)], i * 2);
    widths[i] = barrier.width;
    windows.set([finite(barrier.window.closedAt), finite(barrier.window.reopensAt)], i * 2);
  });
  geometry.setAttribute("aAt", new THREE.InstancedBufferAttribute(at, 3));
  geometry.setAttribute("aAcross", new THREE.InstancedBufferAttribute(across, 2));
  geometry.setAttribute("aWidth", new THREE.InstancedBufferAttribute(widths, 1));
  geometry.setAttribute("aWindow", new THREE.InstancedBufferAttribute(windows, 2));
  geometry.instanceCount = barriers.length;
  const material = keepTargetAlpha(
    new THREE.RawShaderMaterial({ vertexShader: CARD_VERTEX, fragmentShader: CARD_FRAGMENT, uniforms, glslVersion: THREE.GLSL3, side: THREE.DoubleSide }),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
