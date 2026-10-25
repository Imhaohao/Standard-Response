import { FULLSCREEN_HEADER, GBUFFER_GLSL, GROUND_HATCH_GLSL, NOISE_GLSL, TERRAIN_GLSL } from "../glsl";

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
${GROUND_HATCH_GLSL}
uniform sampler2D tNormal;
uniform sampler2D tFootprints;
uniform vec4 uFootprintRegion;
uniform vec2 uResolution;
uniform vec3 uPaper;
uniform vec3 uSnow;
uniform vec3 uInk;
uniform float uInkStrength;
uniform float uViewMpp;
uniform float uDepth;
uniform vec2 uWindToward;
// Downwind on the screen, a unit vector with y up.
uniform vec2 uWindScreen;
uniform float uWindSpeed;
uniform vec4 uTerrainExtent;

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

// The lee of a building upwind: the snow there lies in the building's shadow.
float leeShelter(vec2 p, float reach) {
  float lee = 0.0;
  for (int i = 1; i <= 5; i++) {
    float d = float(i) / 5.0;
    lee = max(lee, footprintAt(p - uWindToward * reach * d) * (1.0 - d * 0.8));
  }
  return lee;
}

// Fresh snow is a cool white, brighter than the cream paper, so a snowfall changes the colour of the
// whole map. Capped roofs are the whitest thing on it; the ground is a hair less white, so a cap
// shows even where a roof is two pixels wide.
vec3 snowWhite() {
  return uSnow;
}

vec3 groundWhite() {
  return uSnow * 0.965;
}

// How far a point is inside a box, in metres; negative outside it.
float insideBy(vec2 p, vec4 box) {
  return min(min(p.x - box.x, box.z - p.x), min(p.y - box.y, box.w - p.y));
}

