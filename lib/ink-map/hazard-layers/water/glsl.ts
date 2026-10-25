import { FULLSCREEN_HEADER, GBUFFER_GLSL, NOISE_GLSL, TERRAIN_GLSL } from "../glsl";
import type { WaterKind } from "./model";
import { SHELF, SHORE_DISTANCE_SCALE } from "./shore";

// The water, printed like a woodblock over the town: an indigo plate multiplied over the map, so every
// street and wall keeps its ink under shallow water and only deep water hides what is below; a crisp ink
// line wherever the water meets a wall, a roof or the ground; breaking fronts drawn the Great Wave's way,
// with a dark face, a ragged crest of hooked fingers, spray and torn foam behind; current as tapered
// strokes laid along the flow; debris as ink flecks riding it. One fullscreen pass, blended over the
// finished map every frame, with no render targets of its own.

export const MAX_BREACHES = 2;
export const MAX_WAVES = 6;

const DEFINES: Record<WaterKind, string> = { flood: "#define FLOOD", surge: "#define SURGE", tsunami: "#define TSUNAMI" };

const UNIFORMS = `
uniform sampler2D tBase;
uniform sampler2D tBuildingState;
uniform sampler2D tShore;
uniform vec4 uShoreRegion;
uniform sampler2D tArrival;
uniform vec4 uArrivalRegion;
uniform float uArrivalLast;
uniform float uArrivalOffset;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uTime;
uniform float uMinutes;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uIndigo;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uPatternScale;
uniform float uViewMpp;
uniform vec4 uTerrainExtent;
uniform vec2 uRegistration;
uniform float uShift;
uniform float uBasin;
uniform float uStanding;
uniform float uRising;
uniform vec4 uBreaches[${MAX_BREACHES}];
uniform vec4 uBreachAxes;
uniform vec4 uWaves[${MAX_WAVES}];
uniform float uWaveCount;
uniform vec4 uTrain;
uniform vec2 uCelerity;
uniform vec4 uWind;
uniform vec2 uSwellToward;
uniform vec3 uRain;
`;

const COMMON = `
const float PI = 3.14159265;
const float REST_LEVEL = 0.0;
const float SHORE_DISTANCE_SCALE = ${SHORE_DISTANCE_SCALE};
const float NEVER = 1e4;

// Metres on the ground that a number of device pixels cover at the middle of the view, so marks keep
// their printed size at any zoom.
float px(float devicePixels) {
  return devicePixels * uViewMpp;
}

float aaStep(float x) {
  return clamp(x / max(fwidth(x), 1e-5) + 0.5, 0.0, 1.0);
}

// A line along x = 0, about widthPx device pixels wide.
float inkLine(float x, float widthPx) {
  float distancePx = abs(x) / max(fwidth(x), 1e-5);
  float halfPx = max(widthPx * 0.5, 0.35);
  return 1.0 - smoothstep(halfPx - 0.5, halfPx + 0.5, distancePx);
}

// Coverage of a shape from its signed size in metres (positive inside), smoothed over about a pixel.
float filled(float metres) {
  return smoothstep(-px(0.6), px(0.6), metres);
}

vec4 over(vec4 below, vec3 color, float alpha) {
  float a = alpha + below.a * (1.0 - alpha);
  vec3 c = (color * alpha + below.rgb * below.a * (1.0 - alpha)) / max(a, 1e-4);
  return vec4(c, a);
}

// Sharp-crested noise: value noise folded about its middle, so its peaks come to points.
float ridged(vec2 p) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 3; i++) {
    sum += (1.0 - abs(valueNoise(p) * 2.0 - 1.0)) * amp;
    p = p * 2.13 + 5.3;
    amp *= 0.5;
  }
  return sum;
}

// Water before the disaster at a point (0..1), and metres to its shore, positive out over the water.
vec2 shoreAt(vec2 xy) {
  vec2 uv = (xy - uShoreRegion.xy) / (uShoreRegion.zw - uShoreRegion.xy);
  vec2 s = texture(tShore, uv).rg;
  float steps = s.g * 255.0 - 128.0;
  return vec2(s.r, sign(steps) * steps * steps * SHORE_DISTANCE_SCALE);
}

// The way to the nearest shore over the water, and on inland from it over the land.
vec2 towardShore(vec2 xy) {
  float e = 40.0;
  float dx = shoreAt(xy + vec2(e, 0.0)).y - shoreAt(xy - vec2(e, 0.0)).y;
  float dy = shoreAt(xy + vec2(0.0, e)).y - shoreAt(xy - vec2(0.0, e)).y;
  vec2 g = vec2(dx, dy);
  return length(g) > 1e-3 ? -normalize(g) : vec2(0.0);
}

// The bed under standing water is a smooth shelf falling away from the shore, never the terrain's
// bathymetry: offshore it is stitched from sources whose seams and tiles would otherwise bare as squares
// or draw a drawn-back sea's edge as a straight line.
float bedAt(vec2 xy, vec2 shore) {
  float ground = groundElevation(xy);
  float shelf = REST_LEVEL - min(${SHELF.shore} + max(shore.y, 0.0) * ${SHELF.slope}, ${SHELF.deepest.toFixed(1)});
  return mix(ground, min(ground, shelf), smoothstep(-12.0, 0.0, shore.y)) * (1.0 - smoothstep(0.0, 12.0, shore.y)) + shelf * smoothstep(0.0, 12.0, shore.y);
}

float buildingRed(vec2 uv) {
  float index = buildingAt(uv);
  if (index < 0.0) return 0.0;
  return texelFetch(tBuildingState, ivec2(int(mod(index, 256.0)), int(floor(index / 256.0))), 0).r;
}

float insideBy(vec2 p, vec4 box) {
  return min(min(p.x - box.x, box.z - p.x), min(p.y - box.y, box.w - p.y));
}

bool isGround(float surface) {
  return surface == SURFACE_TERRAIN || surface == SURFACE_ROAD || surface > 9.5;
}
`;

