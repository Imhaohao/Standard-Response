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
// Not flat: Chrome on a Mac draws WebGL through Metal, which can't take GL's last-vertex rule for
// flat varyings, so it rewrites every draw's index buffer to emulate it, and on this many vertices
// that ran the GPU process past 13 GB within seconds. Every vertex of a triangle carries the same
// surface and id, so interpolation returns them unchanged and the readers round them.
out float vSurface;
out float vId;
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
in float vSurface;
in float vId;
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
  float surface = floor(vSurface + 0.5);
  float id = floor(vId + 0.5);
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
uniform float uBurning;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec4 uFireRegion;
uniform float uFireNow;
uniform float uFireOn;
uniform float uNextFrontOn;
uniform float uFireLast;
uniform float uTime;
uniform sampler2D tId;
uniform sampler2D tBuildingFire;
uniform float uBuildingFireOn;

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

float fireCell(ivec2 cell, ivec2 last) {
  return texelFetch(tFire, clamp(cell, ivec2(0), last), 0).r;
}

// Minutes after the warning when the scenario fire reaches this map point. 1e4 means never. Read from
// the field's four nearest cells: where all four are reached their minutes blend. Where some never
// burn, blending their 1e4 would put the edge on the cell boundary in the grid's stair steps, so the
// point counts as burned once most of its weight lies in cells the fire has reached by now, and the
// edge of ground the fire went round runs smoothly between cells.
float arrivalMinutes(vec2 mapXY) {
  vec2 uv = (mapXY - uFireRegion.xy) / (uFireRegion.zw - uFireRegion.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1e4;
  ivec2 last = textureSize(tFire, 0) - 1;
  vec2 p = uv * vec2(last + 1) - 0.5;
  ivec2 cell = ivec2(floor(p));
  vec2 f = fract(p);
  vec4 m = vec4(fireCell(cell, last), fireCell(cell + ivec2(1, 0), last), fireCell(cell + ivec2(0, 1), last), fireCell(cell + ivec2(1, 1), last));
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  vec4 reached = step(m, vec4(uFireLast + 1.0));
  if (dot(reached, vec4(1.0)) > 3.5) return dot(m, w);
  float burned = dot(w * reached, step(m, vec4(uFireNow)));
  if (burned < 0.5) return 1e4;
  return dot(m * reached, w) / max(dot(reached, w), 1e-4);
}

float decodeId(vec2 uv) {
  vec3 c = texture(tId, uv).rgb * 255.0;
  return floor(c.r + 0.5) * 65536.0 + floor(c.g + 0.5) * 256.0 + floor(c.b + 0.5);
}

// A building burns as one piece: every pixel of it takes the minute the fire reaches the building,
// so a front crossing the grid between two fronts never cuts a house in half. Ground and anything
// else read the arrival field.
float arrivalAt(vec2 uv, vec2 mapXY) {
  float id = decodeId(uv);
  if (uBuildingFireOn < 0.5 || id < 999.5 || id > 99999.5) return arrivalMinutes(mapXY);
  float index = id - 1000.0;
  float m = texelFetch(tBuildingFire, ivec2(int(mod(index, 256.0)), int(floor(index / 256.0))), 0).r;
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

// Quarter resolution, every animated frame. Red is how hard the fire glows here, green whether the
// fire has reached it at all. The fire pass reads both.
export const FIRE_MASK_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 color;
${FIRE_COMMON}
uniform float uViewMpp;

// How much of a ring around this burned point the fire hasn't reached: 0 deep inside the burn,
// rising to 1 on its edge. The flanks and the back of a fire have an edge too, and they smoulder
// there long after the head has moved on.
float edgeOfBurn(vec2 mapXY, float reach) {
  float open = 0.0;
  for (int i = 0; i < 8; i++) {
    float angle = float(i) * 0.7854;
    open += step(uFireNow, arrivalMinutes(mapXY + vec2(cos(angle), sin(angle)) * reach));
  }
  return min(1.0, open / 3.0);
}

void main() {
  float depth = texture(tDepth, vUv).r;
  if (depth >= 1.0) { color = vec4(0.0); return; }
  vec3 w = worldPosition(vUv, depth);
  vec2 mapXY = vec2(w.x, -w.z);
  float minutes = arrivalAt(vUv, mapXY);
  float burned = (1.0 - smoothstep(uFireNow - 4.0, uFireNow, minutes)) * uFireOn;
  // A flank or an unburned island smoulders for a while after the fire passes, then cools like the
  // rest of the burn, so an island the fire went round reads as unburned ground, not as a hot spot.
  float cooling = 1.0 - smoothstep(20.0, 90.0, uFireNow - minutes);
  float edge = burned * edgeOfBurn(mapXY, max(8.0, uViewMpp * 5.0)) * cooling;
  float flicker = 0.75 + 0.25 * valueNoise(mapXY * 0.05 + vec2(uTime * 0.9, -uTime * 0.5));
  float glow = max(frontGlow(mapXY, minutes) * 0.7, edge) * flicker * uBurning;
  color = vec4(glow, burned + glow * 0.5, 0.0, 1.0);
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
uniform sampler2D tBuildingState;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uBaseElevation;
uniform vec3 uPaper;
uniform vec3 uInk;
// Dark and burned-out homes. The ink by day; the pitch deck's night map sets its own.
uniform vec3 uCharcoal;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uPulse;
uniform float uDebug;
uniform float uInkStrength;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uViewMpp;
uniform float uPatternScale;
uniform float uPatternBlend;
uniform sampler2D tForecast;
uniform vec4 uForecastRegion;
uniform float uForecastOn;
uniform float uForecastAhead;
uniform vec4 uExtent;
uniform vec4 uTerrainExtent;

// Tone is printed on the town, not on the glass: every dot, hatch and speck is laid out in the
// camera's own right and up directions but measured in metres, so it slides with the streets when
// the map pans. uPatternScale snaps that metre grid to a power of two near the current zoom, and
// uPatternBlend crossfades into the next power as the zoom passes, so dots keep a readable size.
vec2 gPattern;
float gPatternWidth;
// The burn scar's crosshatch lies on the ground instead (see groundHatch).
vec2 gGround;
float gGroundWidth;

void placePattern(vec3 world) {
  gPattern = vec2(dot(world, uCamRight), dot(world, uCamUp)) * uPatternScale;
  vec2 width = fwidth(gPattern);
  gPatternWidth = max(width.x, width.y);
  gGround = vec2(world.x, -world.z) * uPatternScale;
  vec2 groundWidth = fwidth(gGround);
  gGroundWidth = max(groundWidth.x, groundWidth.y);
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
const float OCTAVE_MIDDLE = 1.4142;
const float DOT_CELL = 3.4;

// Below a few pixels a cell can't hold a dot any more, so the pattern gives way to its average tone
// instead of shimmering.
float dotsAt(vec2 p, float coverage, float cell, float width) {
  vec2 f = fract(ROT45 * p / cell) - 0.5;
  float r = sqrt(coverage / 3.14159);
  float aa = max(0.75 * width / cell, 1e-3);
  float dots = 1.0 - smoothstep(r - aa, r + aa, length(f));
  return mix(dots, coverage, smoothstep(0.45, 0.8, width / cell));
}

float screentone(float coverage) {
  if (coverage <= 0.001) return 0.0;
  float cell = DOT_CELL * uPixelRatio * OCTAVE_MIDDLE;
  float fine = dotsAt(gPattern, coverage, cell, gPatternWidth);
  float coarse = dotsAt(gPattern * 0.5, coverage, cell, gPatternWidth * 0.5);
  return mix(fine, coarse, uPatternBlend);
}

// A hatch line is thin, so it needs room. With a period close to the width of the antialiasing
// band every line smears into its neighbour and an 18% hatch comes out as a third of the paper.
// Hatch lines, each nudged off the even grid by its own amount so the spacing breathes like a
// hand-ruled hatch instead of a mechanical one.
float linesAt(vec2 p, float coverage, float period, vec2 direction, float width) {
  float u = dot(p, direction) / period;
  float nudge = (hash12(vec2(floor(u), 7.0)) - 0.5) * 0.5;
  float f = abs(fract(u) - 0.5 - nudge) * period;
  float halfWidth = clamp(coverage, 0.0, 0.9) * period * 0.5;
  float aa = max(0.55 * width, halfWidth * 0.4);
  float lines = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, f);
  return mix(lines, coverage, smoothstep(0.3, 0.6, width / period));
}

float hatch(float coverage, float spacing, float angle) {
  if (coverage <= 0.001) return 0.0;
  float period = max(spacing, 3.0 * uPixelRatio) * OCTAVE_MIDDLE;
  vec2 direction = vec2(cos(angle), sin(angle));
  float fine = linesAt(gPattern, coverage, period, direction, gPatternWidth);
  float coarse = linesAt(gPattern * 0.5, coverage, period, direction, gPatternWidth * 0.5);
  return mix(fine, coarse, uPatternBlend);
}

// The burn scar's crosshatch is a mark on the ground, not shading: its lines lie on the map in fixed
// compass directions, so they foreshorten with the view and drape over the hills under them.
float groundHatch(float coverage, float spacing, float angle) {
  float period = max(spacing, 3.0 * uPixelRatio) * OCTAVE_MIDDLE;
  vec2 direction = vec2(cos(angle), sin(angle));
  float fine = linesAt(gGround, coverage, period, direction, gGroundWidth);
  float coarse = linesAt(gGround * 0.5, coverage, period, direction, gGroundWidth * 0.5);
  return mix(fine, coarse, uPatternBlend);
}

// Three ink levels from the light, like hand-laid tone sheets.
float toneLevel(float shade, float light, float mid, float dark) {
  if (shade > 0.5) return light;
  if (shade > 0.18) return mid;
  return dark;
}

// A round speck sits somewhere inside each lit cell, never filling it, so neighbouring specks read
// as stippled dots rather than joining into blocks.
float specksAt(vec2 p, float density, float width) {
  float cell = 2.6 * uPixelRatio * OCTAVE_MIDDLE;
  vec2 id = floor(p / cell);
  vec2 centre = (id + 0.25 + 0.5 * vec2(hash12(id + 11.0), hash12(id + 23.0))) * cell;
  float radius = cell * 0.22;
  float speck = 1.0 - smoothstep(radius - width * 0.6, radius + width * 0.6, length(p - centre));
  return step(1.0 - density, hash12(id)) * speck;
}

float stipple(float density) {
  return mix(specksAt(gPattern, density, gPatternWidth), specksAt(gPattern * 0.5 + 97.0, density, gPatternWidth * 0.5), uPatternBlend);
}

float landuseInk(float kind, float shade) {
  float shadow = shade < 0.2 ? 0.26 : 0.0;
  if (kind == 1.0 || kind == 2.0 || kind == 7.0) return max(stipple(0.1), screentone(shadow));
  if (kind == 3.0) return hatch(0.16, 6.0 * uPixelRatio, 0.0);
  if (kind == 4.0 || kind == 6.0) return screentone(max(0.1, shadow));
  if (kind == 5.0) return screentone(max(0.04, shadow));
  if (kind == 8.0) return max(screentone(0.07), stipple(0.05));
  if (kind == 9.0) return max(stipple(0.12), screentone(shadow));
  return screentone(max(0.05, shadow));
}

float contourLine(float e) {
  return 1.0 - smoothstep(0.0, 1.0, abs(fract(e + 0.5) - 0.5) / max(fwidth(e), 1e-4));
}

float terrainInk(float shade, float up, vec3 w, float metersPerPixel) {
  float steep = 1.0 - up;
  float slopeHatch = hatch(clamp((steep - 0.16) * 1.2, 0.0, 0.32) * (1.0 - shade * 0.7), 6.5 * uPixelRatio, 0.35);
  float elevation = w.y + uBaseElevation;
  float contour = mix(contourLine(elevation / 25.0), contourLine(elevation / 100.0), smoothstep(2.5, 3.5, metersPerPixel));
  // The yard tone is a town-scale texture: it says "this is a settled block" when a house is one
  // pixel wide. Close up it is only dirt on the paper, so it fades out as the detail comes in.
  float yard = screentone(shade < 0.25 ? 0.16 : 0.0) * smoothstep(0.8, 3.0, metersPerPixel);
  return max(max(yard, slopeHatch), contour * 0.35);
}

// Buildings at town scale are drawn as one flat tone rather than lit face by face, because there is
// no face left to light. The tone is what makes the built-up area read as a place. It shares the
// terrain's dot grid: a house is one pixel wide there, so two screens next to each other would read
// as noise rather than as two surfaces.
float buildingTone(float shade, float detail, float lit, float plain) {
  return mix(screentone(plain), screentone(toneLevel(shade, lit * 0.5, lit, plain * 0.9)), detail);
}

float surfaceInk(float surface, float shade, float up, vec3 w, float metersPerPixel, float detail) {
  if (surface == S_WALL) return buildingTone(shade, detail, 0.16, 0.12);
  if (surface == S_ROOF) return buildingTone(shade, detail, 0.1, 0.08);
  if (surface == S_ROAD) return screentone(shade < 0.25 ? 0.2 : 0.0) * detail;
  // A tree is 5 m across, so at town scale it is a fraction of a pixel and its canopy tone aliases
  // into a random dark speck. Fading the tone keeps the tree cover visible as a stipple.
  if (surface == S_TREE) return screentone(toneLevel(shade, 0.0, 0.12, 0.34) * mix(0.42, 1.0, detail));
  if (surface > S_LANDUSE) return landuseInk(surface - S_LANDUSE, shade);
  return terrainInk(shade, up, w, metersPerPixel);
}

vec4 buildingState(float id) {
  if (id < 999.5 || id > 99999.5) return vec4(0.0);
  float index = id - 1000.0;
  ivec2 texel = ivec2(int(mod(index, 256.0)), int(floor(index / 256.0)));
  return texelFetch(tBuildingState, texel, 0);
}

// The forecast bands, on ground the fire hasn't reached yet: each band is where the fire is that
// likely to be within the hour. The three fills stack, and each band has its own edge line.
vec3 forecast(vec3 color, vec2 mapXY, float minutes, float lines) {
  vec2 uv = (mapXY - uForecastRegion.xy) / (uForecastRegion.zw - uForecastRegion.xy);
  // Ground the scenario fire itself reaches counts as reached in every band: the ensemble and the
  // scenario are different models, and a band that left out the fire everyone can see would be wrong.
  vec3 arrival = min(texture(tForecast, clamp(uv, 0.0, 1.0)).rgb, vec3(minutes));
  vec3 width = max(fwidth(arrival), vec3(1e-3));
  float ahead = uFireNow + uForecastAhead;
  vec2 onMap = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float shown = uForecastOn * uFireOn * step(uFireNow, minutes) * max(onMap.x * onMap.y, step(minutes, ahead));
  vec3 inside = step(arrival, vec3(ahead));
  vec3 edge = 1.0 - smoothstep(0.0, 1.4, abs(arrival - ahead) / width);
  color = mix(color, uRed, dot(inside, vec3(0.1, 0.12, 0.16)) * shown);
  float line = max(max(edge.r * 0.5, edge.g * 0.65), edge.b * 0.85);
  return mix(color, uRed, line * shown * (1.0 - lines * 0.5));
}

// How much of a point is still burning: fully for the first quarter hour after the fire reaches
// it, then dying down to the embers of the burned area.
float burningShare(float minutes) {
  float since = uFireNow - minutes;
  return step(0.0, since) * (1.0 - smoothstep(12.0, 18.0, since)) * uFireOn * uBurning;
}

// Burned ground is warm char, one tone from just behind the front inward, so the burn never splits
// into rings that each need a legend. Only a short band of live coals trails the front, torn by noise
// into tongues. Inside, beds of coals hold their heat under the char and glow through it, cooling
// smoothly over the hours so they thin out without drawing a ring. The char varies by place: darker
// scorched patches and pale flecks of ash. The embers that wink over it are drawn every frame by the
// fire pass.
vec3 fireGround(vec2 mapXY, float since) {
  float age = since + (fbm(mapXY * 0.02) - 0.5) * 16.0;
  float coals = 1.0 - smoothstep(2.0, 14.0, age);
  // Warped by a finer noise, so the patches' edges tear into jags and slivers instead of rounding off.
  vec2 tear = vec2(valueNoise(mapXY * 0.16), valueNoise(mapXY * 0.16 + 9.7)) - 0.5;
  float patches = fbm(mapXY * 0.05 + 31.0 + tear * 1.1);
  float edge = fwidth(patches) + 0.015;
  float scorched = 1.0 - smoothstep(0.42 - edge, 0.42 + edge, patches);
  float ash = smoothstep(0.64 - edge, 0.64 + edge, patches);
  vec3 char = mix(mix(uInk, uPaper, 0.32), mix(uInk, uRed, 0.3), 0.15);
  char = mix(char, mix(uInk, uPaper, 0.18), scorched * 0.8);
  char = mix(char, mix(uInk, uPaper, 0.6), ash * 0.6);
  float bedNoise = fbm(mapXY * 0.035 + 71.0 + tear * 0.8);
  float bed = smoothstep(0.6, 0.7, bedNoise) * mix(0.4, 1.0, 1.0 - smoothstep(20.0, 240.0, age));
  char = mix(char, mix(uRed, uEmber, 0.7), bed * 0.9);
  return mix(char, mix(uEmber, uRed, 0.35) * 0.9, coals);
}

// Homes in the zone: a burning one is the brightest thing on the map for its quarter hour. After that
// it's a grey shell, and about a third of them, picked by building, keep smouldering ember orange for
// hours. Both stay unlike the charcoal of a home with people still in it and the pulsing red of one
// that needs a ride, so those two still stand out over the burn.
vec3 fireBuilding(float surface, float burning, float id, float since) {
  bool roof = surface == S_ROOF;
  float smoulders = step(0.64, hash12(vec2(id, 7.0)));
  float warmth = smoulders * mix(0.4, 1.0, 1.0 - smoothstep(30.0, 300.0, since));
  vec3 burnedOut = mix(uInk, uPaper, roof ? 0.5 : 0.38);
  burnedOut = mix(burnedOut, mix(uEmber, uRed, 0.4) * (roof ? 0.92 : 0.68), warmth * 0.75);
  vec3 alight = roof ? mix(uEmber, vec3(1.0, 0.7, 0.3), 0.3) : uRed;
  return mix(burnedOut, alight, burning);
}

vec3 fireZone(vec3 color, float ink, float surface, float id, vec2 mapXY, float minutes) {
  float since = uFireNow - minutes;
  if (since < 0.0 || uFireOn < 0.5) return color;
  bool building = surface == S_ROOF || surface == S_WALL;
  vec3 zone = building ? fireBuilding(surface, burningShare(minutes), id, since) : fireGround(mapXY, since);
  return zone * (1.0 - ink * 0.7);
}

// A quake or flood leaves ground that is damaged, not alight: a warm grey and a light crosshatch,
// darkest just behind the edge. The houses go to solid charcoal so they still read as houses.
vec3 ashen(vec3 color, float surface, float minutes, float lines) {
  float burned = (1.0 - smoothstep(uFireNow - 6.0, uFireNow, minutes)) * uFireOn;
  if (burned == 0.0) return color;
  float fresh = 1.0 - smoothstep(2.0, 75.0, uFireNow - minutes);
  bool building = surface == S_ROOF || surface == S_WALL;
  float crosshatch = max(groundHatch(0.07, 12.0 * uPixelRatio, 0.7854), groundHatch(0.07, 12.0 * uPixelRatio, -0.7854));
  float scorch = building ? 0.0 : crosshatch * burned * (0.35 + 0.65 * fresh);
  vec3 ash = mix(vec3(0.88, 0.85, 0.82), vec3(0.7, 0.62, 0.57), fresh);
  color = mix(color, color * ash, burned * (building ? 0.3 : 0.6 + 0.3 * fresh));
  color = mix(color, uCharcoal, scorch * (0.16 + 0.16 * fresh) * (1.0 - lines));
  if (surface == S_ROOF) color = mix(color, uCharcoal * 1.2, burned * 0.75);
  if (surface == S_WALL) color = mix(color, uCharcoal * 1.5, burned * 0.6);
  return color;
}

// A crisp line along the hazard's edge all the way round, so where it is never has to be guessed.
vec3 hazardEdge(vec3 color, float minutes) {
  float width = max(fwidth(minutes), 1e-3);
  // Where the fire field stops, minutes jump from a real time to "never burns" across one pixel. That
  // jump is not a front, so a step this steep draws no edge.
  float realFront = step(width, 60.0);
  float edge = (1.0 - smoothstep(0.6, 1.8, abs(minutes - uFireNow) / width)) * uFireOn * step(minutes, uFireLast + 1.0) * realFront;
  return mix(color, uRed, edge * 0.95);
}

// How far a point is inside a box, in metres; negative outside it.
float insideBy(vec2 p, vec4 box) {
  return min(min(p.x - box.x, box.z - p.x), min(p.y - box.y, box.w - p.y));
}

// The baked map has to end somewhere, so it fades out rather than stopping at a cut: the town's
// buildings, streets and trees thin to bare paper over the last stretch before the edge of what was
// baked, and the hills fade out the same way near the end of the terrain.
float edgeFade(vec2 mapXY, float surface) {
  float terrain = 1.0 - smoothstep(0.0, 1500.0, insideBy(mapXY, uTerrainExtent));
  if (surface == S_TERRAIN) return terrain;
  return max(terrain, 1.0 - smoothstep(0.0, 700.0, insideBy(mapXY, uExtent)));
}

void main() {
  vec2 uv = vUv;
  float depth = texture(tDepth, uv).r;
  placePattern(worldPosition(uv, depth));
  // Paper grain is printed on the town like the tone, so it slides with the streets instead of
  // crawling over them while the map pans.
  float grain = (hash12(floor(gPattern / uPixelRatio)) - 0.5) * 0.035;
  vec3 paper = uPaper + grain;
  // Level of detail follows the zoom, never each pixel's own distance. Read per pixel, the far half
  // of a tilted view crosses into town-scale drawing before the near half does, and the seam between
  // them sweeps across the map like a shadow every time the zoom changes.
  float metersPerPixel = uViewMpp;
  float detail = detailAmount(metersPerPixel);

  if (depth >= 1.0) {
    fragColor = vec4(paper, 0.0);
    return;
  }

  vec4 g = texture(tShade, uv);
  if (uDebug > 0.5) {
    if (uDebug < 1.5) fragColor = vec4(vec3(g.r), 0.0);
    else if (uDebug < 2.5) fragColor = vec4(texture(tNormal, uv).xyz, 0.0);
    else if (uDebug < 3.5) fragColor = vec4(vec3(g.g * 255.0 / 20.0), 0.0);
    else if (uDebug < 4.5) fragColor = vec4(vec3(surfaceInk(floor(g.g * 255.0 + 0.5), g.r, g.b * 2.0 - 1.0, worldPosition(uv, depth), metersPerPixel, detail)), 0.0);
    else if (uDebug < 5.5) fragColor = vec4(vec3(inkLines(uv, decodeId(uv), linearDepth(uv), texture(tNormal, uv).xyz * 2.0 - 1.0, metersPerPixel)), 0.0);
    else fragColor = vec4(vec3(buildingState(decodeId(uv)).r), 0.0);
    return;
  }
  float shade = g.r;
  float surface = floor(g.g * 255.0 + 0.5);
  vec3 normalC = texture(tNormal, uv).xyz * 2.0 - 1.0;
  float up = surface == S_TERRAIN ? smoothNormal(uv).y : g.b * 2.0 - 1.0;
  float idC = decodeId(uv);
  float depthC = linearDepth(uv);
  vec3 w = worldPosition(uv, depth);
  vec2 mapXY = vec2(w.x, -w.z);

  float lod = 1.0 - 0.55 * smoothstep(0.45, 1.5, metersPerPixel);
  float tone = surfaceInk(surface, shade, up, w, metersPerPixel, detail) * (surface == S_TERRAIN && up < 0.9 ? 1.0 : lod);
  float lines = inkLines(uv, idC, depthC, normalC, metersPerPixel);
  float ink = max(tone * 0.85, lines) * (1.0 - edgeFade(mapXY, surface));
  vec3 color = mix(paper, uInk, ink * uInkStrength);
  float minutes = arrivalAt(uv, mapXY);
  if (uBurning > 0.5) color = fireZone(color, ink * uInkStrength, surface, idC, mapXY, minutes);
  else color = ashen(color, surface, minutes, lines);

  // Who is in a home is drawn over the fire, never under it: a home with people still in it stays
  // charcoal even while it burns.
  vec4 state = buildingState(idC);
  float stillHome = step(0.75, state.b) * step(state.r, 0.0);
  float left = step(0.25, state.b) * (1.0 - step(0.75, state.b));
  if (stillHome > 0.0) {
    float wash = surface == S_ROOF ? 0.82 : 0.6;
    color = mix(color, uCharcoal, wash * (1.0 - lines * 0.5));
  }
  if (left > 0.0) color = mix(color, paper, (surface == S_ROOF ? 0.75 : 0.4) * (1.0 - lines));
  // Alpha marks a pulsing roof and how strongly it is washed red; the fire pass breathes it.
  float pulsing = 0.0;
  if (state.r > 0.0) {
    float wash = surface == S_ROOF ? 0.8 : 0.45;
    color = mix(color, mix(paper, uRed, 0.92), wash * state.r * (1.0 - lines));
    color = mix(color, uRed, lines * state.r);
    pulsing = step(0.5, state.g) * wash * state.r * (1.0 - lines);
  }

  color = forecast(color, mapXY, minutes, lines);
  color = hazardEdge(color, minutes);

  // Only the next front is worth drawing. Every front out to the last one would stripe the whole
  // town in red and drown out the roofs that mean somebody is waiting.
  float future = step(uFireNow, minutes) * step(minutes, uFireNow + 31.0) * uFireOn * uNextFrontOn;
  float fm = minutes / 30.0;
  float iso = 1.0 - smoothstep(0.0, 1.3, abs(fract(fm + 0.5) - 0.5) / max(fwidth(fm), 1e-4));
  float dashPeriod = 9.0 * uPixelRatio * OCTAVE_MIDDLE;
  float dash = mix(step(0.45, fract(dot(gPattern, vec2(0.7071)) / dashPeriod)), step(0.45, fract(dot(gPattern * 0.5, vec2(0.7071)) / dashPeriod)), uPatternBlend);
  color = mix(color, uRed, iso * dash * future * 0.55);

  fragColor = vec4(color, pulsing);
}
`;

// Every animated frame, full resolution: the cached map from the composite pass, with sparks over
// ground that is still burning. Away from the fire it is one texture read. The flames are geometry,
// drawn after this pass (flames.ts).
export const FIRE_FRAGMENT = `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
${SURFACE_GLSL}
${FIRE_COMMON}
uniform sampler2D tShade;
uniform sampler2D tBase;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform vec3 uPaper;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uPulse;
uniform float uPatternScale;

// A roof waiting on a ride breathes: the base drew it at full red, and this eases it toward paper.
vec3 breathe(vec4 base) {
  return mix(base.rgb, uPaper, base.a * 0.3 * (1.0 - uPulse));
}

// Sparks in the freshly burned ground, in a grid fixed to the town, winking in and out. The grid
// follows the tone's metre grid so a spark stays a few pixels across at any zoom.
vec3 sparks(vec3 color, vec2 mapXY, float fresh) {
  vec2 cell = mapXY * uPatternScale / (5.0 * uPixelRatio);
  vec2 id = floor(cell);
  float lit = step(0.93, hash12(id)) * clamp(fresh, 0.0, 1.0);
  float twinkle = smoothstep(0.35, 1.0, sin(uTime * (1.5 + 3.0 * hash12(id + 7.0)) + hash12(id + 3.0) * 6.28));
  float spark = lit * twinkle * (1.0 - smoothstep(0.12, 0.38, length(fract(cell) - 0.5)));
  return mix(color, vec3(1.0, 0.62, 0.25), spark);
}

// Embers smouldering over the whole burned area. Two noises warp each other while both drift, so
// a patch of glow crawls, splits and merges instead of sliding across the map, and each patch
// breathes on its own beat. A fine grain flickers inside it, like coals catching and dimming. It
// glows red at the rim and orange at the core, never yellow: burned ground glows like coals, not
// flame. The glow dies down over the hours after the front passes, smoothly so it draws no ring, and
// keeps a steady scatter over the char all night. Only the ground smoulders; the houses and trees keep their own colours.
vec3 smoulder(vec3 color, vec2 mapXY, float since, float surface) {
  if (since < 0.0 || (surface != S_TERRAIN && surface != S_ROAD && surface < S_LANDUSE)) return color;
  vec2 p = mapXY * 0.03;
  vec2 warp = vec2(valueNoise(p * 0.7 + vec2(uTime * 0.11, 0.0)), valueNoise(p * 0.7 + vec2(5.2, -uTime * 0.09))) - 0.5;
  float broad = valueNoise(p + warp * 2.0 + vec2(-uTime * 0.07, uTime * 0.05));
  float fine = valueNoise(mapXY * 0.12 + warp * 3.0 + vec2(uTime * 0.2, -uTime * 0.15));
  float grain = valueNoise(mapXY * 0.35 + vec2(uTime * 0.9, -uTime * 1.3));
  float glow = smoothstep(0.48, 0.78, broad * 0.65 + fine * 0.35) * (0.6 + 0.4 * sin(uTime * 1.7 + broad * 12.0));
  float heat = glow * (0.55 + 0.45 * grain) * mix(0.45, 1.0, 1.0 - smoothstep(8.0, 120.0, since));
  return color + mix(uRed, uEmber, heat) * heat * 0.7;
}

// The map point under a screen point.
vec2 groundAt(vec2 uv) {
  vec3 w = worldPosition(uv, texture(tDepth, uv).r);
  return vec2(w.x, -w.z);
}

// The fire line's hot core: how close this pixel is to the line where arrival time equals the
// clock, measured in pixels from the arrival time's change to the next pixel over, so the core is
// a pixel or two wide at any zoom.
float coreLine(vec2 uv, float minutes) {
  vec2 px = 1.0 / uResolution;
  float dx = arrivalMinutes(groundAt(uv + vec2(px.x, 0.0))) - minutes;
  float dy = arrivalMinutes(groundAt(uv + vec2(0.0, px.y))) - minutes;
  float perPixel = max(length(vec2(dx, dy)), 1e-3);
  return 1.0 - smoothstep(0.4 * uPixelRatio, 1.6 * uPixelRatio, abs(minutes - uFireNow) / perPixel);
}

// Heat rising off the fire: the air just above the line on screen wobbles hard, and over the rest of
// the burned area it shimmers gently, with ripples that drift upward. The ripples are fixed to the ground, so they pan with it.
vec2 heatHaze(vec2 uv) {
  vec2 bloom = texture(tBloom, uv + vec2(0.0, 10.0 * uPixelRatio / uResolution.y)).rg;
  float heat = max(bloom.r, min(bloom.g, 1.0) * 0.3);
  if (heat < 0.02) return uv;
  vec2 p = groundAt(uv) * 0.09;
  vec2 ripple = vec2(valueNoise(p + vec2(0.0, -uTime * 2.4)), valueNoise(p + vec2(7.3, -uTime * 2.9))) - 0.5;
  return uv + ripple * vec2(1.0, 1.6) * smoothstep(0.02, 0.6, heat) * 3.0 * uPixelRatio / uResolution;
}

void main() {
  vec4 bloom = texture(tBloom, vUv);
  bool near = uFireOn > 0.5 && uBurning > 0.5 && bloom.r + bloom.g > 0.003;
  vec2 uv = near ? heatHaze(vUv) : vUv;
  vec3 color = breathe(texture(tBase, uv));
  float depth = texture(tDepth, uv).r;
  if (near && depth < 1.0) {
    vec2 mapXY = groundAt(uv);
    float minutes = arrivalAt(uv, mapXY);
    float since = uFireNow - minutes;
    color = smoulder(color, mapXY, since, floor(texture(tShade, uv).g * 255.0 + 0.5));
    color = sparks(color, mapXY, step(0.0, since) * (1.0 - 0.6 * smoothstep(10.0, 40.0, since)));
    float core = coreLine(uv, minutes);
    // An animated-film glow: an orange halo bleeding out from the line, warming whatever it
    // touches, and a white-hot core along the line itself.
    float halo = min(bloom.r, 1.2);
    color = color * (1.0 + vec3(0.55, 0.22, 0.0) * halo) + uEmber * halo * 0.55;
    color = mix(color, vec3(1.0, 0.96, 0.78), core * 0.9);
  }
  fragColor = vec4(min(color, vec3(1.0)), 1.0);
}
`;
