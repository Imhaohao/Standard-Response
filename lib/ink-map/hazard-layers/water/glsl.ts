import { ARRIVAL_GLSL, FULLSCREEN_HEADER, GBUFFER_GLSL, NOISE_GLSL, TERRAIN_GLSL } from "../glsl";
import type { WaterKind } from "./model";
import { SHELF } from "./shore";

// The water, printed like a woodblock: an indigo plate cut into a few flat tints by depth, laid a pixel
// off the key block's ink lines; the town under it showing through shallow water and fading under deep;
// a crisp ink line wherever the water meets a wall, a roof or the ground; foam as hooked white fingers
// with ink edges; current as long strokes; debris as ink flecks riding it. One fullscreen pass, blended
// over the finished map every frame, with no render targets of its own.

export const MAX_BREACHES = 2;
export const MAX_WAVES = 6;

const DEFINES: Record<WaterKind, string> = { flood: "#define FLOOD", surge: "#define SURGE", tsunami: "#define TSUNAMI" };

const UNIFORMS = `
uniform sampler2D tBuildingState;
uniform sampler2D tShore;
uniform vec4 uShoreRegion;
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
const float SHORE_METERS_PER_STEP = 4.0;
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

vec4 over(vec4 below, vec3 color, float alpha) {
  float a = alpha + below.a * (1.0 - alpha);
  vec3 c = (color * alpha + below.rgb * below.a * (1.0 - alpha)) / max(a, 1e-4);
  return vec4(c, a);
}

// Water before the disaster at a point (0..1), and metres to its shore, positive out over the water.
vec2 shoreAt(vec2 xy) {
  vec2 uv = (xy - uShoreRegion.xy) / (uShoreRegion.zw - uShoreRegion.xy);
  vec2 s = texture(tShore, uv).rg;
  return vec2(s.r, (s.g * 255.0 - 128.0) * SHORE_METERS_PER_STEP);
}

// The bed under standing water: the terrain's own bathymetry where it has some, and at least a shelf
// falling away from the shore, so a sea the terrain draws flat still has depth to draw back from.
float bedAt(vec2 xy, vec2 shore) {
  float ground = groundElevation(xy);
  float shelf = REST_LEVEL - min(${SHELF.shore} + max(shore.y, 0.0) * ${SHELF.slope}, ${SHELF.deepest.toFixed(1)});
  return mix(ground, min(ground, shelf), smoothstep(0.35, 0.65, shore.x));
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

// Flood and surge: one level over the reached ground, standing water at its own level, and through an
// open breach a surface sloping down from the canal's level to the basin's. The surge adds a swell.
const STILL_LEVEL = `
float swellPhase(vec2 xy) {
  float wavelength = max(46.0, px(26.0));
  float warp = (valueNoise(xy / (wavelength * 3.1)) - 0.5) * 1.3 + (valueNoise(xy / (wavelength * 0.8) + 11.0) - 0.5) * 0.2;
  return dot(xy, uSwellToward) / wavelength - uTime * px(20.0) / wavelength + warp;
}

// The swell's lift on the level: up to a third of a metre behind each crest, more in a stronger wind.
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

float crestDelay(vec2 xy) {
  float travelled = dot(xy - uTrain.zw, uTrain.xy);
  return travelled < 0.0 ? travelled / uCelerity.x : travelled / uCelerity.y;
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
  float ground;
  vec2 at;
};

