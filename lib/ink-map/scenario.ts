import type { HazardKind } from "../cities";
import type { LatLng } from "../geo";
import type { ScenarioGeoJson } from "./fire-field";

// Scenario file v2: public/scenarios/<city>.json. One disaster in one city, on one clock.
// Every time in the file is minutes after the warning (clock.warningAt), the same minute the
// map's scrubber and the fire field use. Heights and levels are metres in the terrain's own
// datum (Terrain Tiles: roughly NAVD88 / mean sea level), so a flood's depth at a point is
// level minus ground elevation.

export type ScenarioSource = { label: string; url?: string };

// One value at one minute. Series interpolate linearly between samples and hold their ends.
export type Sample<T> = { minutes: number } & T;

export type Wind = Sample<{ fromDegrees: number; metersPerSecond: number; gustMetersPerSecond?: number }>;

// A water surface over time. `level` applies everywhere the water reaches; a gauge overrides it near
// its own point, so a breach can fill one basin while the river outside stays lower.
export type WaterLevels = {
  datum: string;
  level: Sample<{ meters: number }>[];
  gauges?: { id: string; name: string; at: LatLng; level: Sample<{ meters: number }>[] }[];
};

export type Flow = Sample<{ at: LatLng; towardDegrees: number; metersPerSecond: number }>;
export type Breach = { at: LatLng; opensAtMinutes: number; widthMeters?: number; label?: string };

export type WildfireSeries = { headingDegrees?: number; headSpreadMetersPerMinute?: number };

export type FloodSeries = { water: WaterLevels; flow?: Flow[]; breaches?: Breach[] };

export type SurgeSeries = FloodSeries & { wind: Wind[] };

// A tsunami arrives as a train of waves from one direction; each crest has its own run-up.
export type TsunamiSeries = {
  source: { name: string; at: LatLng };
  approachFromDegrees: number;
  shoreline?: LatLng[];
  waves: { arrivalMinutes: number; runupMeters: number; periodMinutes: number; label?: string }[];
};

export type RoadClosure = { road: string; path?: LatLng[]; closedAtMinutes: number; reopensAtMinutes?: number };

export type BlizzardSeries = {
  snow: Sample<{ rateCmPerHour: number; depthCm: number }>[];
  wind: Wind[];
  visibility: Sample<{ meters: number }>[];
  roadClosures: RoadClosure[];
};

export type SeriesByKind = {
  wildfire: WildfireSeries;
  flood: FloodSeries;
  surge: SurgeSeries;
  tsunami: TsunamiSeries;
  blizzard: BlizzardSeries;
};

export type Scenario<K extends HazardKind = HazardKind> = {
  version: 2;
  city: string;
  kind: K;
  label: string;
  basis: string;
  sources: ScenarioSource[];
  clock: { warningAt: string; minutesShown: number };
  // Nested polygons, each tagged with properties.minutesAfterWarning: where the hazard has reached
  // by then. Every hazard has them; they become the arrival field the map shades and the flat map traces.
  fronts: ScenarioGeoJson;
  series: SeriesByKind[K];
};

export function isKind<K extends HazardKind>(scenario: Scenario, kind: K): scenario is Scenario<K> {
  return scenario.kind === kind;
}

// A series' value at a minute, linear between samples and held past either end.
export function sampleAt<T>(samples: Sample<T>[], minutes: number, value: (sample: Sample<T>) => number): number {
  if (samples.length === 0) return 0;
  const next = samples.findIndex((sample) => sample.minutes >= minutes);
  if (next === 0) return value(samples[0]);
  if (next < 0) return value(samples[samples.length - 1]);
  const a = samples[next - 1];
  const b = samples[next];
  const t = (minutes - a.minutes) / (b.minutes - a.minutes || 1);
  return value(a) + (value(b) - value(a)) * t;
}
