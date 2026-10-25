import * as THREE from "three";
import { terrainHeight, type Point } from "../../data";
import type { FireField } from "../../fire-field";
import { sampleAt } from "../../scenario";
import { impactAt, NO_IMPACT, type ArrivalIndex } from "../arrival";
import type { FullscreenPass, HazardFrame, HazardLayer, HazardLayerContext } from "../types";
import { MAX_BREACHES, MAX_WAVES, waterFragment } from "./glsl";
import { waterIndex } from "./impact";
import { basinLevel, bearingVector, breachSourceLevel, levelOf, pourReach, waterModel, type WaterKind, type WaterModel } from "./model";
import { shoreBytes, shoreFor, type ShoreGrid } from "./shore";
import { breachAxis, waterField } from "./source";

// The flood, the surge and the tsunami share this layer; each kind's shader (glsl.ts) draws its own
// motion. GPU memory beyond the shared terrain: the arrival field as half floats and the shore as two
// bytes a cell (at most 1024 across, so 2 MB). No render targets: one pass over the canvas a frame.

function shoreTexture(grid: ShoreGrid) {
  const texture = new THREE.DataTexture(shoreBytes(grid), grid.width, grid.height, THREE.RGFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

type ArrivalTexture = { texture: THREE.DataTexture; region: THREE.Vector4; last: number; offset: number };

// The arrival field as half floats, less an offset: at minute 1500 a half float steps a whole minute, and
// every minute's front printed as its own ring. Less the scenario's start it keeps a fraction of a minute.
function arrivalTextureFrom(field: FireField, offset: number): ArrivalTexture {
  const half = new Uint16Array(field.minutes.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(field.minutes[i] - offset);
  const texture = new THREE.DataTexture(half, field.width, field.height, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const { x0, y0, x1, y1 } = field.region;
  return { texture, region: new THREE.Vector4(x0, y0, x1, y1), last: field.fronts[field.fronts.length - 1]?.minutes ?? 0, offset };
}

function breachAxes(model: WaterModel, field: FireField) {
  const flat = (model.still?.breaches ?? []).slice(0, MAX_BREACHES).flatMap((breach) => breachAxis(field, breach));
  const [ax = 0, ay = 0, bx = 0, by = 0] = flat;
  return new THREE.Vector4(ax, ay, bx, by);
}

const RAIN_FALL_METERS_PER_SECOND = 9;
const REGISTRATION_PIXELS = new THREE.Vector2(1.3, -0.9);
const CLOSED_BREACH = -1000;

// The wind at a minute as the way it blows toward (a unit vector), its speed and its gusts. Directions
// are averaged as vectors so a wind backing through north doesn't swing the long way round.
function windAt(model: WaterModel, minutes: number) {
  const wind = model.still?.wind ?? [];
  if (wind.length === 0) return { toward: [0, 0] as Point, speed: 0, gust: 0 };
  const east = sampleAt(wind, minutes, (sample) => bearingVector(sample.fromDegrees)[0]);
  const north = sampleAt(wind, minutes, (sample) => bearingVector(sample.fromDegrees)[1]);
  const length = Math.hypot(east, north) || 1;
  return {
    toward: [-east / length, -north / length] as Point,
    speed: sampleAt(wind, minutes, (sample) => sample.metersPerSecond),
    gust: sampleAt(wind, minutes, (sample) => sample.gustMetersPerSecond ?? sample.metersPerSecond),
  };
}

// The level of the canals, rivers and sea: never below the sea at rest, and in a flood as high as the
// canal the breaches pour from.
function standingLevel(model: WaterModel, minutes: number) {
  const gauges = model.kind === "flood" ? (model.still?.gauges ?? []).map((gauge) => levelOf(gauge.level, minutes) + model.shift) : [];
  return Math.max(0, basinLevel(model, minutes), ...gauges);
}

function swellToward(onshore: Point, wind: ReturnType<typeof windAt>): Point {
  const push = Math.min(1, wind.speed / 20) * 0.4;
  const x = onshore[0] + wind.toward[0] * push;
  const y = onshore[1] + wind.toward[1] * push;
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

export class WaterLayer implements HazardLayer {
  readonly animates = true;
  private pass: FullscreenPass | null = null;
  private arrival: ArrivalTexture | null = null;
  private shore: THREE.DataTexture | null = null;
  private onshore: Point = [0, 1];
  private model: WaterModel;
  private field: FireField | null = null;
  private index: ArrivalIndex | null = null;
  private wind = { toward: [0, 0] as Point, speed: 0, gust: 0 };

  constructor(
    readonly kind: WaterKind,
    private context: HazardLayerContext,
  ) {
    this.model = waterModel(context.scenario, context.data, context.field, kind);
    if (!context.field) return;
    const grid = shoreFor(context.data, kind);
    this.field = waterField(context.field, this.model, grid);
    this.onshore = grid.onshore;
    this.shore = shoreTexture(grid);
    this.arrival = arrivalTextureFrom(this.field, this.model.span.from - 30);
    this.pass = context.fullscreen(waterFragment(kind), this.uniforms(grid, this.arrival, this.shore), { blend: true });
  }

  private uniforms(grid: ShoreGrid, arrival: ArrivalTexture, shore: THREE.DataTexture): Record<string, THREE.IUniform> {
    const { shared, terrain } = this.context;
    const { x0, y0, x1, y1 } = grid.region;
    return {
      ...Object.fromEntries(SHARED_UNIFORMS.map((name) => [name, shared[name]])),
      ...trainUniforms(this.model),
      tTerrain: { value: terrain.texture },
      uTerrainRegion: { value: terrain.region },
      tArrival: { value: arrival.texture },
      uArrivalRegion: { value: arrival.region },
      uArrivalLast: { value: arrival.last },
      uArrivalOffset: { value: arrival.offset },
      tShore: { value: shore },
      uShoreRegion: { value: new THREE.Vector4(x0, y0, x1, y1) },
      uRegistration: { value: new THREE.Vector2() },
      uMinutes: { value: 0 },
      uShift: { value: this.model.shift },
      uBasin: { value: 0 },
      uStanding: { value: 0 },
      uRising: { value: 0 },
      uBreaches: { value: Array.from({ length: MAX_BREACHES }, () => new THREE.Vector4(0, 0, CLOSED_BREACH, 1)) },
      uBreachAxes: { value: this.field ? breachAxes(this.model, this.field) : new THREE.Vector4() },
      uWind: { value: new THREE.Vector4() },
      uSwellToward: { value: new THREE.Vector2(0, 1) },
      uRain: { value: new THREE.Vector3(0, -1, 0) },
    };
  }

  setMinutes(minutes: number) {
    if (!this.pass) return;
    const u = this.pass.material.uniforms;
    const model = this.model;
    u.uMinutes.value = minutes;
    u.uBasin.value = basinLevel(model, minutes);
    u.uStanding.value = standingLevel(model, minutes);
    u.uRising.value = (basinLevel(model, minutes + 5) - basinLevel(model, minutes - 5)) / 10;
    this.placeBreaches(minutes);
    this.wind = windAt(model, minutes);
    u.uWind.value.set(this.wind.toward[0], this.wind.toward[1], this.wind.speed, this.wind.gust);
    u.uSwellToward.value.set(...swellToward(this.onshore, this.wind));
  }

  private placeBreaches(minutes: number) {
    const breaches = this.model.still?.breaches ?? [];
    const slots = this.pass!.material.uniforms.uBreaches.value as THREE.Vector4[];
    slots.forEach((slot, i) => {
      const breach = breaches[i];
      if (!breach) return slot.set(0, 0, CLOSED_BREACH, 1);
      const open = minutes >= breach.opensAt;
      const source = open && this.model.still ? breachSourceLevel(this.model.still, breach, minutes) + this.model.shift : CLOSED_BREACH;
      slot.set(breach.at[0], breach.at[1], source, pourReach(breach));
    });
  }

  // Rain falls at about 9 m/s and the wind carries it sideways; on screen that is a slant, worked out by
  // projecting one second of a drop's fall through the middle of the view.
  private placeRain(camera: THREE.Camera, viewport: { width: number; height: number }) {
    const u = this.pass!.material.uniforms;
    const { bounds, data } = this.context;
    const x = (bounds.x0 + bounds.x1) / 2;
    const y = (bounds.y0 + bounds.y1) / 2;
    const from = new THREE.Vector3(x, terrainHeight(data.terrain, x, y) + 30, -y);
    const to = from.clone().add(new THREE.Vector3(this.wind.toward[0] * this.wind.speed, -RAIN_FALL_METERS_PER_SECOND, -this.wind.toward[1] * this.wind.speed));
    from.project(camera);
    to.project(camera);
    const dx = (to.x - from.x) * viewport.width;
    const dy = (to.y - from.y) * viewport.height;
    const length = Math.hypot(dx, dy);
    const strength = this.kind === "surge" ? Math.min(1, Math.max(0.3, this.wind.speed / 18)) : 0;
    u.uRain.value.set(length > 1e-6 ? dx / length : 0, length > 1e-6 ? dy / length : -1, strength);
  }

  drawScreen({ camera, viewport }: HazardFrame) {
    if (!this.pass) return;
    const u = this.pass.material.uniforms;
    u.uRegistration.value.copy(REGISTRATION_PIXELS).multiplyScalar(this.context.shared.uPixelRatio.value);
    this.placeRain(camera, viewport);
    this.pass.draw();
  }

  impact(minutes: number) {
    if (!this.field) return NO_IMPACT;
    this.index ??= waterIndex(this.model, this.context.data, this.field);
    return impactAt(this.index, minutes);
  }

  dispose() {
    this.pass?.dispose();
    this.arrival?.texture.dispose();
    this.shore?.dispose();
  }
}

// The composite's uniforms the water reads, shared by reference so camera, palette and pattern scale stay in step.
const SHARED_UNIFORMS = ["tBase", "tDepth", "tShade", "tId", "tBuildingState", "uInvProjection", "uCameraWorld", "uBaseElevation", "uResolution", "uPixelRatio", "uTime", "uPaper", "uInk", "uIndigo", "uCamRight", "uCamUp", "uPatternScale", "uViewMpp", "uTerrainExtent"];

function trainUniforms({ train }: WaterModel): Record<string, THREE.IUniform> {
  const waves = train?.waves.slice(0, MAX_WAVES) ?? [];
  const slots = Array.from({ length: MAX_WAVES }, (_, i) => waves[i]);
  return {
    uWaves: { value: slots.map((wave) => (wave ? new THREE.Vector4(wave.arrival, wave.runup, wave.period, wave.drawdown) : new THREE.Vector4(0, 0, 1, 0))) },
    uWaveCount: { value: waves.length },
    uTrain: { value: train ? new THREE.Vector4(train.travel[0], train.travel[1], train.reference[0], train.reference[1]) : new THREE.Vector4(0, 1, 0, 0) },
    uCelerity: { value: train ? new THREE.Vector2(train.celerity.sea, train.celerity.land) : new THREE.Vector2(600, 240) },
  };
}

export const createWaterLayer = (kind: WaterKind) => (context: HazardLayerContext) => new WaterLayer(kind, context);