// The snow thins out with the map's own fade toward the edge of the terrain (edgeFade in shaders.ts),
// so the frame never shows where the data ends.
float withinMap(vec2 mapXY) {
  return smoothstep(0.0, 1500.0, insideBy(mapXY, uTerrainExtent));
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

// A flat roof's triangles face away from the camera, so the G-buffer flips their normal: the cap reads
// how level a roof is, not which way its normal points.
vec4 roofCap(vec2 uv, float idC, float up) {
  float cap = capped() * smoothstep(0.3, 0.62, abs(up));
  return vec4(mix(snowWhite(), uInk, roofOutline(uv, idC) * uInkStrength), cap);
}

// Walls hold no snow, but the drift banks up the ones facing the wind, with a wavering ink line along
// its top. Above it the wall darkens a touch as the white grows around it.
vec4 wallSnow(vec2 uv, vec3 n, vec2 mapXY) {
  float windy = smoothstep(4.0, 14.0, uWindSpeed);
  vec2 facing = normalize(vec2(n.x, -n.z) + vec2(1e-5));
  float windward = max(0.0, dot(facing, -uWindToward));
  float height = surfaceElevation(uv) - groundElevation(mapXY);
  float along = dot(mapXY, vec2(-facing.y, facing.x));
  // Drawn taller than life so a drift reads at the close-ups: up to three and a half metres up a
  // windward wall once the snow is deep.
  float top = clamp(uDepth * (1.5 + 6.0 * windward * windy), 0.0, 3.5) * (0.7 + 0.6 * valueNoise(vec2(along * 0.4, 1.7)));
  float aa = max(fwidth(height), 0.01);
  float detail = detailAt();
  float banked = (1.0 - smoothstep(top - aa * 0.5, top + aa * 0.5, height)) * detail;
  float rim = (1.0 - smoothstep(0.4, 1.4, abs(height - top) / aa)) * step(0.02, top) * detail;
  float snow = max(banked, rim);
  if (snow > 0.01) return vec4(mix(snowWhite(), uInk, rim * 0.75 * uInkStrength), snow);
  return vec4(uInk, 0.2 * buried());
}

// Wind-scoured snow on open ground and parks: soft wavy ridges running across the wind, in patches,
// spaced by the zoom so they stay a few pixels apart and read as snow mass even at the overview.
float scourRidges(vec2 mapXY) {
  float spacing = max(6.0, uViewMpp * 7.0);
  vec2 across = vec2(-uWindToward.y, uWindToward.x);
  float warp = (valueNoise(mapXY / (spacing * 6.0)) - 0.5) * 2.0 + sin(dot(mapXY, across) / (spacing * 4.0)) * 0.4;
  float u = dot(mapXY, uWindToward) / spacing + warp;
  float ridge = smoothstep(0.55, 1.0, sin(u * 6.2832) * 0.5 + 0.5);
  return ridge * smoothstep(0.35, 0.65, valueNoise(mapXY / (spacing * 10.0) + 5.0));
}

// Open ground, streets, paths and area tints fade into the white. What gives the snow its mass is
// what is left: a light hatched shadow in the lee of every building, and close up a few drift strokes
// against the walls that face the wind.
vec4 groundSnow(vec2 mapXY, float surface) {
  float fade = buried() * (surface == SURFACE_WATER_AREA ? 0.6 : 1.0);
  float windy = smoothstep(4.0, 14.0, uWindSpeed);
  float drift = windwardDrift(mapXY, 4.0 + uDepth * 16.0) * windy * smoothstep(0.08, 0.3, uDepth);
  float strokes = driftHatch(drift, mapXY) * smoothstep(0.3, 0.8, detailAt()) * 0.6;
  float lee = leeShelter(mapXY, 5.0 + uDepth * 24.0) * mix(0.5, 1.0, windy) * capped();
  // Close up the lee is hatched; at town scale, where a hatch can't resolve, it is a soft grey tone.
  float shadow = mix(0.22, groundHatch(mapXY, 4.5 * uPixelRatio, 0.7854, 0.3) * 0.45, detailAt()) * lee;
  bool open = surface == SURFACE_TERRAIN || surface > 9.5;
  float ridges = open ? scourRidges(mapXY) * 0.08 * windy * smoothstep(0.1, 0.4, uDepth) : 0.0;
  float ink = max(max(strokes, shadow), ridges);
  return vec4(mix(groundWhite(), uInk, ink * uInkStrength), max(fade, ink));
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
  else if (surface == SURFACE_TREE) fragColor = vec4(groundWhite(), buried() * 0.85);
  else fragColor = groundSnow(mapXY, surface);
  fragColor.a *= withinMap(mapXY);
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
// would; the storm you can feel in a still at its peak, as gust veils (broad soft white bands that
// sweep across on the wind and let the contrast breathe) and driving snow (long, thin, slightly curved
// white streaks with a faint grey underside, in three depths); after dark only the far edge of the
// view darkening, like the night sky over Hiroshige's snow; and the red homes glowing. The weather
// ramps up and down with the storm and never hides the town.
export const ATMOSPHERE_FRAGMENT = `
${FULLSCREEN_HEADER}
${NOISE_GLSL}
uniform sampler2D tBase;
uniform sampler2D tId;
${HOME_STATE_GLSL}
uniform sampler2D tGlow;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform vec3 uPaper;
uniform vec3 uSnow;
uniform vec3 uInk;
uniform vec3 uRed;
uniform vec3 uEmber;
uniform float uPulse;
uniform float uWhiteout;
uniform float uSnowfall;
uniform float uDaylight;
uniform float uSlant;
// Downwind on the screen, a unit vector with y up.
uniform vec2 uWindScreen;
// How far the gusts and the driving snow have travelled, summed frame by frame on the CPU, so a
// change in the wind turns them instead of throwing them across the screen.
uniform vec2 uVeilTravel;
uniform float uViewMpp;
uniform float uStreakTravel;

const float NIGHT_SKY = 0.18;

vec3 breathe(vec4 base) {
  return mix(base.rgb, uPaper, base.a * 0.3 * (1.0 - uPulse));
}

// How hard the storm is blowing, 0 to 1: the scenario's snowfall and visibility together.
float storm() {
  return smoothstep(0.3, 0.8, max(uWhiteout, uSnowfall));
}

// Broad soft areas, a third of the frame or more across, sweeping along the wind: inside one the town
// is 35% of the way to white at the worst, between them about 8%, so the contrast visibly breathes.
float gustVeil() {
  vec2 screen = gl_FragCoord.xy / uResolution.y - uVeilTravel;
  vec2 across = vec2(-uWindScreen.y, uWindScreen.x);
  vec2 p = vec2(dot(screen, uWindScreen) * 0.75, dot(screen, across) * 0.35);
  float broad = valueNoise(p * 1.3 + vec2(0.0, 3.0)) * 0.7 + valueNoise(p * 2.7 + 11.0) * 0.3;
  float gust = smoothstep(0.38, 0.62, broad);
  return mix(0.04, 0.45, gust) * storm();
}

// 0 close up, 1 at town scale: a still of the whole town is seen small (on a phone, half size), so
// there the driving snow is drawn wider and its shadow stronger to read at all.
float townScale() {
  return smoothstep(1.5, 4.0, uViewMpp);
}

vec2 fallDirection() {
  return normalize(vec2(uSlant, -1.0));
}

// One depth of driving snow: lanes along the fall, each holding now and then a thin, soft-ended streak
// that bends a little along the wind. shape is (lane spacing, streak length, width, speed) as shares of
// the frame's height, so the storm reads the same at the overview and close up; each streak's own
// length varies down to half of it. Returns the streak's white body and a faint grey underside.
vec2 streakLayer(vec2 frag, vec4 shape, float density, float seed) {
  float frame = uResolution.y;
  float lane = shape.x * frame;
  float streakLength = shape.y * frame;
  float width = max(shape.z * frame * mix(1.0, 2.4, townScale()), 0.8 * uPixelRatio);
  vec2 dir = fallDirection();
  vec2 across = vec2(-dir.y, dir.x);
  float a = dot(frag, across) / lane;
  float laneId = floor(a);
  float along = dot(frag, dir) - uStreakTravel * shape.w * frame;
  float bend = sin(along / (streakLength * 1.7) + hash12(vec2(laneId, seed)) * 6.28) * 0.18;
  float offset = (fract(a) - 0.5 - bend) * lane;
  float period = streakLength * (3.0 + 4.0 * hash12(vec2(laneId, seed + 1.0)));
  float t = along / period + hash12(vec2(laneId, seed + 2.0)) * 17.0;
  float on = step(hash12(vec2(laneId * 1.31, floor(t) + seed)), density);
  float own = streakLength * (0.5 + 0.5 * hash12(vec2(laneId, floor(t) + seed + 5.0)));
  float s = fract(t) * period;
  float ends = smoothstep(0.0, own * 0.45, s) * (1.0 - smoothstep(own * 0.5, own, s));
  float soft = 0.9 * uPixelRatio + width * 0.6;
  float body = 1.0 - smoothstep(0.0, width * 0.5 + soft, abs(offset));
  float below = across.y > 0.0 ? -1.0 : 1.0;
  float under = 1.0 - smoothstep(0.0, width * 0.5 + soft, abs(offset - below * (width + 1.5 * uPixelRatio)));
  return vec2(body, under) * on * ends;
}

// Fine grain in the air: small soft white specks drifting along the fall.
float grain(vec2 frag, float density) {
  vec2 p = (frag - fallDirection() * uStreakTravel * 0.8 * uResolution.y) / (5.0 * uPixelRatio);
  vec2 id = floor(p);
  if (hash12(id + 41.0) > density) return 0.0;
  vec2 centre = vec2(hash12(id + 3.1), hash12(id + 7.7)) * 0.6 + 0.2;
  return 1.0 - smoothstep(0.06, 0.24, length(fract(p) - centre));
}

// Driving snow as a dense field of fine, low-contrast strokes in three depths, the nearest no longer
// than about 15% of the frame, over a fine grain: it reads as heavy wind-driven snow without any one
// stroke standing out like a scratch on the glass.
vec3 drivingSnow(vec3 color) {
  float blowing = storm();
  if (blowing < 0.01) return color;
  vec2 frag = gl_FragCoord.xy;
  vec2 far = streakLayer(frag, vec4(0.005, 0.035, 0.0009, 0.55), 0.4 * blowing, 1.0);
  vec2 middle = streakLayer(frag, vec4(0.011, 0.075, 0.0014, 0.9), 0.36 * blowing, 7.0);
  vec2 near = streakLayer(frag, vec4(0.024, 0.15, 0.002, 1.4), 0.3 * blowing, 13.0);
  vec2 streak = max(max(far * 0.5, middle * 0.7), near * 0.85);
  color = mix(color, mix(uSnow, uInk, 0.4), streak.y * mix(0.1, 0.32, townScale()));
  color = mix(color, uSnow, streak.x);
  return mix(color, uSnow, grain(frag, 0.12 * blowing) * 0.55);
}

float nightSky() {
  return (1.0 - uDaylight) * smoothstep(0.78, 1.0, vUv.y) * NIGHT_SKY;
}

void main() {
  vec3 color = breathe(texture(tBase, vUv));
  vec4 home = homeState(objectId(vUv));
  float red = home.r;
  float charcoal = step(0.75, home.b) * (1.0 - step(0.001, red));
  color = mix(color, uSnow, gustVeil() * (1.0 - red) * (1.0 - 0.5 * charcoal));
  color = mix(color, uInk, nightSky() * (1.0 - red));
  // The glow answers exponentially: a single home still glows, and a street of them stays a row of
  // homes rather than a red haze.
  vec2 glow = 1.0 - exp(-texture(tGlow, vUv).rg * 12.0);
  float halo = glow.r * 0.24 * (1.0 - 0.35 * glow.g * (1.0 - uPulse));
  color = mix(color, mix(uRed, uEmber, 0.22), halo * (1.0 - 0.6 * red));
  fragColor = vec4(drivingSnow(color), 1.0);
}
`;