// The scenario's fronts as minutes, stored less an offset so half floats keep a fraction of a minute's
// precision this late in the night. NEVER everywhere no front reaches.
const ARRIVAL = `
float arrivalAt(vec2 mapXY) {
  vec2 uv = (mapXY - uArrivalRegion.xy) / (uArrivalRegion.zw - uArrivalRegion.xy);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return NEVER;
  float m = texture(tArrival, uv).r + uArrivalOffset;
  return m > uArrivalLast + 0.5 ? NEVER : m;
}

// The way the water's edge moved through a point (down the arrival field's slope) and its speed in
// metres a minute; zero speed where no front passes.
vec3 frontFlow(vec2 xy) {
  float e = max((uArrivalRegion.z - uArrivalRegion.x) / float(textureSize(tArrival, 0).x) * 1.5, 6.0);
  float a = arrivalAt(xy + vec2(e, 0.0));
  float b = arrivalAt(xy - vec2(e, 0.0));
  float c = arrivalAt(xy + vec2(0.0, e));
  float d = arrivalAt(xy - vec2(0.0, e));
  if (max(max(a, b), max(c, d)) >= NEVER) return vec3(0.0, 1.0, 0.0);
  vec2 g = vec2(a - b, c - d) / (2.0 * e);
  float slope = length(g);
  if (slope < 1e-4) return vec3(0.0, 1.0, 0.0);
  return vec3(g / slope, 1.0 / slope);
}
`;

// Flood and surge: one level over the reached ground, standing water at its own level, and through an
// open breach a surface sloping down from the canal's level to the basin's. The surge adds a swell.
const STILL_LEVEL = `
float swellPhase(vec2 xy) {
  float wavelength = max(46.0, px(26.0));
  float warp = (valueNoise(xy / (wavelength * 4.3)) - 0.5) * 2.6 + (valueNoise(xy / (wavelength * 1.3) + 11.0) - 0.5) * 0.6;
  return dot(xy, uSwellToward) / wavelength - uTime * px(18.0) / wavelength + warp;
}

// The swell's lift on the level: up to a third of a metre just behind each crest, more in a stronger wind.
float swellLift(vec2 xy) {
#ifdef SURGE
  float behind = 1.0 - fract(swellPhase(xy));
  float strength = clamp(uWind.z / 18.0, 0.25, 1.0);
  return 0.35 * strength * (exp(-behind * 5.0) - 0.25);
#else
  return 0.0;
#endif
}

float pouredLevel(vec2 xy) {
  float level = uBasin;
  for (int i = 0; i < ${MAX_BREACHES}; i++) {
    vec4 breach = uBreaches[i];
    if (breach.z <= uBasin) continue;
    level = max(level, breach.z - (breach.z - uBasin) * smoothstep(0.0, breach.w, distance(xy, breach.xy)));
  }
  return level;
}

float levelAt(vec2 xy, float standing, float minutes) {
  return mix(pouredLevel(xy), max(uStanding, pouredLevel(xy)), standing) + swellLift(xy);
}
`;

// A tsunami: each crest's shape over time, mirrored from model.ts waveShape, travelling up the bay.
const WAVE_LEVEL = `
float waveShape(float since, vec4 wave) {
  float drawdown = -wave.w * smoothstep(-0.55 * wave.z, -0.2 * wave.z, since);
  float crest = wave.y * (1.0 - smoothstep(0.12 * wave.z, 0.5 * wave.z, since));
  return mix(drawdown, crest, smoothstep(-0.6, 0.0, since));
}

float metresInland(vec2 xy) {
  return max(0.0, -shoreAt(xy).y);
}

float crestDelay(vec2 xy) {
  float travelled = dot(xy - uTrain.zw, uTrain.xy);
  float inland = metresInland(xy);
  return (travelled - inland) / uCelerity.x + inland / uCelerity.y;
}

float levelAt(vec2 xy, float standing, float minutes) {
  float delay = crestDelay(xy);
  float eta = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (float(i) >= uWaveCount) break;
    eta += waveShape(minutes - uWaves[i].x - delay, uWaves[i]);
  }
  return eta + uShift;
}

// The crest that last passed here or is about to: minutes since its front went by (negative while it is
// still coming) and its run-up.
vec2 latestCrest(vec2 xy) {
  float delay = crestDelay(xy);
  vec2 latest = vec2(-NEVER, 0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (float(i) >= uWaveCount) break;
    float since = uMinutes - uWaves[i].x - delay;
    if (since > -2.0 && (latest.x < -2.0 || since < latest.x)) latest = vec2(since, uWaves[i].y);
  }
  return latest;
}
`;

