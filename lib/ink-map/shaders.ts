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
  float band = smoothstep(-1.0, 0.3, behind) * (1.0 - smoothstep(0.8, 3.5, behind));
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
  float burned = (1.0 - smoothstep(uFireNow - 4.0, uFireNow, minutes)) * uFireOn;
  float embers = burned * step(0.985, hash12(floor(mapXY / 6.0) + floor(uTime * 2.0))) * 0.8;
  float fresh = burned * (1.0 - smoothstep(0.0, 70.0, uFireNow - minutes));
  color = vec4(glow + embers, fresh + glow * 0.5, 0.0, 1.0);
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
  vec2 sum = texture(tInput, vUv).rg * weights[0];
  for (int i = 1; i < 5; i++) {
    sum += texture(tInput, vUv + uDirection * float(i)).rg * weights[i];
    sum += texture(tInput, vUv - uDirection * float(i)).rg * weights[i];
  }
  color = vec4(sum, 0.0, 1.0);
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
uniform float uInkStrength;

float decodeId(vec2 uv) {
  vec3 c = texture(tId, uv).rgb * 255.0;
  return floor(c.r + 0.5) * 65536.0 + floor(c.g + 0.5) * 256.0 + floor(c.b + 0.5);
}

// The terrain mesh is a metre across, so its per-pixel normal carries every wrinkle of the source
// elevation. Read raw, the flats of Altadena look like a hillside and get hatched as one. This
// averages a few pixels out, which is the scale a hillside is actually steep at.
vec3 smoothNormal(vec2 uv) {
  vec2 px = 2.5 / uResolution;
  vec3 sum = texture(tNormal, uv).xyz;
  sum += texture(tNormal, uv + vec2(px.x, 0.0)).xyz;
  sum += texture(tNormal, uv - vec2(px.x, 0.0)).xyz;
  sum += texture(tNormal, uv + vec2(0.0, px.y)).xyz;
  sum += texture(tNormal, uv - vec2(0.0, px.y)).xyz;
  return normalize(sum / 5.0 * 2.0 - 1.0);
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

// How much of the fine drawing survives at this scale. A house is 12 m across, so past a few
// metres per pixel it is smaller than a pixel and its outline stops being an outline.
float detailAmount(float metersPerPixel) {
  return 1.0 - smoothstep(1.4, 4.5, metersPerPixel);
}

float edgeWeight(float classA, float classB, float metersPerPixel) {
  float hi = max(classA, classB);
  float lo = min(classA, classB);
  float detail = detailAmount(metersPerPixel);
  // A house is 12 m across. Once it is under a pixel there is no wall left to draw, and every wall
  // drawn anyway is a black speck: the town reads as confetti instead of as blocks of housing. So
  // the shared walls fade out entirely and the built-up area becomes a tone with a soft outline.
  if (hi == 4.0 && lo == 4.0) return 0.85 * detail;
  if (hi == 4.0) return mix(0.25, 1.0, detail);
  if (hi == 5.0 && lo == 5.0) return 0.55 * (1.0 - smoothstep(0.25, 0.6, metersPerPixel));
  if (hi == 5.0) return 0.9 * (1.0 - smoothstep(0.5, 1.3, metersPerPixel) * 0.7);
  if (hi == 2.0) return 0.85 * (1.0 - smoothstep(0.8, 2.0, metersPerPixel) * 0.4);
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

// A hatch line is thin, so it needs room. With a period close to the width of the antialiasing
// band every line smears into its neighbour and an 18% hatch comes out as a third of the paper.
float hatch(float coverage, float spacing, float angle) {
  if (coverage <= 0.001) return 0.0;
  float period = max(spacing, 3.0 * uPixelRatio);
  float c = cos(angle);
  float s = sin(angle);
  float x = dot(gl_FragCoord.xy, vec2(c, s));
  float f = abs(fract(x / period) - 0.5) * period;
  float halfWidth = clamp(coverage, 0.0, 0.9) * period * 0.5;
  float aa = max(0.55, halfWidth * 0.4);
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, f);
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
  if (kind == 3.0) return hatch(0.16, 6.0 * uPixelRatio, 0.0);
  if (kind == 4.0 || kind == 6.0) return screentone(max(0.1, shadow), cell);
  if (kind == 5.0) return screentone(max(0.04, shadow), cell);
  if (kind == 8.0) return max(screentone(0.07, cell), stipple(mapXY, 0.05));
  if (kind == 9.0) return max(stipple(mapXY, 0.12), screentone(shadow, cell));
  return screentone(max(0.05, shadow), cell);
}

float terrainInk(float shade, float up, vec3 w, float metersPerPixel, float cell) {
  float steep = 1.0 - up;
  float slopeHatch = hatch(clamp((steep - 0.16) * 1.2, 0.0, 0.32) * (1.0 - shade * 0.7), 6.5 * uPixelRatio, 0.35);
  float elevation = w.y + uBaseElevation;
  float interval = metersPerPixel > 3.0 ? 100.0 : 25.0;
  float e = elevation / interval;
  float contour = 1.0 - smoothstep(0.0, 1.0, abs(fract(e + 0.5) - 0.5) / max(fwidth(e), 1e-4));
  // The yard tone is a town-scale texture: it says "this is a settled block" when a house is one
  // pixel wide. Close up it is only dirt on the paper, so it fades out as the detail comes in.
  float yard = screentone(shade < 0.25 ? 0.16 : 0.0, cell) * smoothstep(0.8, 3.0, metersPerPixel);
  return max(max(yard, slopeHatch), contour * 0.35);
}

// Buildings at town scale are drawn as one flat tone rather than lit face by face, because there is
// no face left to light. The tone is what makes the built-up area read as a place. It shares the
// terrain's dot grid: a house is one pixel wide there, so two screens next to each other would read
// as noise rather than as two surfaces.
float buildingTone(float shade, float detail, float cell, float lit, float plain) {
  return mix(screentone(plain, cell), screentone(toneLevel(shade, lit * 0.5, lit, plain * 0.9), cell), detail);
}

float surfaceInk(float surface, float shade, float up, vec3 w, float metersPerPixel, float cell, float detail) {
  vec2 mapXY = vec2(w.x, -w.z);
  if (surface == S_WALL) return buildingTone(shade, detail, cell, 0.16, 0.12);
  if (surface == S_ROOF) return buildingTone(shade, detail, cell, 0.1, 0.08);
  if (surface == S_ROAD) return screentone(shade < 0.25 ? 0.2 : 0.0, cell) * detail;
  // A tree is 5 m across, so at town scale it is a fraction of a pixel and its canopy tone aliases
  // into a random dark speck. Fading the tone keeps the tree cover visible as a stipple.
  if (surface == S_TREE) return screentone(toneLevel(shade, 0.0, 0.12, 0.34) * mix(0.42, 1.0, detail), cell);
  if (surface > S_LANDUSE) return landuseInk(surface - S_LANDUSE, shade, mapXY, cell);
  return terrainInk(shade, up, w, metersPerPixel, cell);
}

vec4 buildingState(float id) {
  if (id < 999.5 || id > 99999.5) return vec4(0.0);
  float index = id - 1000.0;
  ivec2 texel = ivec2(int(mod(index, 256.0)), int(floor(index / 256.0)));
  return texelFetch(tBuildingState, texel, 0);
}

// Flame tongues standing up off the burning front, in screen space so they always rise up the page.
// The quarter-resolution glow mask says where the front is; noise columns give each tongue a height.
// Glow of the crisp front at another screen point, for rooting flames on the real fire line.
float frontAt(vec2 uv) {
  float depth = texture(tDepth, uv).r;
  if (depth >= 1.0) return 0.0;
  vec3 w = worldPosition(uv, depth);
  vec2 mapXY = vec2(w.x, -w.z);
  return frontGlow(mapXY, arrivalMinutes(mapXY));
}

float flameTongues(vec2 uv) {
  if (uFireOn < 0.5 || texture(tBloom, uv).r < 0.02) return 0.0;
  float tall = 64.0 * uPixelRatio / uResolution.y;
  float across = uv.x * uResolution.x / (8.0 * uPixelRatio);
  float column = floor(across);
  float profile = 1.0 - abs(fract(across) - 0.5) * 2.0;
  float flame = 0.0;
  for (int i = 1; i <= 10; i++) {
    float t = float(i) / 10.0;
    float base = frontAt(uv - vec2(0.0, t * tall));
    if (base < 0.25) continue;
    float flicker = valueNoise(vec2(column * 1.7, uTime * 4.0 - t * 3.0)) * valueNoise(vec2(column * 0.31, uTime * 0.7));
    float height = clamp(base, 0.0, 1.0) * (0.12 + 1.6 * flicker);
    float rise = t / max(height, 1e-3);
    flame = max(flame, step(rise, 1.0) * step(rise, profile) * (1.0 - rise));
  }
  return flame;
}

// A smoke plume rising from the front and bending downwind (the scenario wind blows toward the
// west-southwest, screen left). Drawn the manga way: halftone puffs with an ink outline.
vec2 smokePlume(vec2 uv) {
  if (uFireOn < 0.5) return vec2(0.0);
  float aspect = uResolution.x / uResolution.y;
  float density = 0.0;
  for (int i = 1; i <= 12; i++) {
    float t = float(i) / 12.0;
    vec2 source = uv - vec2(-0.16 * t * t / aspect, 0.42 * t);
    density += min(texture(tBloom, source).g, 1.0) * (1.0 - t * 0.7);
  }
  density = 1.0 - exp(-density * 0.3);
  vec2 q = vec2(uv.x * aspect, uv.y) * 13.0 + vec2(uTime * 0.04, -uTime * 0.12);
  float puff = density * (0.1 + 1.25 * fbm(q));
  float fill = smoothstep(0.4, 0.43, puff);
  float rim = fill * (1.0 - smoothstep(0.43, 0.5, puff));
  return vec2(fill, rim);
}

vec3 flameColor(float f) {
  vec3 hot = vec3(1.0, 0.9, 0.62);
  return f < 0.7 ? mix(uRed, uEmber, f / 0.7) : mix(uEmber, hot, (f - 0.7) / 0.3);
}

vec3 overlayFire(vec3 color, vec2 uv, float cell) {
  vec2 smoke = smokePlume(uv);
  float smokeTone = screentone(0.22 + smoke.x * 0.1, cell);
  vec3 smoky = mix(mix(color, uPaper * 0.97, 0.85), uInk, smokeTone * 0.55);
  color = mix(color, smoky, smoke.x * 0.5);
  color = mix(color, uInk, smoke.y * 0.5);
  float flame = flameTongues(uv);
  color = mix(color, flameColor(flame), smoothstep(0.0, 0.08, flame) * 0.95);
  return color;
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
  // Screen size of the halftone dot. A close-up is read one house at a time, so the dots have to be
  // big enough to see as dots; at town scale a coarse screen would only block up the texture.
  float detail0 = detailAmount(depth * 2.0 * uTanHalfFov / uResolution.y);
  float cell = mix(2.7, 4.4, detail0) * uPixelRatio;

  if (depth >= 1.0) {
    fragColor = vec4(overlayFire(paper, vUv, cell), 1.0);
    return;
  }

  vec4 g = texture(tShade, uv);
  if (uDebug > 0.5) {
    if (uDebug < 1.5) fragColor = vec4(vec3(g.r), 1.0);
    else if (uDebug < 2.5) fragColor = vec4(texture(tNormal, uv).xyz, 1.0);
    else if (uDebug < 3.5) fragColor = vec4(vec3(g.g * 255.0 / 20.0), 1.0);
    else if (uDebug < 4.5) {
      float mpp = depth * 2.0 * uTanHalfFov / uResolution.y;
      fragColor = vec4(vec3(surfaceInk(floor(g.g * 255.0 + 0.5), g.r, g.b * 2.0 - 1.0, worldPosition(uv, depth), mpp, 2.7 * uPixelRatio, detailAmount(mpp))), 1.0);
    }
    else if (uDebug < 5.5) fragColor = vec4(vec3(inkLines(uv, decodeId(uv), linearDepth(uv), texture(tNormal, uv).xyz * 2.0 - 1.0, depth * 2.0 * uTanHalfFov / uResolution.y)), 1.0);
    else fragColor = vec4(vec3(buildingState(decodeId(uv)).r), 1.0);
    return;
  }
  float shade = g.r;
  float surface = floor(g.g * 255.0 + 0.5);
  vec3 normalC = texture(tNormal, uv).xyz * 2.0 - 1.0;
  float up = surface == S_TERRAIN ? smoothNormal(uv).y : g.b * 2.0 - 1.0;
  float idC = decodeId(uv);
  float depthC = linearDepth(uv);
  float metersPerPixel = depthC * 2.0 * uTanHalfFov / uResolution.y;
  vec3 w = worldPosition(uv, depth);
  vec2 mapXY = vec2(w.x, -w.z);

  float detail = detail0;
  float lod = 1.0 - 0.55 * smoothstep(0.45, 1.5, metersPerPixel);
  float tone = surfaceInk(surface, shade, up, w, metersPerPixel, cell, detail) * (surface == S_TERRAIN && up < 0.9 ? 1.0 : lod);
  float lines = inkLines(uv, idC, depthC, normalC, metersPerPixel);
  float ink = max(tone * 0.85, lines);
  vec3 color = mix(paper, uInk, ink * uInkStrength);

  vec4 state = buildingState(idC);
  if (state.r > 0.0) {
    float wash = surface == S_ROOF ? 0.8 : 0.45;
    float pulse = state.g > 0.5 ? 0.75 + 0.25 * uPulse : 1.0;
    color = mix(color, mix(paper, uRed, 0.92), wash * state.r * pulse * (1.0 - lines));
    color = mix(color, uRed, lines * state.r);
  }

  float minutes = arrivalMinutes(mapXY);
  float burned = (1.0 - smoothstep(uFireNow - 6.0, uFireNow, minutes)) * uFireOn;
  if (burned > 0.0) {
    // Minutes since the fire passed. Scorch and embers belong to the band just behind the front;
    // stamping them on the whole scar turns the town into wallpaper and hides the street grid.
    float age = uFireNow - minutes;
    float fresh = 1.0 - smoothstep(2.0, 75.0, age);
    float scorch = hatch(0.16, 8.0 * uPixelRatio, -0.75) * burned * fresh;
    float ember = smoothstep(0.55, 1.0, fbm(mapXY * 0.03 + uTime * 0.08)) * burned * fresh;
    color = mix(color, color * vec3(0.8, 0.77, 0.74), burned * (0.35 + 0.35 * fresh));
    color = mix(color, uInk, scorch * 0.45);
    color = mix(color, uRed, ember * 0.35 * (0.6 + 0.4 * sin(uTime * 2.0 + mapXY.x)));
  }
  // Only the next front is worth drawing. Every front out to the last one would stripe the whole
  // town in red and drown out the roofs that mean somebody is waiting.
  float future = step(uFireNow, minutes) * step(minutes, uFireNow + 31.0) * uFireOn;
  float fm = minutes / 30.0;
  float iso = 1.0 - smoothstep(0.0, 1.3, abs(fract(fm + 0.5) - 0.5) / max(fwidth(fm), 1e-4));
  float dash = step(0.45, fract(dot(gl_FragCoord.xy, vec2(0.7071, 0.7071)) / (9.0 * uPixelRatio)));
  color = mix(color, uRed, iso * dash * future * 0.55);

  float glow = frontGlow(mapXY, minutes);
  color = mix(color, uEmber, clamp(glow, 0.0, 1.0) * 0.6);
  float bloom = texture(tBloom, vUv).r;
  color += uEmber * min(bloom, 1.0) * 0.45 + vec3(1.0, 0.85, 0.6) * smoothstep(0.75, 1.15, glow) * 0.3;
  fragColor = vec4(overlayFire(color, vUv, cell), 1.0);
}
`;