Water waterAt(vec2 uv) {
  Water water;
  float depth = texture(tDepth, uv).r;
  vec3 p = worldPosition(uv, depth);
  vec2 xy = vec2(p.x, -p.z);
  vec2 shore = shoreAt(xy);
  float standing = smoothstep(0.35, 0.65, shore.x);
  float level = levelAt(xy, standing, uMinutes);
  bool ground = isGround(surfaceAt(uv));
  float drawn = p.y + uBaseElevation;
  float bed = ground ? min(drawn, bedAt(xy, shore)) : drawn;
  water.gap = level - bed;
  vec3 eye = uCameraWorld[3].xyz;
  float plane = level - uBaseElevation;
  vec3 surface = p;
  if (standing < 0.5 && p.y < plane && eye.y > plane) surface = mix(eye, p, (plane - eye.y) / (p.y - eye.y));
  water.at = vec2(surface.x, -surface.z);
  water.path = max(length(p - surface), standing * max(water.gap, 0.0) * 1.4);
  float arrival = arrivalAt(water.at);
  float reachedLand = aaStep(uMinutes - arrival);
  float under = aaStep(water.gap);
  water.cover = under * max(standing, reachedLand);
  water.column = level - bedAt(water.at, shoreAt(water.at));
  water.since = mix(uMinutes - arrival, NEVER, standing);
  water.sheen = (1.0 - under) * reachedLand * (1.0 - standing) * (ground ? 1.0 : 0.0);
  water.bared = (1.0 - under) * standing * (ground ? 1.0 : 0.0);
  water.standing = standing;
  water.shore = shore.y;
  water.level = level;
  water.ground = ground ? 1.0 : 0.0;
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

// The woodblock's plates: a pale wash where the water is shallow, then darker tints at about knee, chest,
// eave and roof depth. Each boundary wobbles a little, as a hand-cut block does.
float plateTone(float column, vec2 xy) {
  float c = column + (valueNoise(xy / 55.0) - 0.5) * 0.35;
  float tone = 0.2;
  tone += 0.14 * aaStep(c - 0.6);
  tone += 0.16 * aaStep(c - 1.5);
  tone += 0.17 * aaStep(c - 3.0);
  tone += 0.15 * aaStep(c - 6.0);
  return tone;
}

float plateEdges(float column, vec2 xy) {
  float c = column + (valueNoise(xy / 55.0) - 0.5) * 0.35;
  return max(max(inkLine(c - 0.6, 1.0), inkLine(c - 1.5, 1.0)), max(inkLine(c - 3.0, 1.1), inkLine(c - 6.0, 1.2)));
}

// Ink that didn't take: a soft mottle and a few bare specks of paper in the wash.
float pigment() {
  float mottle = valueNoise(gPattern / (6.0 * uPixelRatio));
  float bare = step(0.955, hash12(floor(gPattern / (1.5 * uPixelRatio))));
  return (0.86 + 0.14 * mottle) * (1.0 - 0.55 * bare);
}
`;

// Foam is cut as hooked fingers, the claws of a Hokusai wave, reaching ahead of a breaking edge with a
// small eye of water in each, and a ragged band behind. Positive inside the foam, in metres.
const FOAM = `
float clawFoam(float behind, float along, float spacing, float reach, float band, float seed) {
  float cell = floor(along / spacing);
  float u = fract(along / spacing);
  float tip = reach * (0.55 + 0.45 * hash12(vec2(cell, seed)));
  float lean = clamp(-behind / tip, 0.0, 1.0);
  float hooked = clamp(u - 0.3 * lean * lean, 0.0, 1.0);
  float finger = sqrt(max(sin(PI * hooked), 0.0)) * tip;
  float front = behind + finger;
  float back = band * (0.45 + 0.9 * valueNoise(vec2(along / (spacing * 1.7), seed + uTime * 0.2))) - behind;
  vec2 eye = vec2((0.5 + 0.3 * 0.3) * spacing, -0.55 * tip);
  float eyeHole = length(vec2(u * spacing, behind) - eye) - 0.13 * tip;
  return min(min(front, back), eyeHole);
}

// Specks of spray blown ahead of a breaking edge: \`ahead\` metres in front of it, within \`reach\`.
float spray(vec2 xy, float ahead, float reach) {
  float cell = max(5.0, px(5.0));
  vec2 id = floor(xy / cell);
  vec2 centre = (id + 0.25 + 0.5 * vec2(hash12(id + 3.0), hash12(id + 7.0))) * cell;
  float speck = 1.0 - smoothstep(0.0, px(1.2), length(xy - centre) - px(0.6));
  float density = (1.0 - smoothstep(0.0, reach, ahead)) * step(0.0, ahead);
  return speck * step(1.0 - density * 0.5, hash12(id));
}
`;

// What the water carries: long strokes along the current, ink flecks riding it, and on still water slow
// rings spreading and fading.
const MOTION = `
float currentStrokes(vec2 xy, vec2 dir, float strength, float pxPerSecond) {
  vec2 across = vec2(-dir.y, dir.x);
  float spacing = max(8.0, px(8.0));
  float lanePos = dot(xy, across) / spacing;
  float lane = floor(lanePos);
  float jitter = hash12(vec2(lane, 17.0));
  float along = dot(xy, dir) - uTime * px(pxPerSecond) * (0.7 + 0.6 * jitter);
  float dashLength = spacing * (5.0 + 9.0 * hash12(vec2(lane, 29.0)));
  float dashPos = along / dashLength + jitter;
  float t = fract(dashPos);
  float shown = step(0.4, hash12(vec2(lane, floor(dashPos))));
  float drawn = 0.2 + 0.45 * strength;
  float taper = sin(PI * clamp(t / drawn, 0.0, 1.0));
  float fromLane = (fract(lanePos) - 0.5) / max(fwidth(lanePos), 1e-5);
  float halfWidth = 0.7 * uPixelRatio * taper;
  float line = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.5, abs(fromLane));
  return line * step(t, drawn) * shown * step(0.05, strength);
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
  vec2 halfSize = vec2(px(1.6), px(0.55)) * (0.6 + 0.8 * hash12(id + 21.0));
  vec2 outside = abs(q) - halfSize;
  float box = length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0);
  return (1.0 - smoothstep(-px(0.4), px(0.4), box)) * step(h, amount);
}