// Everything about the water at one pixel. The view ray stops at the town; where that point is under the
// water's surface, the ray crossed the surface first, and that crossing is what the pixel shows.
const WATER_AT = `
struct Water {
  float cover;
  float column;
  float path;
  float gap;
  float since;
  float sheen;
  float bared;
  float standing;
  float shore;
  float level;
  float reachable;
  float island;
  float building;
  vec2 at;
};

Water waterAt(vec2 uv) {
  Water water;
  float depth = texture(tDepth, uv).r;
  vec3 p = worldPosition(uv, depth);
  vec2 xy = vec2(p.x, -p.z);
  vec2 shore = shoreAt(xy);
  // The edge of standing water comes from the distance field, which interpolates to a smooth shoreline,
  // never from the mask's grid cells. Along a coast, low ground just inland is sea too whenever the level
  // stands over it, so a beach goes under with the surge pixel by pixel; a levee's ward never does.
  float standing = smoothstep(-12.0, 12.0, shore.y);
#ifdef FLOOD
  float seaward = standing;
#elif defined(SURGE)
  float seaward = smoothstep(-160.0, -120.0, shore.y);
#else
  float seaward = smoothstep(-60.0, -20.0, shore.y);
#endif
  float level = levelAt(xy, standing, uMinutes);
  float surfaceCode = surfaceAt(uv);
  float ground = isGround(surfaceCode) ? 1.0 : 0.0;
  float building = surfaceCode == SURFACE_WALL || surfaceCode == SURFACE_ROOF ? 1.0 : 0.0;
  float drawn = p.y + uBaseElevation;
  float bed = mix(drawn, min(drawn, bedAt(xy, shore)), ground);
  water.gap = level - bed;
  vec3 eye = uCameraWorld[3].xyz;
  float plane = level - uBaseElevation;
  vec3 surface = p;
  if (standing < 0.5 && p.y < plane && eye.y > plane) surface = mix(eye, p, (plane - eye.y) / (p.y - eye.y));
  water.at = vec2(surface.x, -surface.z);
  water.path = max(length(p - surface), standing * max(water.gap, 0.0) * 1.4);
  float arrival = arrivalAt(water.at);
  water.reachable = 1.0 - step(NEVER * 0.5, arrival);
  float reachedLand = aaStep(uMinutes - arrival) * water.reachable;
  float under = aaStep(water.gap);
  water.cover = under * max(seaward, reachedLand);
  water.column = level - bedAt(water.at, shoreAt(water.at));
  water.since = mix(mix(-NEVER, uMinutes - arrival, water.reachable), NEVER, standing);
  water.sheen = (1.0 - under) * reachedLand * (1.0 - standing) * ground;
  water.bared = (1.0 - under) * standing * ground;
  water.building = building;
  water.island = building * (1.0 - under) * max(reachedLand, standing) * smoothstep(0.1, 0.4, level - groundElevation(xy));
  water.standing = standing;
  water.shore = shore.y;
  water.level = level;
  return water;
}
`;

// Tone printed on the town the way the composite prints it: laid out in the camera's right and up,
// measured in metres, so a dot stays put on the water while the map pans.
const PRINT = `
vec2 gPattern;
float gPatternWidth;

void placePattern(vec3 world) {
  gPattern = vec2(dot(world, uCamRight), dot(world, uCamUp)) * uPatternScale;
  vec2 width = fwidth(gPattern);
  gPatternWidth = max(width.x, width.y);
}

float dotTone(float coverage) {
  if (coverage <= 0.001) return 0.0;
  float cell = 3.4 * 1.4142 * uPixelRatio;
  vec2 f = fract(mat2(0.7071, -0.7071, 0.7071, 0.7071) * gPattern / cell) - 0.5;
  float r = sqrt(coverage / PI);
  float aa = max(0.75 * gPatternWidth / cell, 1e-3);
  float dots = 1.0 - smoothstep(r - aa, r + aa, length(f));
  return mix(dots, coverage, smoothstep(0.45, 0.8, gPatternWidth / cell));
}

// Water over the land darkens with depth as a woodblock's graded wash (bokashi), from a pale tint at the
// waterline to a mid indigo over the eaves.
float plateTone(float column) {
  return 0.1 + 0.55 * (1.0 - exp(-max(column, 0.0) / 2.2));
}

// How much of a pixel of the drawn town is ink rather than tone: outlines and street edges, not the
// screentone of a roof or a yard.
float strongInk(vec3 town) {
  float darkness = 1.0 - dot(town, vec3(0.3, 0.59, 0.11)) / dot(uPaper, vec3(0.3, 0.59, 0.11));
  return smoothstep(0.32, 0.55, darkness);
}

// Standing water (the sea, a bay, a canal) is one pale plate that darkens gently offshore, so the new
// water over the land is what the eye finds.
float seaTone(float offshore) {
  return 0.2 + 0.16 * smoothstep(0.0, 900.0, offshore);
}

// Ink that didn't take: a soft mottle and a few bare specks of paper in the wash.
float pigment() {
  float mottle = valueNoise(gPattern / (6.0 * uPixelRatio));
  float bare = step(0.982, hash12(floor(gPattern / (1.5 * uPixelRatio))));
  return (0.88 + 0.12 * mottle) * (1.0 - 0.4 * bare);
}
`;

