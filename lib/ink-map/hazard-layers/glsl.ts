// GLSL a hazard layer's fullscreen pass can paste in. Each block declares the uniforms it reads;
// they are all in HazardLayerContext.shared except the arrival and terrain ones, which a layer sets
// from arrivalTexture() and context.terrain.

// The map point under a pixel. Map y is north; the scene's z is south.
export const GBUFFER_GLSL = `
uniform sampler2D tDepth;
uniform sampler2D tShade;
uniform sampler2D tId;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform float uBaseElevation;

const float SURFACE_TERRAIN = 0.0;
const float SURFACE_WALL = 1.0;
const float SURFACE_ROOF = 2.0;
const float SURFACE_ROAD = 3.0;
const float SURFACE_TREE = 4.0;
const float SURFACE_WATER_AREA = 13.0;

vec3 worldPosition(vec2 uv, float depth) {
  vec4 v = uInvProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return (uCameraWorld * vec4(v.xyz / v.w, 1.0)).xyz;
}

bool isSky(vec2 uv) {
  return texture(tDepth, uv).r >= 1.0;
}

// Map metres east and north of the city's origin.
vec2 mapPoint(vec2 uv) {
  vec3 w = worldPosition(uv, texture(tDepth, uv).r);
  return vec2(w.x, -w.z);
}

// Absolute elevation of the drawn surface at a pixel (a roof's top, the ground, a tree's crown), in metres.
float surfaceElevation(vec2 uv) {
  return worldPosition(uv, texture(tDepth, uv).r).y + uBaseElevation;
}

float surfaceAt(vec2 uv) {
  return floor(texture(tShade, uv).g * 255.0 + 0.5);
}

// -1 when the pixel isn't a building, else its index in data.buildings.
float buildingAt(vec2 uv) {
  vec3 c = texture(tId, uv).rgb * 255.0;
  float id = floor(c.r + 0.5) * 65536.0 + floor(c.g + 0.5) * 256.0 + floor(c.b + 0.5);
  return id > 999.5 && id < 99999.5 ? id - 1000.0 : -1.0;
}
`;

// The ground's absolute elevation under any map point, in metres, from context.terrain.
export const TERRAIN_GLSL = `
uniform sampler2D tTerrain;
uniform vec4 uTerrainRegion;

// Bilinear by hand: a 32-bit float texture can't be filtered on every GPU, and half floats are too
// coarse for a flood's centimetres.
float groundElevation(vec2 mapXY) {
  vec2 size = vec2(textureSize(tTerrain, 0));
  vec2 f = clamp((mapXY - uTerrainRegion.xy) / (uTerrainRegion.zw - uTerrainRegion.xy), 0.0, 1.0) * (size - 1.0);
  ivec2 i = ivec2(min(floor(f), size - 2.0));
  vec2 t = f - vec2(i);
  float a = texelFetch(tTerrain, i, 0).r;
  float b = texelFetch(tTerrain, i + ivec2(1, 0), 0).r;
  float c = texelFetch(tTerrain, i + ivec2(0, 1), 0).r;
  float d = texelFetch(tTerrain, i + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
`;

// The minute the hazard reaches a map point; 1e4 where it never does.
export const ARRIVAL_GLSL = `
uniform sampler2D tArrival;
uniform vec4 uArrivalRegion;
uniform float uArrivalLast;

float arrivalAt(vec2 mapXY) {
  vec2 uv = (mapXY - uArrivalRegion.xy) / (uArrivalRegion.zw - uArrivalRegion.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1e4;
  float m = texture(tArrival, uv).r;
  return m > uArrivalLast + 1.0 ? 1e4 : m;
}
`;

export const NOISE_GLSL = `
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

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += valueNoise(p) * amp;
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}
`;

// Hatching laid on the ground in fixed compass directions, so it foreshortens with the view like the
// composite's burn-scar crosshatch. `spacing` is in device pixels at the current zoom.
export const GROUND_HATCH_GLSL = `
uniform float uPatternScale;
uniform float uPixelRatio;

float groundHatch(vec2 mapXY, float spacing, float angle, float coverage) {
  vec2 p = mapXY * uPatternScale;
  float period = max(spacing, 3.0 * uPixelRatio) * 1.4142;
  float u = dot(p, vec2(cos(angle), sin(angle))) / period;
  float width = max(fwidth(u) * period, 1e-3);
  float f = abs(fract(u) - 0.5) * period;
  float halfWidth = coverage * period * 0.5;
  return 1.0 - smoothstep(halfWidth - width * 0.6, halfWidth + width * 0.6, f);
}
`;

export const FULLSCREEN_HEADER = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
`;
