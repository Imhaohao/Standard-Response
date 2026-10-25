import { createProjection, type InkMapData, type Point, terrainHeight } from "../../data";
import type { FireField } from "../../fire-field";
import { sampleAt, type FloodSeries, type Sample, type Scenario, type SurgeSeries, type TsunamiSeries, type Wind } from "../../scenario";

// The water's surface over time, in the terrain's own datum, worked out the same way on the CPU (roofs,
// road closures, the flat map) as in the shader (water/glsl.ts). Depth anywhere is that surface minus
// the ground, on ground the scenario's fronts have reached.

export type WaterKind = "flood" | "surge" | "tsunami";

type Levels = Sample<{ meters: number }>[];

export type Gauge = { at: Point; level: Levels };
export type OpenBreach = { at: Point; opensAt: number; width: number };

// Flood and surge: one level over all the ground the water has reached, gauges for the canals and rivers
// the water came from, and breaches where it pours from a gauge's water into the basin.
export type StillWater = { basin: Levels; gauges: Gauge[]; breaches: OpenBreach[]; wind: Wind[] };

export type TsunamiWave = { arrival: number; runup: number; period: number; drawdown: number };

// A tsunami: crests that reach `reference` at their arrival minute, travelling `travel` (a unit vector on
// the map) at `celerity` metres a minute over the sea and slower once they run up onto land.
export type WaveTrain = { travel: Point; reference: Point; celerity: { sea: number; land: number }; waves: TsunamiWave[] };

export type WaterModel = {
  kind: WaterKind;
  still: StillWater | null;
  train: WaveTrain | null;
  // Metres added to every level so the scenario's water reaches the ground its fronts say it does.
  shift: number;
  // The minutes worth checking for impact: the scenario's clock.
  span: { from: number; to: number };
};

export const levelOf = (levels: Levels, minutes: number) => sampleAt(levels, minutes, (sample) => sample.meters);

// Water a car can't drive through, and water over a house's floor.
export const ROAD_CLOSED_DEPTH = 0.3;
export const BUILDING_FLOODED_DEPTH = 0.5;

// How far from a breach the water surface still slopes down from the canal's level to the basin's.
const POUR_EXTRA_METERS = 180;

export function basinLevel(model: WaterModel, minutes: number) {
  return (model.still ? levelOf(model.still.basin, minutes) : 0) + model.shift;
}

const nearestGauge = (gauges: Gauge[], [x, y]: Point) =>
  gauges.reduce<Gauge | null>((best, gauge) => (!best || Math.hypot(gauge.at[0] - x, gauge.at[1] - y) < Math.hypot(best.at[0] - x, best.at[1] - y) ? gauge : best), null);

// The level of the water a breach pours from: its nearest gauge, or the basin's own when there is none.
export function breachSourceLevel(still: StillWater, breach: OpenBreach, minutes: number) {
  const gauge = nearestGauge(still.gauges, breach.at);
  return gauge ? levelOf(gauge.level, minutes) : levelOf(still.basin, minutes);
}

export const pourReach = (breach: OpenBreach) => breach.width * 2 + POUR_EXTRA_METERS;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

// Through an open breach the canal stands higher than the basin, so the surface slopes down from the
// canal's level at the gap to the basin's level a few hundred metres in.
function pouredLevel(still: StillWater, point: Point, minutes: number, basin: number) {
  let level = basin;
  for (const breach of still.breaches) {
    if (minutes < breach.opensAt) continue;
    const source = breachSourceLevel(still, breach, minutes);
    if (source <= basin) continue;
    const distance = Math.hypot(point[0] - breach.at[0], point[1] - breach.at[1]);
    level = Math.max(level, source - (source - basin) * smoothstep(0, pourReach(breach), distance));
  }
  return level;
}

// One crest's height at a point, `since` minutes after its front passed there: the sea draws back for
// the third of a period before the crest, the front of the bore rises in under a minute, and the water
// stays up for an eighth of a period before draining away over the next third. Mirrored in glsl.ts.
export function waveShape(since: number, wave: TsunamiWave) {
  const drawdown = -wave.drawdown * smoothstep(-0.55 * wave.period, -0.2 * wave.period, since);
  const crest = wave.runup * (1 - smoothstep(0.12 * wave.period, 0.5 * wave.period, since));
  const front = smoothstep(-0.6, 0, since);
  return drawdown + (crest - drawdown) * front;
}

// Minutes after a crest reaches the reference point that it reaches this one: earlier out to sea, later
// as it runs inland.
export function crestDelay(train: WaveTrain, [x, y]: Point) {
  const travelled = (x - train.reference[0]) * train.travel[0] + (y - train.reference[1]) * train.travel[1];
  return travelled < 0 ? travelled / train.celerity.sea : travelled / train.celerity.land;
}

export function seaSurface(train: WaveTrain, point: Point, minutes: number) {
  const delay = crestDelay(train, point);
  return train.waves.reduce((sum, wave) => sum + waveShape(minutes - wave.arrival - delay, wave), 0);
}

// The water surface over reached ground at a point and minute, metres in the terrain's datum.
export function surfaceAt(model: WaterModel, point: Point, minutes: number) {
  if (model.train) return seaSurface(model.train, point, minutes) + model.shift;
  const basin = basinLevel(model, minutes);
  return model.still ? pouredLevel(model.still, point, minutes, basin) : basin;
}

export const groundAt = (data: InkMapData, [x, y]: Point) => terrainHeight(data.terrain, x, y) + data.terrain.base;