float ripples(vec2 xy, float stillness) {
  float cell = max(28.0, px(30.0));
  vec2 id = floor(xy / cell);
  float h = hash12(id + 5.0);
  vec2 centre = (id + 0.3 + 0.4 * vec2(hash12(id + 1.0), hash12(id + 2.0))) * cell;
  float period = 5.0 + 4.0 * hash12(id + 3.0);
  float life = fract(uTime / period + h * 7.0);
  float r = length(xy - centre);
  float rings = 0.0;
  for (int k = 0; k < 2; k++) {
    float radius = cell * (0.06 + 0.3 * life - 0.08 * float(k));
    rings = max(rings, inkLine(r - radius, 0.9 * uPixelRatio) * step(0.0, radius));
  }
  return rings * (1.0 - life) * smoothstep(0.0, 0.12, life) * step(h, 0.3) * stillness;
}

// The scale pattern of the open sea (seigaiha): rows of overlapping arcs, the nearer row on top.
float seigaiha(vec2 xy, float size) {
  vec2 p = xy / size;
  float width = max(fwidth(p.x), fwidth(p.y)) * 8.0;
  float j0 = floor(p.y * 2.0);
  float found = -1.0;
  for (int k = -1; k <= 2; k++) {
    float j = j0 + float(k);
    float shift = mod(j, 2.0) * 0.5;
    vec2 centre = vec2(floor(p.x - shift + 0.5) + shift, j * 0.5);
    float d = length(p - centre);
    if (found < 0.0 && d < 0.5) found = d;
  }
  float rings = fract(found * 8.0 + 0.5) - 0.5;
  return (1.0 - smoothstep(0.6 * width, 1.4 * width, abs(rings))) * step(0.0, found);
}
`;

// Which way the water runs and how hard, per kind.
const FLOW = `
// The way the water's edge moved through a point (down the arrival field's slope) and its speed in metres
// a minute. Points the water never reaches count as reached just after the last front, so the slope stays sane.
vec3 frontFlow(vec2 xy) {
  float e = max((uArrivalRegion.z - uArrivalRegion.x) / float(textureSize(tArrival, 0).x) * 1.5, 6.0);
  float cap = uArrivalLast + 20.0;
  float dx = min(arrivalAt(xy + vec2(e, 0.0)), cap) - min(arrivalAt(xy - vec2(e, 0.0)), cap);
  float dy = min(arrivalAt(xy + vec2(0.0, e)), cap) - min(arrivalAt(xy - vec2(0.0, e)), cap);
  vec2 g = vec2(dx, dy) / (2.0 * e);
  float slope = length(g);
  if (slope < 1e-5) return vec3(0.0, 1.0, 0.0);
  return vec3(g / slope, 1.0 / slope);
}