// A breaking front, drawn the Great Wave's way. \`behind\` is metres back from where the front stands
// (negative ahead of it), \`along\` metres along it, \`width\` how deep the white crest is. The leading edge
// is torn into hooked fingers of every size, curling further the further they reach; behind it the foam
// stays solid for about a crest's depth, then tears into patches and streaks drawn out along the travel,
// thinning with distance. Ahead of it the wave's face is dark.
const BREAKER = `
struct Breaker { float foam; float face; };

Breaker breaker(vec2 xy, float behind, float along, float width, float seed, float tail) {
  Breaker b;
  float lean = clamp(-behind / width, 0.0, 2.0);
  float fingers = ridged(vec2(along / (width * 1.7) + lean * 0.45, seed * 1.7));
  float reach = width * (0.1 + 1.6 * fingers * fingers * fingers);
  float edge = behind + reach;
  vec2 streak = vec2(along / (width * 0.8), behind / (width * 3.2) - uTime * 0.12);
  float torn = fbm(streak + seed * 3.1) * 0.8 + valueNoise(xy / (width * 1.6) + seed) * 0.25;
  float thinning = smoothstep(width * 0.7, width * tail, behind);
  float holes = smoothstep(0.62, 0.8, valueNoise(xy / (width * 0.33) + seed * 2.3 + vec2(uTime * 0.2, 0.0)));
  float solid = width * (0.85 - holes * 0.9) - behind;
  float beyondTail = smoothstep(width * tail, width * (tail + 1.0), behind);
  float patches = (torn - 0.47 - 0.4 * thinning) * width * 1.5 - beyondTail * width * 4.0;
  b.foam = min(edge, max(solid, patches));
  b.face = exp(min(edge, 0.0) / (width * 1.3)) * step(edge, 0.0);
  return b;
}

// Spray: flecks drawn out along the travel, thrown \`ahead\` metres in front of a crest and trailing
// behind it, of many sizes, each in its own place.
float spray(vec2 xy, vec2 dir, float density, float seed) {
  float cell = max(4.0, px(5.0));
  vec2 across = vec2(-dir.y, dir.x);
  vec2 q = vec2(dot(xy, dir), dot(xy, across)) / cell;
  vec2 id = floor(q);
  vec2 f = fract(q) - 0.5 - (vec2(hash12(id + seed + 3.7), hash12(id + seed + 9.1)) - 0.5) * 0.6;
  float size = px(0.7) * (0.4 + 1.3 * hash12(id + seed + 5.5) * hash12(id + seed + 6.1));
  float distanceToFleck = length(vec2(f.x * cell / 2.4, f.y * cell)) - size;
  return filled(-distanceToFleck) * step(hash12(id + seed), density);
}
`;

// What the water carries. Current is one stroke per cell at most, anchored at a random point and laid
// along the flow at the pixel, so a stroke bends with the water; it tapers at both ends, drifts with the
// flow and fades over its life. Fast water gets more, longer and heavier strokes; still water almost none.
const MOTION = `
// A stroke stays within a third of a cell of its anchor, and anchors sit in the middle of their cells, so
// the nine cells around a pixel hold every stroke that can touch it and none is ever cut at a cell edge.
// \`density\` is the share of cells with a stroke; \`reach\` stretches them (1 is about a third of a cell).
float flowStrokes(vec2 xy, vec2 dir, float strength, float density, float reach, float seed) {
  float cell = max(30.0, px(36.0));
  vec2 across = vec2(-dir.y, dir.x);
  vec2 base = floor(xy / cell);
  float ink = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      float h = hash12(id + seed);
      float period = 3.0 + 4.0 * hash12(id + seed + 4.4);
      float life = fract(uTime / period + h * 13.0);
      vec2 anchor = (id + 0.25 + 0.5 * vec2(hash12(id + seed + 1.3), hash12(id + seed + 7.9))) * cell;
      float turn = (hash12(id + seed + 3.3) - 0.5) * 0.5;
      vec2 own = vec2(dir.x * cos(turn) - dir.y * sin(turn), dir.x * sin(turn) + dir.y * cos(turn));
      vec2 ownAcross = vec2(-own.y, own.x);
      vec2 centre = anchor + own * (life - 0.5) * cell * 0.08;
      float spread = hash12(id + seed + 2.2);
      float len = cell * (0.14 + 0.48 * spread * spread) * clamp(reach, 0.4, 1.3);
      vec2 d = xy - centre;
      float t = dot(d, own) / len + 0.5;
      float weight = px(0.3 + 0.8 * hash12(id + seed + 6.6) * hash12(id + seed + 8.1)) * (0.7 + 0.7 * strength);
      float halfWidth = weight * pow(sin(PI * clamp(t, 0.0, 1.0)), 0.7);
      float stroke = filled(halfWidth - abs(dot(d, ownAcross))) * step(0.0, t) * step(t, 1.0);
      ink = max(ink, stroke * step(h, density) * sin(PI * life));
    }
  }
  return ink;
}

float debris(vec2 xy, vec2 dir, float amount, float pxPerSecond) {
  float cell = max(10.0, px(9.0));
  vec2 moved = xy - dir * uTime * px(pxPerSecond);
  vec2 id = floor(moved / cell);
  vec2 local = fract(moved / cell) - 0.5;
  float h = hash12(id + 31.0);
  vec2 offset = (vec2(hash12(id + 3.0), hash12(id + 9.0)) - 0.5) * 0.45;
  float angle = hash12(id + 13.0) * 6.2832 + uTime * 0.4 * (h - 0.5);
  vec2 q = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * (local - offset) * cell;
  vec2 halfSize = vec2(px(1.6), px(0.55)) * (0.5 + 0.9 * hash12(id + 21.0));
  vec2 outside = abs(q) - halfSize;
  float box = length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0);
  return filled(-box) * step(h, amount);
}

// On still water, now and then a slow ripple: one short arc that widens and fades, each its own size.
float stillRipples(vec2 xy, float stillness) {
  float cell = max(36.0, px(40.0));
  vec2 id = floor(xy / cell);
  float h = hash12(id + 5.0);
  vec2 centre = (id + 0.25 + 0.5 * vec2(hash12(id + 1.0), hash12(id + 2.0))) * cell;
  float period = 6.0 + 6.0 * hash12(id + 3.0);
  float life = fract(uTime / period + h * 7.0);
  vec2 d = xy - centre;
  float radius = cell * (0.06 + 0.22 * life) * (0.6 + 0.8 * hash12(id + 8.0));
  float facing = dot(normalize(d + 1e-4), normalize(vec2(hash12(id + 4.0), hash12(id + 6.0)) - 0.5 + 1e-4));
  float arc = smoothstep(0.2, 0.55, facing);
  float ring = filled(px(0.45) - abs(length(d) - radius));
  return ring * arc * (1.0 - life) * smoothstep(0.0, 0.15, life) * step(h, 0.16) * stillness;
}
`;

