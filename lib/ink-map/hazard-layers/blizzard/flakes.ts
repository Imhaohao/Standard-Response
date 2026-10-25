import * as THREE from "three";

// The nearest falling snow: soft round dots of snow white, each with a faint grey shadow a pixel
// below so it reads against white, the near ones slightly blurred. They live in screen space (the
// camera never moves), and the GPU moves them: each flake's position is its seed plus how far the snow
// has travelled (uTravel, summed frame by frame so a change in the wind turns the fall instead of
// throwing every flake across the screen), wrapped round it. A layer holds a fixed set of flakes and
// draws the first share of them for how hard it is snowing, so the snow thickens without anything
// jumping. Sizes follow the screen's short side, so a tall phone frame gets the same flakes as a wide one.

export type FlakeLayer = {
  count: number;
  // Radius in pixels on a screen whose short side is 1080, before each flake's own variation.
  size: number;
  // Fall speed in pixels per second on that screen.
  speed: number;
  // How soft the edge is, in pixels: the near flakes are slightly out of focus.
  softness: number;
  opacity: number;
  seed: number;
};

// A few hundred flakes on screen at the very worst: motion carries "snowing", so a still stays the town.
export const NEAR_FLAKES: FlakeLayer = { count: 60, size: 4.2, speed: 560, softness: 1.8, opacity: 0.95, seed: 1 };
export const MID_FLAKES: FlakeLayer = { count: 150, size: 2.6, speed: 330, softness: 0.9, opacity: 0.92, seed: 2 };
export const FAR_FLAKES: FlakeLayer = { count: 220, size: 1.6, speed: 190, softness: 0.6, opacity: 0.88, seed: 3 };

const FLAKE_VERTEX = `
precision highp float;
in vec2 corner;
in vec4 aSeed;
uniform vec2 uResolution;
uniform float uTime;
uniform float uSlant;
uniform float uSize;
uniform float uSpeed;
uniform float uSoftness;
uniform vec2 uTravel;
out vec2 vLocal;
out float vRadius;
out float vSoft;
out float vShadow;
void main() {
  float scale = min(uResolution.x, uResolution.y) / 1080.0;
  float radius = uSize * (0.4 + 1.2 * aSeed.z) * scale;
  vec2 fall = normalize(vec2(uSlant, -1.0));
  vec2 across = vec2(-fall.y, fall.x);
  float pace = uSpeed * (0.7 + 0.6 * aSeed.w) * scale;
  vec2 span = uResolution + vec2(radius * 12.0);
  vec2 sway = across * sin(uTime * (0.6 + aSeed.z) + aSeed.w * 6.2832) * radius * 1.6;
  vec2 centre = mod(aSeed.xy * span + uTravel * pace + sway, span) - radius * 6.0;
  vSoft = uSoftness * scale + 0.5;
  vShadow = max(1.0, scale);
  float extent = radius + vSoft + vShadow + 1.0;
  vLocal = corner * extent;
  vRadius = radius;
  gl_Position = vec4((centre + vLocal) / uResolution * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FLAKE_FRAGMENT = `
precision highp float;
in vec2 vLocal;
in float vRadius;
in float vSoft;
in float vShadow;
out vec4 fragColor;
uniform vec3 uSnow;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uOpacity;
void main() {
  float flake = 1.0 - smoothstep(vRadius - vSoft, vRadius + vSoft, length(vLocal));
  float shadow = (1.0 - smoothstep(vRadius - vSoft, vRadius + vSoft, length(vLocal + vec2(0.0, vShadow)))) * 0.3;
  float alpha = max(flake, shadow);
  if (alpha <= 0.002) discard;
  vec3 color = mix(mix(uPaper, uInk, 0.5), uSnow, flake / alpha);
  fragColor = vec4(color, alpha * uOpacity);
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
      uSoftness: { value: layer.softness },
      uOpacity: { value: layer.opacity },
    },
    glslVersion: THREE.GLSL3,
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, geometry, material, show: (snowfall: number) => (geometry.instanceCount = Math.round(layer.count * Math.min(1, Math.max(0, snowfall)))) };
}
