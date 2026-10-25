import { FULLSCREEN_HEADER, GBUFFER_GLSL, NOISE_GLSL, TERRAIN_GLSL } from "../glsl";

// The blizzard's shaders. Snow is paper with thin ink edges, shaded with the composite's own dot
// screen; nothing in them adds a hue. Red belongs to the homes where someone needs help.

// Tone printed on the town in the camera's right and up directions, measured in metres, exactly as
// the composite lays it (placePattern in shaders.ts), so snow shading and the town's tone share one grid.
export const PATTERN_GLSL = `
uniform float uPatternScale;
uniform float uPatternBlend;
uniform float uPixelRatio;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

vec2 gPattern;
float gPatternWidth;

void placePattern(vec3 world) {
  gPattern = vec2(dot(world, uCamRight), dot(world, uCamUp)) * uPatternScale;
  vec2 width = fwidth(gPattern);
  gPatternWidth = max(width.x, width.y);
}

const mat2 ROT45 = mat2(0.7071, -0.7071, 0.7071, 0.7071);
const float OCTAVE_MIDDLE = 1.4142;
const float DOT_CELL = 3.4;

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
  return mix(dotsAt(gPattern, coverage, cell, gPatternWidth), dotsAt(gPattern * 0.5, coverage, cell, gPatternWidth * 0.5), uPatternBlend);
}

float specksAt(vec2 p, float density, float width) {
  float cell = 2.6 * uPixelRatio * OCTAVE_MIDDLE;
  vec2 id = floor(p / cell);
  vec2 centre = (id + 0.25 + 0.5 * vec2(hash12(id + 11.0), hash12(id + 23.0))) * cell;
  float radius = cell * 0.22;
  float speck = 1.0 - smoothstep(radius - width * 0.6, radius + width * 0.6, length(p - centre));
  return step(1.0 - density, hash12(id)) * speck;
}

float stipple(float density) {
  if (density <= 0.001) return 0.0;
  return mix(specksAt(gPattern, density, gPatternWidth), specksAt(gPattern * 0.5 + 97.0, density, gPatternWidth * 0.5), uPatternBlend);
}
`;

// Who is in a home, from the renderer's building-state texture: r how red (needs a ride), g pulsing,
// b occupancy (1 still home, 0.5 left). Needs tId declared.
export const HOME_STATE_GLSL = `
uniform sampler2D tBuildingState;

float objectId(vec2 uv) {
  vec3 c = texture(tId, uv).rgb * 255.0;
  return floor(c.r + 0.5) * 65536.0 + floor(c.g + 0.5) * 256.0 + floor(c.b + 0.5);
}

vec4 homeState(float id) {
  if (id < 999.5 || id > 99999.5) return vec4(0.0);
  float index = id - 1000.0;
  return texelFetch(tBuildingState, ivec2(int(mod(index, 256.0)), int(floor(index / 256.0))), 0);
}

// A home the map is saying something about: someone waiting (red) or still home (charcoal).
float marked(vec4 home) {
  return max(step(0.001, home.r), step(0.75, home.b));
}
`;