// Which way the water runs at a point and how hard (0..1), per kind.
const FLOOD_FLOW = `
// How close the nearest open breach is (1 at the gap, 0 past its reach), how hard it pours, and the way out of it.
vec4 breachPull(vec2 xy) {
  vec4 best = vec4(0.0, 0.0, 0.0, 1.0);
  for (int i = 0; i < ${MAX_BREACHES}; i++) {
    vec4 breach = uBreaches[i];
    if (breach.z <= uBasin) continue;
    vec2 d = xy - breach.xy;
    float near = 1.0 - smoothstep(0.0, breach.w * 2.2, length(d));
    float head = clamp((breach.z - uBasin) / 1.5, 0.0, 1.0);
    if (near * head > best.x * best.y) best = vec4(near, head, length(d) > 0.01 ? normalize(d) : vec2(0.0, 1.0));
  }
  return best;
}

// Around the open breach that pours hardest: metres from the gap, the angle off the jet's axis (straight
// into the ground the water floods), how near (1 at the gap) and how hard it pours.
vec4 breachJet(vec2 xy) {
  vec4 best = vec4(1e5, 0.0, 0.0, 0.0);
  float strongest = 0.0;
  for (int i = 0; i < ${MAX_BREACHES}; i++) {
    vec4 breach = uBreaches[i];
    if (breach.z <= uBasin) continue;
    vec2 d = xy - breach.xy;
    float r = length(d);
    vec2 axis = i == 0 ? uBreachAxes.xy : uBreachAxes.zw;
    if (length(axis) < 0.5) continue;
    float near = 1.0 - smoothstep(0.0, breach.w * 1.2, r);
    float head = clamp((breach.z - uBasin) / 1.5, 0.0, 1.0);
    if (near * head <= strongest) continue;
    strongest = near * head;
    vec2 outward = r > 0.01 ? d / r : axis;
    best = vec4(r, atan(axis.x * outward.y - axis.y * outward.x, dot(axis, outward)), near, head);
  }
  return best;
}

vec4 flowAt(Water key) {
  vec3 flow = frontFlow(key.at);
  vec4 pull = breachPull(key.at);
  vec2 dir = normalize(mix(flow.xy, pull.zw, pull.x) + 1e-4);
  float fresh = (1.0 - smoothstep(5.0, 45.0, key.since)) * step(0.0, key.since);
  float rising = clamp(uRising / 0.04, 0.0, 1.0) * key.reachable;
  return vec4(dir, clamp(max(max(fresh, pull.x * pull.y), rising * 0.3), 0.0, 1.0), flow.z);
}
`;

const SURGE_FLOW = `
vec4 flowAt(Water key) {
  vec3 flow = frontFlow(key.at);
  float fresh = (1.0 - smoothstep(10.0, 60.0, key.since)) * step(0.0, key.since);
  vec2 dir = normalize(mix(uSwellToward, flow.xy, fresh * 0.6) + 1e-4);
  float wind = clamp(uWind.z / 24.0, 0.0, 1.0);
  float nearShore = 1.0 - smoothstep(150.0, 1000.0, abs(key.shore));
  return vec4(dir, clamp(max(fresh, wind * mix(0.2, 0.75, nearShore)), 0.0, 1.0), flow.z);
}
`;

const TSUNAMI_FLOW = `
// Fast where a crest has just passed and where water runs up over the land or drains back off it; the
// open bay between crests barely moves.
vec4 flowAt(Water key) {
  float rise = levelAt(key.at, key.standing, uMinutes + 0.25) - levelAt(key.at, key.standing, uMinutes - 0.25);
  vec2 crest = latestCrest(key.at);
  float churn = (1.0 - smoothstep(0.0, 8.0, crest.x)) * step(0.0, crest.x) * clamp(crest.y / 4.0, 0.3, 1.0);
  float flowing = clamp(abs(rise) / 0.6, 0.0, 1.0);
  float nearShore = 1.0 - smoothstep(100.0, 900.0, key.shore);
  vec2 inward = normalize(uTrain.xy + towardShore(key.at) * nearShore * 1.4 + 1e-4);
  vec2 dir = rise >= 0.0 ? inward : -inward;
  return vec4(dir, max(max(churn, flowing * (1.0 - key.standing)), flowing * 0.3), 0.0);
}
`;