// Metres of water over the ground at a point, or a negative number where it is dry. Ground the fronts
// haven't reached by this minute is dry whatever the level, so water never jumps a levee or a ridge.
export function depthAt(model: WaterModel, ground: number, arrival: number, point: Point, minutes: number) {
  if (arrival > minutes) return -Infinity;
  return surfaceAt(model, point, minutes) - ground;
}

const DEGREES = Math.PI / 180;

// Compass bearing (clockwise from north) to a unit vector on the map (x east, y north).
export const bearingVector = (degrees: number): Point => [Math.sin(degrees * DEGREES), Math.cos(degrees * DEGREES)];

// How far behind its peak the drawn-back sea sits, from the crest's own height: a third of it, at
// least a metre and at most three.
const drawdownFor = (runup: number) => Math.min(3, Math.max(1, runup / 3));

// Open water carries the bore at about 10 m/s; once it runs up onto land it slows to about 4 m/s.
const CELERITY = { sea: 600, land: 240 };

function stillWater(series: FloodSeries | SurgeSeries, toLocal: (p: { lat: number; lng: number }) => Point): StillWater {
  return {
    basin: series.water.level,
    gauges: (series.water.gauges ?? []).map((gauge) => ({ at: toLocal(gauge.at), level: gauge.level })),
    breaches: (series.breaches ?? []).map((breach) => ({ at: toLocal(breach.at), opensAt: breach.opensAtMinutes, width: breach.widthMeters ?? 60 })),
    wind: "wind" in series ? series.wind : [],
  };
}

const centroid = (points: Point[]): Point => [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];

// Where a crest's arrival minute is measured: the middle of the shoreline the scenario names, or else the
// first point of land the first front reaches as the wave comes in.
function trainReference(series: TsunamiSeries, travel: Point, field: FireField | null, toLocal: (p: { lat: number; lng: number }) => Point): Point {
  if (series.shoreline?.length) return centroid(series.shoreline.map(toLocal));
  const ring = field?.fronts[0]?.ring;
  if (!ring?.length) return [0, 0];
  return ring.reduce((first, point) => (point[0] * travel[0] + point[1] * travel[1] < first[0] * travel[0] + first[1] * travel[1] ? point : first));
}

function waveTrain(series: TsunamiSeries, field: FireField | null, toLocal: (p: { lat: number; lng: number }) => Point): WaveTrain {
  const [fromX, fromY] = bearingVector(series.approachFromDegrees);
  const travel: Point = [-fromX, -fromY];
  return {
    travel,
    reference: trainReference(series, travel, field, toLocal),
    celerity: CELERITY,
    waves: series.waves.map((wave) => ({ arrival: wave.arrivalMinutes, runup: wave.runupMeters, period: wave.periodMinutes, drawdown: drawdownFor(wave.runupMeters) })),
  };
}

function scenarioSpan(scenario: Scenario, field: FireField | null) {
  const first = field?.fronts[0]?.minutes ?? 0;
  const lead = scenario.kind === "tsunami" ? 30 : 15;
  return { from: Math.max(0, first - lead), to: Math.max(first, scenario.clock.minutesShown) };
}

const peakLevel = (model: WaterModel) => {
  if (model.train) return Math.max(...model.train.waves.map((wave) => wave.runup));
  return Math.max(...(model.still?.basin ?? []).map((sample) => sample.meters));
};

const REACHED_SAMPLES = 4000;
const DRY_SHARE_ALLOWED = 0.15;

// The fronts and the level come from the scenario, the ground from the map's own terrain, and the two
// can disagree by a datum. Where the water would stay below most of the ground its fronts say it
// reached, this lifts every level by the difference, so the water shows where the scenario puts it. A
// sixth or so of the reached ground may stay dry (a levee crest, a raised lot).
export function datumShift(model: WaterModel, data: InkMapData, field: FireField | null) {
  if (!field || !Number.isFinite(peakLevel(model))) return 0;
  const last = field.fronts[field.fronts.length - 1]?.minutes ?? 0;
  const stride = Math.max(1, Math.floor(field.minutes.length / REACHED_SAMPLES));
  const cellX = (field.region.x1 - field.region.x0) / field.width;
  const cellY = (field.region.y1 - field.region.y0) / field.height;
  const grounds: number[] = [];
  for (let index = 0; index < field.minutes.length; index += stride) {
    if (field.minutes[index] > last) continue;
    const col = index % field.width;
    const row = Math.floor(index / field.width);
    grounds.push(groundAt(data, [field.region.x0 + (col + 0.5) * cellX, field.region.y0 + (row + 0.5) * cellY]));
  }
  if (grounds.length === 0) return 0;
  grounds.sort((a, b) => a - b);
  const wetGround = grounds[Math.min(grounds.length - 1, Math.floor(grounds.length * (1 - DRY_SHARE_ALLOWED)))];
  return Math.max(0, wetGround - peakLevel(model) + 0.2);
}

export function waterModel(scenario: Scenario | null, data: InkMapData, field: FireField | null, kind: WaterKind): WaterModel {
  const { toLocal } = createProjection(data.origin);
  const series = scenario?.kind === kind ? scenario.series : null;
  const isTrain = kind === "tsunami" && series !== null;
  const model: WaterModel = {
    kind,
    still: !isTrain && series ? stillWater(series as FloodSeries, toLocal) : null,
    train: isTrain ? waveTrain(series as TsunamiSeries, field, toLocal) : null,
    shift: 0,
    span: scenario ? scenarioSpan(scenario, field) : { from: 0, to: 0 },
  };
  model.shift = datumShift(model, data, field);
  return model;
}
