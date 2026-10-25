import { FULLSCREEN_HEADER, GBUFFER_GLSL, NOISE_GLSL, TERRAIN_GLSL } from "../glsl";

// The blizzard's shaders. On a paper map snow can't be added as white: the paper is already white.
// It shows the way a woodblock printer shows it, by what disappears. As the snow deepens the fine
// ink goes (lawn and area tints, trees, paths, minor street lines), roofs take a clean white cap, and
// the dark walls are left to carve the white. Nothing here adds a hue: red belongs to the homes where
// someone needs help.

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

// Drawn into the cached map once per minute. Its alpha is how much of the map's own drawing the snow
// takes away at a pixel; the blend keeps the map's alpha, which carries the red roofs' breathing.
export const SNOW_COVER_FRAGMENT = `
${FULLSCREEN_HEADER}
${GBUFFER_GLSL}
${TERRAIN_GLSL}
${NOISE_GLSL}
${HOME_STATE_GLSL}
uniform sampler2D tNormal;
uniform sampler2D tFootprints;
uniform vec4 uFootprintRegion;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uInkStrength;
uniform float uViewMpp;
uniform float uDepth;
uniform vec2 uWindToward;
// Downwind on the screen, a unit vector with y up.
uniform vec2 uWindScreen;
uniform float uWindSpeed;

float detailAt() {
  return 1.0 - smoothstep(1.4, 4.5, uViewMpp);
}

// How much of the town's fine ink the snow has taken, and how far the roofs' caps have formed.
float buried() {
  return smoothstep(0.02, 0.3, uDepth);
}

float capped() {
  return smoothstep(0.03, 0.15, uDepth);
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

// A few soft hatch curves along a drift's slope, broken so they read as strokes, not contours.
float driftHatch(float drift, vec2 mapXY) {
  if (drift < 0.05) return 0.0;
  float d = drift + (valueNoise(mapXY * 0.7) - 0.5) * 0.08;
  float w = max(fwidth(d), 1e-3);
  float outer = 1.0 - smoothstep(0.6, 1.6, abs(d - 0.32) / w);
  float inner = (1.0 - smoothstep(0.6, 1.6, abs(d - 0.62) / w)) * 0.7;
  return max(outer, inner) * step(0.42, valueNoise(mapXY * 0.35 + 3.0));
}

// A snow-capped roof covers the map's own outline, so the cap draws it again: firm all round, and
// heavier on the downwind side, where the snow overhangs the eave.
float roofOutline(vec2 uv, float idC) {
  vec2 px = vec2(max(1.0, uPixelRatio * 0.8)) / uResolution;
  float depthC = viewDepth(uv);
  float line = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 dir = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(-1.0, 0.0) : i == 2 ? vec2(0.0, 1.0) : vec2(0.0, -1.0);
    vec2 uvN = uv + dir * px;
    if (depthC > viewDepth(uvN) * 1.0015) continue;
    float edge = objectId(uvN) != idC ? 1.0 : surfaceAt(uvN) != SURFACE_ROOF ? 0.8 : 0.0;
    line = max(line, edge);
  }
  float overhang = objectId(uv + uWindScreen * px * 2.0) != idC ? 1.0 : 0.0;
  float detail = detailAt();
  return max(line * mix(0.3, 0.85, detail), overhang * 0.9 * detail);
}

vec4 roofCap(vec2 uv, float idC, float up) {
  float cap = capped() * smoothstep(0.3, 0.62, up);
  return vec4(mix(uPaper, uInk, roofOutline(uv, idC) * uInkStrength), cap);
}

// Walls hold no snow, but the drift banks up the ones facing the wind, with a wavering ink line along
// its top. Above it the wall darkens a touch as the white grows around it.
vec4 wallSnow(vec2 uv, vec3 n, vec2 mapXY) {
  float windy = smoothstep(4.0, 14.0, uWindSpeed);
  vec2 facing = normalize(vec2(n.x, -n.z) + vec2(1e-5));
  float windward = max(0.0, dot(facing, -uWindToward));
  float height = surfaceElevation(uv) - groundElevation(mapXY);
  float along = dot(mapXY, vec2(-facing.y, facing.x));
  float top = uDepth * (0.7 + 2.4 * windward * windy) * (0.7 + 0.6 * valueNoise(vec2(along * 0.4, 1.7)));
  float aa = max(fwidth(height), 0.01);
  float detail = detailAt();
  float banked = (1.0 - smoothstep(top - aa * 0.5, top + aa * 0.5, height)) * detail;
  float rim = (1.0 - smoothstep(0.4, 1.4, abs(height - top) / aa)) * step(0.02, top) * detail;
  float snow = max(banked, rim);
  if (snow > 0.01) return vec4(mix(uPaper, uInk, rim * 0.75 * uInkStrength), snow);
  return vec4(uInk, 0.1 * buried());
}

// Open ground, streets, paths and area tints fade into the white; only a few drift strokes stay,
// against the walls that face the wind, and only close up.
vec4 groundSnow(vec2 mapXY, float surface) {
  float fade = buried() * (surface == SURFACE_WATER_AREA ? 0.6 : 1.0);
  float windy = smoothstep(4.0, 14.0, uWindSpeed);
  float drift = windwardDrift(mapXY, 3.0 + uDepth * 10.0) * windy * smoothstep(0.08, 0.3, uDepth);
  float hatch = driftHatch(drift, mapXY) * smoothstep(0.3, 0.8, detailAt());
  return vec4(mix(uPaper, uInk, hatch * 0.6 * uInkStrength), max(fade, hatch));
}

void main() {
  if (isSky(vUv) || uDepth < 0.004) {
    fragColor = vec4(0.0);
    return;
  }
  float idC = objectId(vUv);
  if (marked(homeState(idC)) > 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 world = worldPosition(vUv, texture(tDepth, vUv).r);
  vec2 mapXY = vec2(world.x, -world.z);
  float surface = surfaceAt(vUv);
  vec3 n = normalize(texture(tNormal, vUv).xyz * 2.0 - 1.0);
  if (surface == SURFACE_ROOF) fragColor = roofCap(vUv, idC, n.y);
  else if (surface == SURFACE_WALL) fragColor = wallSnow(vUv, n, mapXY);
  else if (surface == SURFACE_TREE) fragColor = vec4(uPaper, buried() * 0.85);
  else fragColor = groundSnow(mapXY, surface);
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

// Every frame, full resolution, in place of the canvas: the cached map, breathing as the fire pass
// would; blown snow as an uneven veil toward paper that sweeps through in gusts and never takes more
// than a quarter of the town; after dark only the far edge of the view darkening, like the night sky
// over Hiroshige's snow; and the red homes glowing.
export const ATMOSPHERE_FRAGMENT = `
${FULLSCREEN_HEADER}
${NOISE_GLSL}
uniform sampler2D tBase;
uniform sampler2D tId;
${HOME_STATE_GLSL}
uniform sampler2D tGlow;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uPulse;
uniform float uWhiteout;
uniform float uDaylight;
// How far the gusts have travelled, summed frame by frame on the CPU, so a change in the wind turns
// them instead of throwing them across the screen.
uniform vec2 uVeilTravel;