const SURFACE_MARKS = `
// The plate multiplies the town. Under the water the town keeps its ink and loses its tone: outlines and
// street edges print through, the screentone of roofs and yards does not, and deep water hides even the ink.
vec4 printWater(vec4 ink, Water plate, Water key, vec2 uv) {
  float red = buildingRed(uv);
  float tone = mix(plateTone(plate.column), seaTone(plate.shore), plate.standing);
  vec3 wash = mix(uPaper, uIndigo, tone);
  vec3 town = texture(tBase, uv).rgb;
  float hidden = mix(smoothstep(0.8, 4.5, key.path) * 0.85, 1.0, key.standing);
  vec3 printed = mix(wash, town * 0.9 * (wash / uPaper), strongInk(town) * (1.0 - hidden));
  ink = over(ink, printed, plate.cover * mix(pigment(), 1.0, plate.standing) * mix(1.0, 0.35, red));
  float coverage = (0.02 + 0.12 * smoothstep(1.0, 6.0, plate.column)) * (1.0 - plate.standing);
  ink = over(ink, mix(uIndigo, uInk, 0.35), dotTone(coverage) * plate.cover * 0.35 * mix(1.0, 0.3, red));
  return ink;
}

// A building standing in the water is an island: a clean paper roof keeping only its ink outline, so it
// breaks the surface instead of reading as a dark speck. A roof waiting on a ride keeps its red.
vec4 printIslands(vec4 ink, Water key, vec2 uv) {
  vec3 town = texture(tBase, uv).rgb;
  vec3 clean = mix(uPaper, town * 0.85, strongInk(town));
  return over(ink, clean, key.island * (1.0 - buildingRed(uv)) * 0.95);
}

// Ground the water reached and has left keeps a darker, mottled sheen.
vec4 printWetGround(vec4 ink, Water key, vec2 uv) {
  vec3 town = texture(tBase, uv).rgb;
  float mottle = valueNoise(key.at / 18.0);
  return over(ink, town * mix(vec3(1.0), uIndigo / uPaper, 0.25) * 0.93, key.sheen * (0.6 + 0.4 * mottle));
}

// Seabed the drawn-back sea has laid bare: wet sand stippled in ink, thicker in some places than others,
// with pools left in the hollows.
vec4 printBaredBed(vec4 ink, Water key) {
  float mottle = valueNoise(key.at / 30.0) * 0.6 + valueNoise(key.at / 9.0) * 0.4;
  vec3 sand = mix(uPaper, mix(uInk, uIndigo, 0.3), 0.1 + 0.08 * mottle);
  float density = 0.06 + 0.16 * valueNoise(key.at / 40.0);
  float stipple = step(1.0 - density, hash12(floor(gPattern / (2.2 * uPixelRatio))));
  float pools = smoothstep(0.74, 0.8, valueNoise(key.at / 9.0) * 0.75 + valueNoise(key.at / 3.0) * 0.25);
  ink = over(ink, sand, key.bared * 0.95);
  ink = over(ink, uInk, key.bared * stipple * 0.4);
  ink = over(ink, mix(uPaper, uIndigo, 0.35), key.bared * pools * 0.6);
  return ink;
}

// The key block: one crisp ink line wherever the surface meets a wall, a roof or the ground the water has
// reached, and along the edge the water is advancing over. A house's ring shows once a house is big
// enough on screen to hold one; across a whole town it would only be a speck.
vec4 printWaterline(vec4 ink, Water key) {
  float reached = max(key.standing, aaStep(key.since) * key.reachable);
  float roomy = 1.0 - smoothstep(1.4, 3.0, uViewMpp);
  float atTheSurface = 1.0 - smoothstep(0.6, 1.6, abs(key.gap));
  float line = inkLine(key.gap, 1.15 * uPixelRatio) * reached * mix(1.0, roomy, key.building) * atTheSurface;
  float front = inkLine(key.since, 1.15 * uPixelRatio) * aaStep(key.gap) * (1.0 - key.standing) * key.reachable;
  return over(ink, mix(uIndigo, uInk, 0.7), max(line, front) * 0.92);
}

vec4 printFoam(vec4 ink, float foam, float strength) {
  float fill = filled(foam) * strength;
  float edge = inkLine(foam, 1.0 * uPixelRatio) * strength;
  ink = over(ink, uPaper * 1.02, fill * 0.96);
  return over(ink, mix(uIndigo, uInk, 0.6), edge * 0.85);
}

// Current over pale water in deep indigo; over the darkest water in pale lines, as the woodblock cuts them.
vec4 printCurrent(vec4 ink, Water key, vec4 flow, float density, float reach, float seed) {
  float strokes = flowStrokes(key.at, flow.xy, flow.z, density, reach, seed) * key.cover;
  vec3 color = mix(mix(uIndigo, uInk, 0.5), mix(uIndigo, uPaper, 0.35), smoothstep(0.42, 0.52, plateTone(key.column)) * (1.0 - key.standing));
  return over(ink, color, strokes * (0.4 + 0.4 * flow.z));
}
`;

