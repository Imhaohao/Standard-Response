import * as THREE from "three";

// The nearest falling snow: flakes as paper-white dots ringed in ink, in front of everything. They
// live in screen space (the camera never moves), and the GPU moves them: each flake's position is its
// seed plus how far the snow has travelled (uTravel, summed frame by frame so a change in the wind
// turns the fall instead of throwing every flake across the screen), wrapped round it. A
// layer holds a fixed set of flakes and draws the first share of them for how hard it is snowing, so
// the snow thickens without anything jumping. Fast flakes stretch along their fall, the way a
// shutter would catch them.

export type FlakeLayer = {
  count: number;
  // Radius in pixels on a 1080-pixel-tall screen, before each flake's own variation.
  size: number;
  // Fall speed in pixels per second on that screen.
  speed: number;
  outline: number;
  opacity: number;
  seed: number;
};

export const NEAR_FLAKES: FlakeLayer = { count: 260, size: 5.5, speed: 520, outline: 1.2, opacity: 0.95, seed: 1 };
export const MID_FLAKES: FlakeLayer = { count: 1400, size: 2.4, speed: 300, outline: 0.9, opacity: 0.85, seed: 2 };

const FLAKE_VERTEX = `
precision highp float;
in vec2 corner;
in vec4 aSeed;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSlant;
uniform float uSize;
uniform float uSpeed;
uniform float uGust;
uniform vec2 uTravel;
out vec2 vLocal;
out float vRadius;
out float vStretch;
void main() {
  float scale = uResolution.y / 1080.0;
  float radius = uSize * (0.55 + 0.9 * aSeed.z) * scale;
  vec2 fall = normalize(vec2(uSlant, -1.0));
  vec2 across = vec2(-fall.y, fall.x);
  float pace = uSpeed * (0.7 + 0.6 * aSeed.w) * scale;
  vec2 span = uResolution + vec2(radius * 12.0);
  vec2 sway = across * sin(uTime * (0.6 + aSeed.z) + aSeed.w * 6.2832) * radius * 1.6;
  vec2 centre = mod(aSeed.xy * span + uTravel * pace + sway, span) - radius * 6.0;
  float stretch = pace * uGust / 60.0 * 0.5;
  float pad = 1.5 * scale;
  vLocal = vec2(corner.x * (radius + pad), corner.y * (radius + stretch + pad));
  vRadius = radius;
  vStretch = stretch;
  vec2 pixel = centre + across * vLocal.x + fall * vLocal.y;
  gl_Position = vec4(pixel / uResolution * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FLAKE_FRAGMENT = `
precision highp float;
in vec2 vLocal;
in float vRadius;
in float vStretch;
out vec4 fragColor;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uOutline;
uniform float uOpacity;
uniform float uPixelRatio;
void main() {
  float d = length(vec2(vLocal.x, max(abs(vLocal.y) - vStretch, 0.0))) - vRadius;
  float outline = uOutline * uPixelRatio;
  float shape = 1.0 - smoothstep(-0.5, 0.5, d);
  if (shape <= 0.0) discard;
  float ring = smoothstep(-outline - 0.5, -outline + 0.5, d);
  vec3 color = mix(min(uPaper * 1.03, vec3(1.0)), uInk, ring * 0.9);
  fragColor = vec4(color, shape * uOpacity);
}
`;

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function flakeMesh(layer: FlakeLayer, shared: Record<string, THREE.IUniform>) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("corner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  const seeds = Float32Array.from({ length: layer.count * 4 }, (_, i) => hash(i + layer.seed * 1000));
  geometry.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = 0;
  const material = new THREE.RawShaderMaterial({
    vertexShader: FLAKE_VERTEX,
    fragmentShader: FLAKE_FRAGMENT,
    uniforms: {
      ...shared,
      uSize: { value: layer.size },
      uSpeed: { value: layer.speed },
      uOutline: { value: layer.outline },
      uOpacity: { value: layer.opacity },
    },
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, geometry, material, show: (snowfall: number) => (geometry.instanceCount = Math.round(layer.count * Math.min(1, Math.max(0, snowfall)))) };
}