// Drawn into the cached map once per minute: snow lying on the town. Its alpha is how much snow lies
// on a pixel; the blend keeps the map's own alpha, which carries the roofs' breathing.
export const SNOW_COVER_FRAGMENT = `
${FULLSCREEN_HEADER}
${GBUFFER_GLSL}
${TERRAIN_GLSL}
${NOISE_GLSL}
${PATTERN_GLSL}
${HOME_STATE_GLSL}
uniform sampler2D tNormal;
uniform sampler2D tFootprints;
uniform vec4 uFootprintRegion;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uInkStrength;
uniform float uViewMpp;
uniform float uDepth;
uniform vec2 uWindToward;
uniform float uWindSpeed;

float detailAt() {
  return 1.0 - smoothstep(1.4, 4.5, uViewMpp);
}

float viewDepth(vec2 uv) {
  float d = texture(tDepth, uv).r;
  if (d >= 1.0) return 1e6;
  vec4 v = uInvProjection * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return -v.z / v.w;
}

float footprintAt(vec2 p) {
  vec2 uv = (p - uFootprintRegion.xy) / (uFootprintRegion.zw - uFootprintRegion.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return texture(tFootprints, uv).r;
}

// Snow carried by the wind piles against the first wall it meets: deepest right at the wall,
// thinning back upwind over \`reach\` metres.
float windwardDrift(vec2 p, float reach) {
  float drift = 0.0;
  for (int i = 1; i <= 7; i++) {
    float d = float(i) / 7.0;
    drift = max(drift, footprintAt(p + uWindToward * reach * d) * (1.0 - d * 0.9));
  }
  return drift;
}

// The lee of a house upwind, where the wind combs the snow into streaks.
float leeShelter(vec2 p, float reach) {
  float lee = 0.0;
  for (int i = 1; i <= 5; i++) {
    float d = float(i) / 5.0;
    lee = max(lee, footprintAt(p - uWindToward * reach * d) * (1.0 - d));
  }
  return lee;
}

// Flat ground and gentle roofs hold all the snow that falls, steep roofs shed it, trees hold it on
// top of the crown, walls hold none.
float snowCatch(float surface, float up) {
  if (surface == SURFACE_WALL) return 0.0;
  if (surface == SURFACE_ROOF) return smoothstep(0.3, 0.62, up);
  if (surface == SURFACE_TREE) return smoothstep(0.15, 0.75, up) * 0.9;
  if (surface == SURFACE_WATER_AREA) return 0.6;
  return 1.0;
}

// Patchy for the first centimetres, whole once a few lie.
float laid(vec2 mapXY) {
  float presence = smoothstep(0.004, 0.05, uDepth);
  float patches = fbm(mapXY * 0.08);
  return smoothstep(0.0, 0.15, presence * 1.25 - (1.0 - patches) * 0.55);
}

// Lines stay where one object ends and another begins. Ground, streets and land use meet under the
// snow without one: the street's edge is buried.
float edgeWeight(float idC, float idN, float surfaceC, float surfaceN) {
  float detail = detailAt();
  if (idC < 0.5 || idN < 0.5) return 0.0;
  bool buildingC = idC > 999.5 && idC < 99999.5;
  bool buildingN = idN > 999.5 && idN < 99999.5;
  if (idC == idN) return buildingC && surfaceC != surfaceN ? 0.75 * detail : 0.0;
  if (buildingC || buildingN) return mix(0.2, 0.85, detail);
  if (idC > 99999.5 || idN > 99999.5) return 0.45 * detail;
  return 0.0;
}

// The snow's own outlines, drawn a little unsteadily: as the snow deepens they soften, waver and
// break, the way contours go under a deep fall.
float snowLines(vec2 uv, vec2 mapXY, float idC, float surfaceC) {
  float soft = smoothstep(0.05, 0.6, uDepth);
  vec2 wobble = (vec2(valueNoise(mapXY * 0.4), valueNoise(mapXY * 0.4 + 7.3)) - 0.5) * soft * 1.6;
  vec2 px = (vec2(max(1.0, uPixelRatio * 0.8)) + wobble) / uResolution;
  float depthC = viewDepth(uv);
  float line = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 dir = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    vec2 uvN = uv + dir * px;
    if (depthC > viewDepth(uvN) * 1.0015) continue;
    line = max(line, edgeWeight(idC, objectId(uvN), surfaceC, surfaceAt(uvN)));
  }
  float broken = mix(1.0, smoothstep(0.3, 0.55, valueNoise(mapXY * 0.9)), soft * 0.6);
  return line * mix(1.0, 0.6, soft) * broken;
}

// Two wavering contour lines around each drift, like the bands Hiroshige cut into banked snow.
float driftCrest(float drift, vec2 mapXY) {
  float d = drift + (valueNoise(mapXY * 0.7) - 0.5) * 0.08;
  float w = max(fwidth(d), 1e-3);
  float outer = 1.0 - smoothstep(0.6, 1.6, abs(d - 0.3) / w);
  float inner = 1.0 - smoothstep(0.6, 1.6, abs(d - 0.65) / w);
  return max(outer, inner * 0.6) * step(0.05, drift);
}

// Ripples the wind combs across open snow, running across the wind and broken into dashes.
float windRipples(vec2 mapXY) {
  vec2 across = vec2(-uWindToward.y, uWindToward.x);
  float u = dot(mapXY, uWindToward) / 2.2 + (valueNoise(mapXY * 0.06) - 0.5) * 2.5;
  float w = max(fwidth(u), 1e-3);
  float line = 1.0 - smoothstep(0.6, 1.6, abs(fract(u + 0.5) - 0.5) / w);
  return line * step(0.5, valueNoise(vec2(dot(mapXY, across) * 0.15, floor(u))));
}

vec4 groundSnow(vec2 uv, vec2 mapXY, float surface, float up, float idC) {
  float cover = laid(mapXY) * snowCatch(surface, up);
  float detail = detailAt();
  float windy = smoothstep(4.0, 14.0, uWindSpeed);
  bool open = surface == SURFACE_TERRAIN || surface == SURFACE_ROAD || surface > 9.5;
  float drift = open ? windwardDrift(mapXY, 3.0 + uDepth * 10.0) * windy * smoothstep(0.03, 0.2, uDepth) : 0.0;
  float lee = open ? leeShelter(mapXY, 6.0 + uDepth * 22.0) * windy : 0.0;
  float shade = texture(tShade, uv).r;
  float tone = screentone(shade < 0.3 ? 0.12 : shade < 0.55 ? 0.05 : 0.0) * mix(0.5, 1.0, detail);
  float streak = stipple(0.16 * lee) * 0.8;
  float lines = snowLines(uv, mapXY, idC, surface);
  float crest = driftCrest(drift, mapXY) * detail;
  float ripples = open ? windRipples(mapXY) * windy * smoothstep(0.06, 0.25, uDepth) * (1.0 - smoothstep(0.5, 1.6, uViewMpp)) * (1.0 - drift) : 0.0;
  float ink = max(max(tone * 0.85, streak), max(lines, max(crest * 0.7, ripples * 0.3)));
  return vec4(mix(uPaper, uInk, ink * uInkStrength), cover);
}

// Walls hold no snow, but the drift banks up the ones facing the wind, with a wavering ink line along
// its top. Above it the wall darkens a little, so each house keeps its shape under a white roof.
vec4 wallSnow(vec2 uv, vec3 n, vec2 mapXY) {
  float presence = smoothstep(0.004, 0.05, uDepth);
  float windy = smoothstep(4.0, 14.0, uWindSpeed);
  vec2 facing = normalize(vec2(n.x, -n.z) + vec2(1e-5));
  float windward = max(0.0, dot(facing, -uWindToward));
  float height = surfaceElevation(uv) - groundElevation(mapXY);
  float along = dot(mapXY, vec2(-facing.y, facing.x));
  float top = uDepth * (0.7 + 2.4 * windward * windy) * (0.7 + 0.6 * valueNoise(vec2(along * 0.4, 1.7)));
  float aa = max(fwidth(height), 0.01);
  float buried = 1.0 - smoothstep(top - aa * 0.5, top + aa * 0.5, height);
  float rim = (1.0 - smoothstep(0.4, 1.4, abs(height - top) / aa)) * step(0.02, top) * detailAt();
  float snow = max(buried, rim);
  if (snow > 0.01) return vec4(mix(uPaper, uInk, rim * 0.75 * uInkStrength), snow);
  return vec4(uInk, 0.13 * presence);
}

void main() {
  if (isSky(vUv) || uDepth < 0.004) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 world = worldPosition(vUv, texture(tDepth, vUv).r);
  vec2 mapXY = vec2(world.x, -world.z);
  placePattern(world);
  float idC = objectId(vUv);
  if (marked(homeState(idC)) > 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  float surface = surfaceAt(vUv);
  vec3 n = normalize(texture(tNormal, vUv).xyz * 2.0 - 1.0);
  fragColor = surface == SURFACE_WALL ? wallSnow(vUv, n, mapXY) : groundSnow(vUv, mapXY, surface, n.y, idC);
}
`;