// How close the nearest open breach is (1 at the gap, 0 past its reach), how hard it pours, and the way out of it.
vec4 breachPull(vec2 xy) {
  vec4 best = vec4(0.0);
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
`;

const SURFACE_MARKS = `
vec4 printWater(vec4 ink, Water plate, Water key, vec2 uv) {
  vec3 deep = mix(uIndigo, uInk, 0.35);
  float red = buildingRed(uv);
  float clarity = mix(0.52, 0.93, smoothstep(0.15, 2.5, plate.path));
  float tone = plateTone(plate.column, plate.at);
  vec3 wash = mix(mix(uPaper, uIndigo, tone / 0.82), deep, smoothstep(0.78, 0.82, tone) * 0.35);
  float plateAlpha = plate.cover * clarity * pigment() * mix(1.0, 0.28, red);
  ink = over(ink, wash, plateAlpha);
  float edges = plateEdges(plate.column, plate.at) * plate.cover * (1.0 - plate.standing * 0.6);
  ink = over(ink, deep, edges * 0.42 * mix(1.0, 0.3, red));
  float dots = dotTone(0.03 + 0.2 * smoothstep(1.0, 8.0, plate.column)) * plate.cover;
  ink = over(ink, deep, dots * 0.45 * mix(1.0, 0.3, red));
  return ink;
}

// Ground the water reached and has left keeps a darker sheen, with fine level strokes like a wet road.
vec4 printWetGround(vec4 ink, Water key) {
  float strokes = inkLine(fract(key.at.y / max(3.0, px(4.0)) + valueNoise(key.at / 30.0) * 0.6) - 0.5, 0.8 * uPixelRatio);
  ink = over(ink, uInk, key.sheen * 0.14);
  ink = over(ink, mix(uIndigo, uInk, 0.5), key.sheen * strokes * 0.18);
  return ink;
}

// Seabed the drawn-back sea has laid bare: wet sand stippled in ink, with pools left in the hollows.
vec4 printBaredBed(vec4 ink, Water key) {
  float stipple = step(0.86, hash12(floor(gPattern / (2.2 * uPixelRatio))));
  float pools = smoothstep(0.62, 0.66, valueNoise(key.at / 22.0));
  ink = over(ink, mix(uPaper, uInk, 0.35), key.bared * 0.35);
  ink = over(ink, uInk, key.bared * stipple * 0.4);
  ink = over(ink, mix(uPaper, uIndigo, 0.45), key.bared * pools * 0.7);
  return ink;
}

// The key block: the waterline, a crisp ink contour wherever the surface meets a wall, a roof or the
// ground the water has reached.
vec4 printWaterline(vec4 ink, Water key) {
  float reached = max(key.standing, aaStep(key.since));
  float line = inkLine(key.gap, 1.15 * uPixelRatio) * reached;
  float front = inkLine(key.since, 1.15 * uPixelRatio) * aaStep(key.gap) * (1.0 - key.standing);
  return over(ink, mix(uIndigo, uInk, 0.7), max(line, front) * 0.92);
}

vec4 printFoam(vec4 ink, float foam, float strength) {
  float fill = aaStep(foam) * strength;
  float edge = inkLine(foam, 1.1 * uPixelRatio) * strength;
  ink = over(ink, uPaper * 1.02, fill * 0.97);
  return over(ink, mix(uIndigo, uInk, 0.6), edge * 0.9);
}
`;

const FLOOD_MARKS = `
vec4 printFlow(vec4 ink, Water key, vec2 uv) {
  vec3 flow = frontFlow(key.at);
  vec4 pull = breachPull(key.at);
  vec2 dir = normalize(mix(flow.xy, pull.zw, pull.x) + 1e-4);
  float fresh = 1.0 - smoothstep(10.0, 70.0, key.since);
  float rising = clamp(uRising / 0.03, 0.0, 1.0);
  float strength = clamp(max(max(fresh, pull.x * pull.y), rising * 0.5), 0.0, 1.0);
  float wet = key.cover * (1.0 - key.standing * 0.7);
  vec3 deep = mix(uIndigo, uInk, 0.55);
  ink = over(ink, deep, currentStrokes(key.at, dir, strength, 16.0 + 18.0 * pull.x) * wet * 0.7);
  ink = over(ink, uInk, debris(key.at, dir, 0.05 + 0.25 * fresh, 6.0) * wet * (0.35 + 0.65 * strength));
  ink = over(ink, deep, ripples(key.at, 1.0 - strength) * wet * 0.55);

  float spacing = max(20.0, px(20.0));
  float behind = key.since * flow.z;
  float moving = 1.0 - smoothstep(uArrivalLast - 2.0, uArrivalLast + 8.0, uMinutes);
  float edgeFoam = clawFoam(behind, dot(key.at, vec2(-flow.y, flow.x)), spacing, spacing * 0.55, spacing * 0.8, 3.0) - (1.0 - moving) * spacing * 2.0;
  float churn = fbm(key.at / 16.0 - pull.zw * uTime * 1.3);
  float jet = (churn + pull.x * pull.y * 0.75 - 0.95) * spacing;
  float nearWater = step(-0.4, key.level - groundElevation(key.at));
  float foam = max(edgeFoam, jet);
  return printFoam(ink, foam, nearWater);
}
`;

const SURGE_MARKS = `
vec4 printFlow(vec4 ink, Water key, vec2 uv) {
  vec2 toward = uSwellToward;
  vec2 across = vec2(-toward.y, toward.x);
  float wavelength = max(46.0, px(26.0));
  float phase = swellPhase(key.at);
  float ahead = fract(phase) * wavelength;
  float behind = (1.0 - fract(phase)) * wavelength;
  float along = dot(key.at, across);
  float shallow = 1.0 - smoothstep(0.6, 3.5, key.column);
  float present = smoothstep(0.32, 0.42, valueNoise(vec2(along / (wavelength * 2.4), floor(phase) * 7.3)));
  float presentNext = smoothstep(0.32, 0.42, valueNoise(vec2(along / (wavelength * 2.4), (floor(phase) + 1.0) * 7.3)));
  float spacing = max(14.0, px(14.0));
  float band = wavelength * (0.08 + 0.2 * shallow);
  float reach = spacing * (0.4 + 0.4 * shallow);
  float lipAhead = clawFoam(-ahead, along, spacing, reach, band, floor(phase)) - (1.0 - present) * wavelength;
  float lipBehind = clawFoam(behind, along, spacing, reach, band, floor(phase) + 1.0) - (1.0 - presentNext) * wavelength;
  float body = (1.0 - smoothstep(0.0, wavelength * 0.45, behind)) * presentNext;
  vec3 deep = mix(uIndigo, uInk, 0.45);
  ink = over(ink, deep, body * key.cover * 0.22);
  ink = over(ink, uPaper, spray(key.at, ahead - reach, wavelength * 0.25) * key.cover * shallow * presentNext * 0.9);

  vec3 flow = frontFlow(key.at);
  float fresh = 1.0 - smoothstep(10.0, 60.0, key.since);
  float wind = clamp(uWind.z / 20.0, 0.0, 1.0);
  vec2 dir = normalize(mix(toward, flow.xy, fresh * 0.5) + 1e-4);
  ink = over(ink, deep, currentStrokes(key.at, dir, max(fresh, wind), 20.0) * key.cover * 0.5);
  ink = over(ink, uInk, debris(key.at, dir, 0.04 + 0.2 * fresh, 8.0) * key.cover * (1.0 - key.standing));

  float seaScale = max(70.0, px(34.0));
  float openSea = smoothstep(80.0, 260.0, key.shore) * key.standing;
  ink = over(ink, uPaper, seigaiha(key.at - toward * uTime * px(3.0), seaScale) * openSea * key.cover * 0.32);

  float foam = max(lipAhead, lipBehind);
  return printFoam(ink, foam, key.cover * smoothstep(0.1, 0.4, key.column + 0.3));
}

// Rain driven across the screen on the wind, in two sheets at different speeds.
vec4 printRain(vec4 ink) {
  float strength = uRain.z;
  vec2 dir = uRain.xy;
  vec2 across = vec2(-dir.y, dir.x);
  float streaks = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float near = float(layer);
    float spacing = mix(9.0, 6.0, near) * uPixelRatio;
    float lanePos = dot(gl_FragCoord.xy, across) / spacing;
    float lane = floor(lanePos);
    float lengthPx = mix(26.0, 46.0, near) * uPixelRatio * (0.7 + 0.6 * hash12(vec2(lane, 3.0 + near)));
    float along = dot(gl_FragCoord.xy, dir) - uTime * mix(700.0, 1100.0, near) * uPixelRatio;
    float t = fract(along / (lengthPx * 4.0) + hash12(vec2(lane, 9.0 + near)));
    float line = 1.0 - smoothstep(0.35 * uPixelRatio, 0.9 * uPixelRatio, abs(fract(lanePos) - 0.5) * spacing);
    float falling = step(t, 0.25) * step(1.0 - strength * mix(0.35, 0.55, near), hash12(vec2(lane, floor(along / (lengthPx * 4.0)) + near * 31.0)));
    streaks = max(streaks, line * falling * mix(0.12, 0.2, near));
  }
  return over(ink, uInk, streaks);
}
`;

const TSUNAMI_MARKS = `
vec4 printFlow(vec4 ink, Water key, vec2 uv) {
  vec2 travel = uTrain.xy;
  vec2 across = vec2(-travel.y, travel.x);
  float along = dot(key.at, across);
  vec2 crest = latestCrest(key.at);
  float speed = dot(key.at - uTrain.zw, travel) < 0.0 ? uCelerity.x : uCelerity.y;
  float behind = crest.x * speed;
  float height = clamp(crest.y / 4.0, 0.25, 1.0);
  float spacing = max(26.0, px(24.0)) * mix(0.8, 1.3, height);
  float bore = clawFoam(behind, along, spacing, spacing * 0.75, spacing * mix(0.9, 2.6, height), crest.y * 3.1);
  float arriving = step(-1.5, crest.x);
  float wetAhead = max(key.cover, key.bared);

  float rise = levelAt(key.at, key.standing, uMinutes + 0.25) - levelAt(key.at, key.standing, uMinutes - 0.25);
  float flowing = clamp(abs(rise) / 0.8, 0.0, 1.0);
  vec2 dir = rise >= 0.0 ? travel : -travel;
  vec3 deep = mix(uIndigo, uInk, 0.5);
  float churned = (1.0 - smoothstep(0.0, 12.0, crest.x)) * step(0.0, crest.x);
  ink = over(ink, deep, currentStrokes(key.at, dir, max(flowing, churned), 26.0) * key.cover * 0.6);
  ink = over(ink, uInk, debris(key.at, dir, 0.04 + 0.3 * churned * (1.0 - key.standing), 9.0) * key.cover);
  ink = over(ink, deep, ripples(key.at, 1.0 - max(flowing, churned)) * key.cover * 0.5);
  ink = over(ink, uPaper, spray(key.at, -behind, spacing * 1.4) * arriving * wetAhead * height);

  float seaScale = max(70.0, px(34.0));
  float openSea = smoothstep(80.0, 260.0, key.shore) * key.standing;
  ink = over(ink, uPaper, seigaiha(key.at - travel * uTime * px(2.0), seaScale) * openSea * key.cover * 0.3 * (1.0 - churned));

  return printFoam(ink, bore - (1.0 - arriving) * spacing * 4.0, wetAhead * height);
}
`;

const MAIN = `
void main() {
  if (isSky(vUv)) { fragColor = vec4(0.0); return; }
  Water key = waterAt(vUv);
  Water plate = waterAt(vUv + uRegistration / uResolution);
  placePattern(worldPosition(vUv, texture(tDepth, vUv).r));

  vec4 ink = vec4(uPaper, 0.0);
  ink = printWetGround(ink, key);
  ink = printBaredBed(ink, key);
  ink = printWater(ink, plate, key, vUv);
  ink = printFlow(ink, key, vUv);
  ink = printWaterline(ink, key);
#ifdef SURGE
  ink = printRain(ink);
#endif
  float fade = smoothstep(0.0, 1500.0, insideBy(key.at, uTerrainExtent));
  fragColor = vec4(ink.rgb, ink.a * fade);
}
`;

const MARKS: Record<WaterKind, string> = { flood: FLOOD_MARKS, surge: SURGE_MARKS, tsunami: TSUNAMI_MARKS };

export function waterFragment(kind: WaterKind) {
  return [
    FULLSCREEN_HEADER,
    DEFINES[kind],
    GBUFFER_GLSL,
    TERRAIN_GLSL,
    ARRIVAL_GLSL,
    NOISE_GLSL,
    UNIFORMS,
    COMMON,
    kind === "tsunami" ? WAVE_LEVEL : STILL_LEVEL,
    WATER_AT,
    PRINT,
    FOAM,
    MOTION,
    FLOW,
    SURFACE_MARKS,
    MARKS[kind],
    MAIN,
  ].join("\n");
}
