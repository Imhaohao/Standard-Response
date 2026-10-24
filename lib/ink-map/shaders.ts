// GLSL for the ink map. Pass 1 writes a G-buffer (shade, normal, object id); the composite pass turns it
// into ink lines and screentone on paper, then lays the fire on top.

export const SURFACE_GLSL = `
const float S_TERRAIN = 0.0;
const float S_WALL = 1.0;
const float S_ROOF = 2.0;
const float S_ROAD = 3.0;
const float S_TREE = 4.0;
const float S_LANDUSE = 10.0; // 10 + land-use kind + 1
`;

export const GBUFFER_VERTEX = `
precision highp float;
in vec3 position;
in vec3 normal;
in float surface;
#ifdef INSTANCED
in mat4 instanceMatrix;
in float instanceObjectId;
#else
in float objectId;
#endif
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
out vec3 vWorld;
out vec3 vNormal;
flat out float vSurface;
flat out float vId;
void main() {
  mat4 m = modelMatrix;
#ifdef INSTANCED
  m = m * instanceMatrix;
  vId = instanceObjectId;
#else
  vId = objectId;
#endif
  vec4 world = m * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(m) * normal);
  vSurface = surface;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const GBUFFER_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec3 vWorld;
in vec3 vNormal;
flat in float vSurface;
flat in float vId;
uniform vec3 uSun;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowTexel;
uniform float uShadowBias;
uniform sampler2D uLanduse;
uniform vec4 uLanduseRegion;
layout(location = 0) out vec4 gShade;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gId;

float shadowAt(vec3 world, float ndl) {
  vec4 clip = uShadowMatrix * vec4(world, 1.0);
  vec3 p = clip.xyz / clip.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) return 1.0;
  float bias = uShadowBias * (1.0 + 2.0 * (1.0 - ndl));
  float lit = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float d = texture(uShadowMap, p.xy + vec2(float(i), float(j)) * uShadowTexel).r;
      lit += p.z - bias <= d ? 1.0 : 0.0;
    }
  }
  return lit / 9.0;
}

vec3 encodeId(float id) {
  id = floor(id + 0.5);
  return vec3(floor(id / 65536.0), mod(floor(id / 256.0), 256.0), mod(id, 256.0)) / 255.0;
}

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float surface = vSurface;
  float id = vId;
  if (surface < 0.5) {
    vec2 mapXY = vec2(vWorld.x, -vWorld.z);
    vec2 uv = (mapXY - uLanduseRegion.xy) / (uLanduseRegion.zw - uLanduseRegion.xy);
    bool inside = uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0;
    float kind = inside ? floor(texture(uLanduse, uv).r * 255.0 + 0.5) : 0.0;
    if (kind > 0.5) {
      surface = 10.0 + kind;
      id = 10.0 + kind;
    }
  }
  float ndl = dot(n, uSun);
  float shade = max(ndl, 0.0) * shadowAt(vWorld, max(ndl, 0.0));
  gShade = vec4(shade, surface / 255.0, n.y * 0.5 + 0.5, 1.0);
  gNormal = vec4(n * 0.5 + 0.5, 1.0);
  gId = vec4(encodeId(id), 1.0);
}
`;

export const DEPTH_VERTEX = `
precision highp float;
in vec3 position;
#ifdef INSTANCED
in mat4 instanceMatrix;
#endif
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
void main() {
  mat4 m = modelMatrix;
#ifdef INSTANCED
  m = m * instanceMatrix;
#endif
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}
`;

export const DEPTH_FRAGMENT = `
precision highp float;
out vec4 color;
void main() { color = vec4(1.0); }
`;

export const FULLSCREEN_VERTEX = `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Shared by the fire mask pass and the composite: reconstructs map position from depth and looks up
// the scenario's arrival minute there.
const FIRE_COMMON = `
uniform sampler2D tDepth;
uniform sampler2D tFire;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec4 uFireRegion;
uniform float uFireNow;
uniform float uFireOn;
uniform float uFireLast;
uniform float uTime;

vec3 viewPosition(vec2 uv, float depth) {
  vec4 v = uInvProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}

vec3 worldPosition(vec2 uv, float depth) {
  return (uCameraWorld * vec4(viewPosition(uv, depth), 1.0)).xyz;
}

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

