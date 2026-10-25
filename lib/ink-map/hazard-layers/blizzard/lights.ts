import * as THREE from "three";
import { BUILDING_KIND, InkMapData, type Building, terrainHeight } from "../../data";

// After dark every home with someone in it shows a small warm window on the side facing the camera,
// a point of light a couple of pixels across with a soft halo. Each home has a fixed place in line
// for losing power, so as the scenario's share of homes without power rises, the same windows go
// dark in the same order every time it plays. Houses hidden behind others are culled against the
// town's depth before they are drawn.

const MOST_LIGHTS = 80_000;
// Homes nobody has a lamp on in, even on a storm night.
const DARK_ANYWAY = 0.14;

export type Region = { x0: number; y0: number; x1: number; y1: number };

const lived = (building: Building) => building.kind === BUILDING_KIND.house || building.kind === BUILDING_KIND.apartments;
const within = (region: Region, [x, y]: [number, number]) => x >= region.x0 && x <= region.x1 && y >= region.y0 && y <= region.y1;

function footprintArea(ring: [number, number][]) {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(area) / 2;
}

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const LIGHT_VERTEX = `
precision highp float;
precision highp sampler2D;
in vec2 corner;
in vec4 aHome;
in vec4 aWindow;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uPowerOut;
uniform float uNight;
out vec2 vCorner;

float linear(float depth) {
  float z = depth * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vCorner = corner;
  bool lit = aWindow.y >= uPowerOut && aWindow.z >= ${DARK_ANYWAY.toFixed(2)} && uNight > 0.02;
  vec2 toCamera = normalize(cameraPosition.xz - aHome.xz + vec2(1e-4));
  vec3 window = vec3(aHome.x, aHome.y + aWindow.x, aHome.z) + vec3(toCamera.x, 0.0, toCamera.y) * (aHome.w + 0.4);
  vec4 clip = projectionMatrix * viewMatrix * vec4(window, 1.0);
  vec3 ndc = clip.xyz / clip.w;
  float scene = linear(textureLod(tDepth, ndc.xy * 0.5 + 0.5, 0.0).r);
  bool hidden = linear(ndc.z * 0.5 + 0.5) > scene + 2.0 + scene * 0.004;
  if (!lit || hidden || clip.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float radius = 5.0 * uPixelRatio;
  gl_Position = vec4(ndc.xy + corner * radius * 2.0 / uResolution, ndc.z, 1.0);
}
`;

const LIGHT_FRAGMENT = `
precision highp float;
in vec2 vCorner;
out vec4 fragColor;
uniform vec3 uLamp;
uniform float uNight;
uniform float uWhiteout;
void main() {
  float r = length(vCorner);
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.22, 0.32, r);
  float halo = exp(-r * r * 5.0) * 0.45;
  float strength = (core + halo) * uNight * (1.0 - 0.45 * uWhiteout);
  fragColor = vec4(uLamp * strength, 1.0);
}
`;

function quad() {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute("corner", new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
  return geometry;
}

export function windowLights(data: InkMapData, region: Region, uniforms: Record<string, THREE.IUniform>) {
  const homes = data.buildings.filter((building) => lived(building) && within(region, building.center)).slice(0, MOST_LIGHTS);
  const home = new Float32Array(homes.length * 4);
  const window = new Float32Array(homes.length * 4);
  homes.forEach((building, i) => {
    const [x, y] = building.center;
    const ground = terrainHeight(data.terrain, x, y);
    const half = Math.sqrt(footprintArea(building.ring)) / 2;
    const sill = building.kind === BUILDING_KIND.apartments ? building.walls * 0.5 : Math.min(building.walls * 0.55, 2.2);
    home.set([x, ground, -y, half], i * 4);
    window.set([sill, hash(building.id), hash(building.id + 0.5), 0], i * 4);
  });
  const geometry = quad();
  geometry.setAttribute("aHome", new THREE.InstancedBufferAttribute(home, 4));
  geometry.setAttribute("aWindow", new THREE.InstancedBufferAttribute(window, 4));
  geometry.instanceCount = homes.length;
  const material = new THREE.RawShaderMaterial({
    vertexShader: LIGHT_VERTEX,
    fragmentShader: LIGHT_FRAGMENT,
    uniforms,
    glslVersion: THREE.GLSL3,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