const FLOOD_MARKS = `
// The jet through a breach: thin foam streaks fanning out of the gap along the flow, racing outward,
// fewer and fainter with distance until they are gone a few hundred metres in.
vec4 printJet(vec4 ink, Water key) {
  vec4 jet = breachJet(key.at);
  float pour = jet.z * jet.w;
  float fan = 1.0 - smoothstep(0.45, 1.1, abs(jet.y));
  vec2 q = vec2(jet.y * 38.0, jet.x / max(70.0, px(26.0)) - uTime * 0.7);
  float ridge = 1.0 - abs(valueNoise(q) * 2.0 - 1.0);
  float broken = smoothstep(0.35, 0.6, valueNoise(q * vec2(0.5, 3.0) + 7.7));
  float clear = smoothstep(25.0, 60.0, jet.x);
  float streak = smoothstep(0.93 - 0.08 * pour, 0.98, ridge) * broken * fan * pour * clear;
  return over(ink, uPaper * 1.02, streak * key.cover * (1.0 - key.standing) * 0.85);
}

vec4 printFlow(vec4 ink, Water key, vec2 uv) {
  vec4 flow = flowAt(key);
  ink = printCurrent(ink, key, flow, (0.06 + 0.3 * flow.z * flow.z) * (1.0 - key.standing), 1.3 - 0.5 * flow.z, 0.0);
  float atTheEdge = (1.0 - smoothstep(0.0, 25.0, key.since)) * step(0.0, key.since);
  float roomy = 1.0 - smoothstep(1.0, 2.2, uViewMpp);
  ink = over(ink, uInk, debris(key.at, flow.xy, 0.01 + 0.06 * atTheEdge, 6.0) * key.cover * (1.0 - key.standing) * roomy);
  ink = over(ink, mix(uIndigo, uInk, 0.5), stillRipples(key.at, 1.0 - flow.z) * key.cover * 0.45);
  ink = printJet(ink, key);

  return ink;
}
`;

const SURGE_MARKS = `
vec4 printFlow(vec4 ink, Water key, vec2 uv) {
  vec2 toward = uSwellToward;
  vec2 across = vec2(-toward.y, toward.x);
  float wavelength = max(46.0, px(26.0));
  // Waves break on the shores (the Gulf's and the bay's) and over flooded land. Out on open water the sea
  // is a calm graded plate with sparse wave marks.
  float breaking = max(1.0 - smoothstep(60.0, 320.0, key.shore), 1.0 - key.standing);
  float phase = swellPhase(key.at);
  float crestAhead = floor(phase);
  float ahead = fract(phase) * wavelength;
  float behind = (1.0 - fract(phase)) * wavelength;
  float along = dot(key.at, across);
  float shallow = 1.0 - smoothstep(0.6, 3.5, key.column);
  float present = smoothstep(0.5, 0.62, valueNoise(vec2(along / (wavelength * (0.8 + 1.6 * hash12(vec2(crestAhead, 5.0)))), crestAhead * 7.3))) * breaking;
  float presentNext = smoothstep(0.5, 0.62, valueNoise(vec2(along / (wavelength * (0.8 + 1.6 * hash12(vec2(crestAhead + 1.0, 5.0)))), (crestAhead + 1.0) * 7.3))) * breaking;
  float widthAhead = wavelength * (0.025 + 0.05 * shallow) * (0.5 + 1.0 * hash12(vec2(crestAhead, 3.0)));
  float widthBehind = wavelength * (0.025 + 0.05 * shallow) * (0.5 + 1.0 * hash12(vec2(crestAhead + 1.0, 3.0)));
  Breaker lead = breaker(key.at, -ahead, along, widthAhead, crestAhead, 2.5);
  Breaker trail = breaker(key.at, behind, along, widthBehind, crestAhead + 1.0, 2.5);
  float foam = max(lead.foam - (1.0 - present) * wavelength, trail.foam - (1.0 - presentNext) * wavelength);
  float faceRun = smoothstep(0.45, 0.65, valueNoise(vec2(along / (wavelength * 0.7), crestAhead * 3.1 + 0.5)));
  ink = over(ink, mix(uIndigo, uInk, 0.45), lead.face * present * faceRun * key.cover * (0.06 + 0.1 * hash12(vec2(crestAhead, 9.0))));
  vec2 blown = normalize(toward + uWind.xy * 0.5 + 1e-4);
  ink = over(ink, uPaper, spray(key.at, blown, 0.12 * presentNext * (1.0 - smoothstep(0.0, wavelength * 0.35, ahead)), crestAhead) * key.cover * 0.9);

  float open = key.standing * (1.0 - breaking);
  ink = over(ink, mix(uIndigo, uInk, 0.45), flowStrokes(key.at, across, 0.5, 0.08, 1.2, 41.0) * open * key.cover * 0.45);

  vec4 flow = flowAt(key);
  ink = printCurrent(ink, key, flow, (0.05 + 0.2 * flow.z) * (1.0 - key.standing), 1.0, 11.0);
  float fresh = (1.0 - smoothstep(10.0, 45.0, key.since)) * step(0.0, key.since);
  ink = over(ink, uInk, debris(key.at, flow.xy, 0.01 + 0.1 * fresh, 8.0) * key.cover * (1.0 - key.standing));
  return printFoam(ink, foam, key.cover * smoothstep(0.1, 0.4, key.column + 0.3));
}

// Rain driven across the screen on the wind, in two sheets at different speeds, gusting: some streaks
// long and heavy, most short and fine, thicker in squalls that sweep through.
vec4 printRain(vec4 ink) {
  vec2 dir = uRain.xy;
  vec2 across = vec2(-dir.y, dir.x);
  float squall = 0.35 + 0.65 * smoothstep(0.3, 0.75, valueNoise(gl_FragCoord.xy / (420.0 * uPixelRatio) - dir * uTime * 0.6));
  float streaks = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float near = float(layer);
    float spacing = mix(9.0, 6.0, near) * uPixelRatio;
    float lanePos = dot(gl_FragCoord.xy, across) / spacing;
    float lane = floor(lanePos);
    float lengthPx = mix(14.0, 34.0, near) * uPixelRatio * (0.35 + 1.25 * hash12(vec2(lane, 3.0 + near)));
    float along = dot(gl_FragCoord.xy, dir) - uTime * mix(700.0, 1100.0, near) * uPixelRatio;
    float t = fract(along / (lengthPx * 4.0) + hash12(vec2(lane, 9.0 + near)));
    float drop = floor(along / (lengthPx * 4.0));
    float weight = (0.25 + 0.55 * hash12(vec2(lane, drop + 17.0))) * uPixelRatio;
    float line = 1.0 - smoothstep(weight, weight + 0.6 * uPixelRatio, abs(fract(lanePos) - 0.5) * spacing);
    float falling = step(t, 0.25) * step(1.0 - uRain.z * squall * mix(0.3, 0.5, near), hash12(vec2(lane, drop + near * 31.0)));
    streaks = max(streaks, line * falling * sin(PI * t * 4.0) * mix(0.07, 0.13, near));
  }
  return over(ink, uInk, streaks);
}
`;