// Minutes after the warning when the scenario fire reaches this map point. 1e4 means never.
float arrivalMinutes(vec2 mapXY) {
  vec2 uv = (mapXY - uFireRegion.xy) / (uFireRegion.zw - uFireRegion.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1e4;
  float m = texture(tFire, uv).r;
  return m > uFireLast + 1.0 ? 1e4 : m;
}

// How strongly the burning front glows here, with a ragged, flickering edge.
float frontGlow(vec2 mapXY, float minutes) {
  float ragged = (fbm(mapXY * 0.012 + vec2(uTime * 0.05, -uTime * 0.04)) - 0.5) * 9.0;
  float behind = uFireNow - (minutes + ragged);
  float band = smoothstep(-1.5, 0.5, behind) * (1.0 - smoothstep(2.0, 11.0, behind));
  float flicker = 0.75 + 0.25 * sin(uTime * 7.0 + hash12(floor(mapXY / 9.0)) * 6.28);
  return band * flicker * uFireOn;
}
`;

export const FIRE_MASK_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 color;
${FIRE_COMMON}
void main() {
  float depth = texture(tDepth, vUv).r;
  if (depth >= 1.0) { color = vec4(0.0); return; }
  vec3 w = worldPosition(vUv, depth);
  vec2 mapXY = vec2(w.x, -w.z);
  float minutes = arrivalMinutes(mapXY);
  float glow = frontGlow(mapXY, minutes);
  float burned = (1.0 - smoothstep(uFireNow - 8.0, uFireNow, minutes)) * uFireOn;
  float embers = burned * step(0.985, hash12(floor(mapXY / 6.0) + floor(uTime * 2.0))) * 0.8;
  color = vec4(glow + embers, 0.0, 0.0, 1.0);
}
`;

export const BLUR_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 color;
uniform sampler2D tInput;
uniform vec2 uDirection;
void main() {
  float weights[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  float sum = texture(tInput, vUv).r * weights[0];
  for (int i = 1; i < 5; i++) {
    sum += texture(tInput, vUv + uDirection * float(i)).r * weights[i];
    sum += texture(tInput, vUv - uDirection * float(i)).r * weights[i];
  }
  color = vec4(sum, 0.0, 0.0, 1.0);
}
`;

export const COMPOSITE_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
${SURFACE_GLSL}
${FIRE_COMMON}
uniform sampler2D tShade;
uniform sampler2D tNormal;
uniform sampler2D tId;
uniform sampler2D tBloom;
uniform sampler2D tBuildingState;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uTanHalfFov;
uniform float uBaseElevation;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uPulse;
uniform float uDebug;

float decodeId(vec2 uv) {
  vec3 c = texture(tId, uv).rgb * 255.0;
  return floor(c.r + 0.5) * 65536.0 + floor(c.g + 0.5) * 256.0 + floor(c.b + 0.5);
}

float linearDepth(vec2 uv) {
  float d = texture(tDepth, uv).r;
  return d >= 1.0 ? 1e6 : -viewPosition(uv, d).z;
}

// Kind of object, for line weights: 0 sky, 1 terrain, 2 road, 3 land use, 4 building, 5 tree.
float idClass(float id) {
  if (id < 0.5) return 0.0;
  if (id < 1.5) return 1.0;
  if (id < 2.5) return 2.0;
  if (id < 999.5) return 3.0;
  if (id < 99999.5) return 4.0;
  return 5.0;
}

float edgeWeight(float classA, float classB, float metersPerPixel) {
  float hi = max(classA, classB);
  float lo = min(classA, classB);
  if (hi == 5.0 && lo == 5.0) return 0.55 * (1.0 - smoothstep(0.25, 0.6, metersPerPixel));
  if (hi == 5.0) return 0.9 * (1.0 - smoothstep(0.5, 1.3, metersPerPixel) * 0.7);
  if (hi == 4.0) return 1.0 - smoothstep(0.6, 1.6, metersPerPixel) * 0.45;
  if (hi == 2.0) return 0.85 * (1.0 - smoothstep(0.8, 2.0, metersPerPixel) * 0.55);
  if (hi == 3.0) return 0.6 * (1.0 - smoothstep(1.2, 3.0, metersPerPixel) * 0.6);
  return 0.9;
}

float inkLines(vec2 uv, float idC, float depthC, vec3 normalC, float metersPerPixel) {
  float widthPx = mix(max(1.0, uPixelRatio * 0.8), 1.0, smoothstep(0.45, 1.1, metersPerPixel));
  vec2 px = widthPx / uResolution;
  vec2 dirs[4] = vec2[](vec2(1.0, 0.0), vec2(-1.0, 0.0), vec2(0.0, 1.0), vec2(0.0, -1.0));
  float classC = idClass(idC);
  float line = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 uvN = uv + dirs[i] * px;
    float idN = decodeId(uvN);
    float depthN = linearDepth(uvN);
    bool inFront = depthC <= depthN * 1.0015;
    if (idN != idC) {
      if (inFront) line = max(line, edgeWeight(classC, idClass(idN), metersPerPixel));
      continue;
    }
    vec3 normalN = texture(tNormal, uvN).xyz * 2.0 - 1.0;
    bool creaseSide = i == 0 || i == 2;
    if (creaseSide && classC >= 4.0 && dot(normalC, normalN) < 0.82) {
      float crease = classC == 5.0 ? 0.0 : 0.85;
      line = max(line, crease * (1.0 - smoothstep(0.35, 0.95, metersPerPixel)));
    }
    if (inFront && depthN - depthC > depthC * 0.035 && classC == 1.0) line = max(line, 0.75);
  }
  return line;
}

const mat2 ROT45 = mat2(0.7071, -0.7071, 0.7071, 0.7071);

float screentone(float coverage, float cell) {
  if (coverage <= 0.001) return 0.0;
  vec2 p = ROT45 * gl_FragCoord.xy / cell;
  vec2 f = fract(p) - 0.5;
  float r = sqrt(coverage / 3.14159);
  float d = length(f);
  float aa = 0.75 / cell;
  return 1.0 - smoothstep(r - aa, r + aa, d);
}

float hatch(float coverage, float spacing, float angle) {
  if (coverage <= 0.001) return 0.0;
  float c = cos(angle);
  float s = sin(angle);
  float x = dot(gl_FragCoord.xy, vec2(c, s));
  float f = abs(fract(x / spacing) - 0.5) * spacing;
  float halfWidth = coverage * spacing * 0.5;
  return 1.0 - smoothstep(halfWidth - 0.6, halfWidth + 0.6, f);
}

// Three ink levels from the light, like hand-laid tone sheets.
float toneLevel(float shade, float light, float mid, float dark) {
  if (shade > 0.5) return light;
  if (shade > 0.18) return mid;
  return dark;
}

float stipple(vec2 mapXY, float density) {
  vec2 cell = floor(gl_FragCoord.xy / (2.0 * uPixelRatio));
  return step(1.0 - density, hash12(cell));
}

float landuseInk(float kind, float shade, vec2 mapXY, float cell) {
  float shadow = shade < 0.2 ? 0.26 : 0.0;
  if (kind == 1.0 || kind == 2.0 || kind == 7.0) return max(stipple(mapXY, 0.1), screentone(shadow, cell));
  if (kind == 3.0) return hatch(0.16, 3.2 * uPixelRatio, 0.0);
  if (kind == 4.0 || kind == 6.0) return screentone(max(0.1, shadow), cell);
  if (kind == 5.0) return screentone(max(0.04, shadow), cell);
  if (kind == 8.0) return max(screentone(0.07, cell), stipple(mapXY, 0.05));
  if (kind == 9.0) return max(stipple(mapXY, 0.12), screentone(shadow, cell));
  return screentone(max(0.05, shadow), cell);
}

float terrainInk(float shade, float up, vec3 w, float metersPerPixel, float cell) {
  float steep = 1.0 - up;
  float slopeHatch = hatch(clamp((steep - 0.12) * 1.6, 0.0, 0.55) * (1.0 - shade * 0.6), 3.0 * uPixelRatio, 0.35);
  float elevation = w.y + uBaseElevation;
  float interval = metersPerPixel > 3.0 ? 100.0 : 25.0;
  float e = elevation / interval;
  float contour = 1.0 - smoothstep(0.0, 1.0, abs(fract(e + 0.5) - 0.5) / max(fwidth(e), 1e-4));
  float yard = screentone(shade < 0.25 ? 0.26 : 0.045, cell);
  return max(max(yard, slopeHatch), contour * 0.35);
}

float surfaceInk(float surface, float shade, float up, vec3 w, float metersPerPixel, float cell) {
  vec2 mapXY = vec2(w.x, -w.z);
  if (surface == S_WALL) return screentone(toneLevel(shade, 0.0, 0.16, 0.34), cell);
  if (surface == S_ROOF) return screentone(toneLevel(shade, 0.03, 0.12, 0.3), cell);
  if (surface == S_ROAD) return screentone(shade < 0.25 ? 0.2 : 0.0, cell);
  if (surface == S_TREE) return screentone(toneLevel(shade, 0.0, 0.12, 0.34), cell);
  if (surface > S_LANDUSE) return landuseInk(surface - S_LANDUSE, shade, mapXY, cell);
  return terrainInk(shade, up, w, metersPerPixel, cell);
}

vec4 buildingState(float id) {
  if (id < 999.5 || id > 99999.5) return vec4(0.0);
  float index = id - 1000.0;
  ivec2 texel = ivec2(int(mod(index, 256.0)), int(floor(index / 256.0)));
  return texelFetch(tBuildingState, texel, 0);
}

vec3 heatShimmer(vec2 uv) {
  float depth = texture(tDepth, uv).r;
  if (depth >= 1.0 || uFireOn < 0.5) return vec3(uv, depth);
  vec3 w = worldPosition(uv, depth);
  float minutes = arrivalMinutes(vec2(w.x, -w.z));
  float near = 1.0 - smoothstep(0.0, 16.0, abs(minutes - uFireNow - 3.0));
  if (near <= 0.0) return vec3(uv, depth);
  vec2 wobble = vec2(valueNoise(uv * 90.0 + vec2(0.0, uTime * 2.2)), valueNoise(uv * 90.0 + vec2(5.2, uTime * 2.6))) - 0.5;
  vec2 shifted = uv + wobble * near * 2.6 * uPixelRatio / uResolution;
  return vec3(shifted, texture(tDepth, shifted).r);
}

void main() {
  vec3 shimmer = heatShimmer(vUv);
  vec2 uv = shimmer.xy;
  float depth = shimmer.z;
  float grain = (hash12(gl_FragCoord.xy) - 0.5) * 0.035;
  vec3 paper = uPaper + grain;
  float cell = 2.7 * uPixelRatio;

  if (depth >= 1.0) {
    fragColor = vec4(paper, 1.0);
    return;
  }

  vec4 g = texture(tShade, uv);
  if (uDebug > 0.5) {
    fragColor = vec4(uDebug < 1.5 ? vec3(g.r) : texture(tNormal, uv).xyz, 1.0);
    return;
  }
  float shade = g.r;
  float surface = floor(g.g * 255.0 + 0.5);
  float up = g.b * 2.0 - 1.0;
  vec3 normalC = texture(tNormal, uv).xyz * 2.0 - 1.0;
  float idC = decodeId(uv);
  float depthC = linearDepth(uv);
  float metersPerPixel = depthC * 2.0 * uTanHalfFov / uResolution.y;
  vec3 w = worldPosition(uv, depth);
  vec2 mapXY = vec2(w.x, -w.z);

  float lod = 1.0 - 0.7 * smoothstep(0.45, 1.5, metersPerPixel);
  float tone = surfaceInk(surface, shade, up, w, metersPerPixel, cell) * (surface == S_TERRAIN && up < 0.9 ? 1.0 : lod);
  float lines = inkLines(uv, idC, depthC, normalC, metersPerPixel);
  float ink = max(tone * 0.92, lines);
  vec3 color = mix(paper, uInk, ink);

  vec4 state = buildingState(idC);
  if (state.r > 0.0) {
    float wash = surface == S_ROOF ? 0.55 : 0.35;
    float pulse = state.g > 0.5 ? 0.75 + 0.25 * uPulse : 1.0;
    color = mix(color, mix(paper, uRed, 0.7), wash * state.r * pulse * (1.0 - lines));
    color = mix(color, uRed * 0.8, lines * state.r);
  }

  float minutes = arrivalMinutes(mapXY);
  float burned = (1.0 - smoothstep(uFireNow - 6.0, uFireNow, minutes)) * uFireOn;
  if (burned > 0.0) {
    float scorch = hatch(0.18, 4.0 * uPixelRatio, -0.75) * burned;
    float ember = smoothstep(0.55, 1.0, fbm(mapXY * 0.03 + uTime * 0.08)) * burned;
    color = mix(color, uInk, scorch * 0.45);
    color = mix(color, uRed, ember * 0.35 * (0.6 + 0.4 * sin(uTime * 2.0 + mapXY.x)));
  }
  float future = step(uFireNow, minutes) * step(minutes, uFireLast + 0.5) * uFireOn;
  float fm = minutes / 30.0;
  float iso = 1.0 - smoothstep(0.0, 1.3, abs(fract(fm + 0.5) - 0.5) / max(fwidth(fm), 1e-4));
  float dash = step(0.45, fract(dot(gl_FragCoord.xy, vec2(0.7071, 0.7071)) / (9.0 * uPixelRatio)));
  color = mix(color, uRed, iso * dash * future * 0.7);

  float glow = frontGlow(mapXY, minutes);
  color = mix(color, uEmber, clamp(glow, 0.0, 1.0) * 0.85);
  float bloom = texture(tBloom, vUv).r;
  color += uEmber * bloom * 0.9 + vec3(1.0, 0.85, 0.6) * smoothstep(0.7, 1.2, glow) * 0.35;
  fragColor = vec4(color, 1.0);
}
`;