const float MOST_VEIL = 0.25;
const float NIGHT_SKY = 0.28;

vec3 breathe(vec4 base) {
  return mix(base.rgb, uPaper, base.a * 0.3 * (1.0 - uPulse));
}

float veil() {
  vec2 screen = gl_FragCoord.xy / uResolution.y;
  float gusts = fbm(screen * 1.6 - uVeilTravel);
  float sheets = fbm(screen * 4.0 - uVeilTravel * 1.7 + 7.0);
  return uWhiteout * MOST_VEIL * smoothstep(0.3, 0.75, gusts * 0.7 + sheets * 0.3);
}

float nightSky() {
  return (1.0 - uDaylight) * smoothstep(0.78, 1.0, vUv.y) * NIGHT_SKY;
}

void main() {
  vec3 color = breathe(texture(tBase, vUv));
  vec4 home = homeState(objectId(vUv));
  float red = home.r;
  float charcoal = step(0.75, home.b) * (1.0 - step(0.001, red));
  color = mix(color, uPaper, veil() * (1.0 - red) * (1.0 - 0.5 * charcoal));
  color = mix(color, uInk, nightSky() * (1.0 - red));
  // Two blurs spread one house's mask to a few hundredths, so the glow answers exponentially: a
  // single home still glows, and a street of them doesn't turn into a red sea.
  vec2 glow = 1.0 - exp(-texture(tGlow, vUv).rg * 28.0);
  float halo = glow.r * 0.4 * (1.0 - 0.35 * glow.g * (1.0 - uPulse));
  color = mix(color, mix(uRed, uEmber, 0.22), halo * (1.0 - 0.6 * red));
  fragColor = vec4(color, 1.0);
}
`;