const TSUNAMI_MARKS = `
vec4 printFlow(vec4 ink, Water key, vec2 uv) {
  vec2 travel = uTrain.xy;
  vec2 across = vec2(-travel.y, travel.x);
  vec2 crest = latestCrest(key.at);
  float speed = mix(uCelerity.x, uCelerity.y, smoothstep(0.0, 60.0, metresInland(key.at)));
  float behind = crest.x * speed;
  float height = clamp(crest.y / 4.0, 0.25, 1.0);
  float width = max(12.0, px(5.0)) * mix(0.8, 1.5, height);
  Breaker bore = breaker(key.at, behind, dot(key.at, across), width, crest.y * 3.1, mix(6.0, 2.5, smoothstep(0.0, 60.0, metresInland(key.at))));
  float arriving = step(-1.5, crest.x);
  float wet = max(key.cover, key.bared);
  ink = over(ink, mix(uIndigo, uInk, 0.5), bore.face * arriving * key.cover * 0.55 * height);

  vec4 flow = flowAt(key);
  float fast = smoothstep(0.55, 0.9, flow.z);
  ink = printCurrent(ink, key, flow, 0.03 + 0.22 * fast, 1.3 - 0.5 * fast, 23.0);
  float churned = (1.0 - smoothstep(0.0, 12.0, crest.x)) * step(0.0, crest.x);
  ink = over(ink, uInk, debris(key.at, flow.xy, 0.01 + 0.08 * churned * (1.0 - key.standing), 9.0) * key.cover);
  ink = over(ink, mix(uIndigo, uInk, 0.5), stillRipples(key.at, 1.0 - flow.z) * key.cover * key.standing * 0.4);
  float thrown = (1.0 - smoothstep(0.0, width * 4.0, -behind)) * step(behind, 0.0) * 0.6;
  float trailing = smoothstep(width, width * 2.5, behind) * (1.0 - smoothstep(width * 4.0, width * 10.0, behind)) * 0.3;
  float upTheShore = (1.0 - smoothstep(0.0, width * 3.0, -behind)) * step(behind, 0.0) * (1.0 - key.standing);
  ink = over(ink, uPaper, spray(key.at, travel, (thrown + trailing) * height, crest.y) * arriving * max(wet, upTheShore));

  // Water still running over the land tears into foam that streams with it.
  float scale = max(5.0, px(3.0));
  float running = fast * (1.0 - key.standing) * key.cover;
  vec2 q = key.at / scale - flow.xy * uTime * 0.6;
  float torn = (valueNoise(q * vec2(1.0, 0.45)) * 0.7 + valueNoise(q * 2.3 + 3.1) * 0.3 - 0.82) * scale;
  ink = over(ink, uPaper * 1.02, filled(torn) * running * 0.85);
  return printFoam(ink, bore.foam - (1.0 - arriving) * width * 6.0, wet * height);
}
`;

const MAIN = `
void main() {
  if (isSky(vUv)) { fragColor = vec4(0.0); return; }
  Water key = waterAt(vUv);
  Water plate = waterAt(vUv + uRegistration / uResolution);
  placePattern(worldPosition(vUv, texture(tDepth, vUv).r));

  vec4 ink = vec4(uPaper, 0.0);
  ink = printWetGround(ink, key, vUv);
  ink = printBaredBed(ink, key);
  ink = printWater(ink, plate, key, vUv);
  ink = printIslands(ink, key, vUv);
  ink = printFlow(ink, key, vUv);
  ink = printWaterline(ink, key);
#ifdef SURGE
  ink = printRain(ink);
#endif
  float fade = smoothstep(0.0, 1500.0, insideBy(key.at, uTerrainExtent));
  fragColor = vec4(ink.rgb, ink.a * fade);
}
`;

const FLOWS: Record<WaterKind, string> = { flood: FLOOD_FLOW, surge: SURGE_FLOW, tsunami: TSUNAMI_FLOW };
const MARKS: Record<WaterKind, string> = { flood: FLOOD_MARKS, surge: SURGE_MARKS, tsunami: TSUNAMI_MARKS };

export function waterFragment(kind: WaterKind) {
  return [
    FULLSCREEN_HEADER,
    DEFINES[kind],
    GBUFFER_GLSL,
    TERRAIN_GLSL,
    NOISE_GLSL,
    UNIFORMS,
    COMMON,
    ARRIVAL,
    kind === "tsunami" ? WAVE_LEVEL : STILL_LEVEL,
    WATER_AT,
    PRINT,
    BREAKER,
    MOTION,
    FLOWS[kind],
    SURFACE_MARKS,
    MARKS[kind],
    MAIN,
  ].join("\n");
}