// Quarter resolution: how red each block of four by four pixels is (r) and whether it breathes (g),
// the brightest of four taps, so a house a few pixels wide is never missed. Blurred into the glow.
export const GLOW_MASK_FRAGMENT = `
${FULLSCREEN_HEADER}
uniform sampler2D tId;
${HOME_STATE_GLSL}
uniform vec2 uResolution;

void main() {
  vec2 texel = 1.0 / uResolution;
  vec2 glow = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 offset = vec2(i == 1 || i == 3 ? 1.5 : -1.5, i >= 2 ? 1.5 : -1.5) * texel;
    vec4 home = homeState(objectId(vUv + offset));
    glow = max(glow, vec2(home.r, home.r * step(0.5, home.g)));
  }
  fragColor = vec4(glow, 0.0, 1.0);
}
`;

// Every frame, full resolution, in place of the canvas: the cached map breathing as the fire pass
// would, dimmed toward night, fading toward paper in the whiteout with veils of blown snow sweeping
// through, the red homes glowing through it all, and the finest falling snow as a moving grain screen
// with wind streaks.
export const ATMOSPHERE_FRAGMENT = `
${FULLSCREEN_HEADER}
${NOISE_GLSL}
uniform sampler2D tBase;
uniform sampler2D tDepth;
uniform sampler2D tId;
${HOME_STATE_GLSL}
uniform sampler2D tGlow;
uniform mat4 uInvProjection;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uPulse;
uniform float uWhiteout;
uniform float uSnowfall;
uniform float uDaylight;
uniform float uWindSpeed;
uniform float uSlant;
uniform float uCenterDistance;
// How far the snow has travelled, summed frame by frame on the CPU (see BlizzardLayer.travel), so a
// change in the wind turns the snow instead of throwing it across the screen.
uniform vec2 uFallTravel;
uniform float uStreakTravel;
uniform vec2 uVeilTravel;

const float NIGHT_PAPER = 0.5;
const float NIGHT_FOG = 0.58;

vec3 breathe(vec4 base) {
  return mix(base.rgb, uPaper, base.a * 0.3 * (1.0 - uPulse));
}

float distanceAt(vec2 uv) {
  float d = texture(tDepth, uv).r;
  if (d >= 1.0) return uCenterDistance * 2.0;
  vec4 v = uInvProjection * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}

// Whiteout: the farther ground goes first, and veils of blown snow sweep across in the wind.
float whiteout(vec2 uv) {
  float far = smoothstep(0.55, 1.5, distanceAt(uv) / uCenterDistance);
  vec2 screen = gl_FragCoord.xy / uResolution.y;
  float veils = fbm(screen * 2.4 - uVeilTravel);
  float gusts = fbm(screen * 0.8 - uVeilTravel * 0.45 + 13.0);
  return clamp(uWhiteout * mix(0.42, 0.86, far) * (0.6 + 0.5 * veils + 0.3 * gusts), 0.0, 0.93);
}

// One layer of falling grain: a speck in some cells of a grid that slides along the fall.
float grainLayer(vec2 frag, float cell, float speed, float density, float seed) {
  vec2 p = (frag - uFallTravel * speed) / cell;
  vec2 id = floor(p);
  if (hash12(id + seed) > density) return 0.0;
  vec2 centre = vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.7)) * 0.6 + 0.2;
  float radius = 0.16 + 0.1 * hash12(id + seed + 11.0);
  return 1.0 - smoothstep(radius - 0.12, radius + 0.04, length(fract(p) - centre));
}

// Wind streaks: hairlines in lanes along the fall, each a short dash racing down its lane.
float streaks(vec2 frag, float density) {
  vec2 fall = normalize(vec2(uSlant, -1.0));
  vec2 across = vec2(-fall.y, fall.x);
  float laneWidth = 11.0 * uPixelRatio;
  float lane = floor(dot(frag, across) / laneWidth);
  float offset = abs(fract(dot(frag, across) / laneWidth) - 0.5) * laneWidth;
  float period = 520.0 * uPixelRatio;
  float along = (dot(frag, fall) - uStreakTravel * (900.0 + 500.0 * hash12(vec2(lane, 2.0))) * uPixelRatio) / period + hash12(vec2(lane, 9.0)) * 13.0;
  float dash = fract(along);
  float dashLength = 0.06 + 0.08 * hash12(vec2(lane, floor(along)));
  float on = step(hash12(vec2(lane * 1.7, floor(along))), density);
  float ends = smoothstep(0.0, 0.01, dash) * (1.0 - smoothstep(dashLength - 0.02, dashLength, dash));
  return on * ends * (1.0 - smoothstep(0.25 * uPixelRatio, 0.75 * uPixelRatio, offset));
}

// Falling snow shows against whatever is behind it: grey grain over the white, white over the dark.
vec3 fallingSnow(vec3 color) {
  if (uSnowfall < 0.01) return color;
  vec2 frag = gl_FragCoord.xy;
  float grain = max(grainLayer(frag, 6.0 * uPixelRatio, 70.0 * uPixelRatio, 0.45 * uSnowfall, 1.0), grainLayer(frag, 9.0 * uPixelRatio, 120.0 * uPixelRatio, 0.3 * uSnowfall, 5.0));
  float streak = streaks(frag, smoothstep(6.0, 18.0, uWindSpeed) * 0.35 * uSnowfall);
  float light = dot(color, vec3(0.3, 0.59, 0.11));
  vec3 speck = light > 0.55 ? mix(color, uInk, 0.42) : vec3(0.97);
  color = mix(color, speck, grain * 0.85);
  return mix(color, light > 0.55 ? mix(color, uInk, 0.3) : vec3(0.92), streak * 0.7);
}

void main() {
  vec3 color = breathe(texture(tBase, vUv));
  vec4 home = homeState(objectId(vUv));
  float red = home.r;
  float charcoal = step(0.75, home.b) * (1.0 - step(0.001, home.r));
  float night = 1.0 - uDaylight;
  float fog = whiteout(vUv) * (1.0 - 0.85 * red - 0.45 * charcoal);
  vec3 dimmed = mix(color * mix(1.0, NIGHT_PAPER, night), color * mix(1.0, 0.85, night), red);
  color = mix(dimmed, uPaper * mix(1.0, NIGHT_FOG, night), fog);
  vec2 glow = texture(tGlow, vUv).rg;
  float halo = smoothstep(0.0, 0.45, glow.r) * (0.3 + 0.5 * uWhiteout + 0.35 * night) * (1.0 - 0.35 * glow.g * (1.0 - uPulse));
  vec3 warm = mix(uRed, uEmber, 0.22);
  color = mix(color, warm, halo * (1.0 - 0.6 * red));
  color += warm * halo * night * 0.18;
  fragColor = vec4(min(fallingSnow(color), vec3(1.0)), 1.0);
}
`;
