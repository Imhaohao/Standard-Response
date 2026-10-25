import type { LatLng } from "../../../geo";
import { sampleAt, type BlizzardSeries, type Sample, type Scenario } from "../../scenario";

// The storm at one minute of the scenario, read from the blizzard series and the sun.

// Share of homes without power. The scenario carries it only when a source says how many homes
// went dark; without it every home keeps its lights.
export type PowerSample = Sample<{ shareOut: number }>;
export type BlizzardSeriesWithPower = BlizzardSeries & { power?: PowerSample[] };

export type BlizzardWeather = {
  depthMeters: number;
  rateCmPerHour: number;
  // The direction the wind blows toward, as a unit vector in map metres (x east, y north).
  windToward: [number, number];
  windMetersPerSecond: number;
  gustMetersPerSecond: number;
  visibilityMeters: number;
  // 0 clear air to 1 a reported visibility of nothing: how far the town fades toward paper.
  whiteout: number;
  // 0 none to 1 the heaviest snow in the air, falling or blown.
  snowfall: number;
  // 1 in daylight, 0 once the sun is more than a few degrees below the horizon.
  daylight: number;
  powerOutShare: number;
};

const CLEAR_VISIBILITY_METERS = 10_000;
const VISIBILITY_FLOOR_METERS = 40;
const HEAVY_SNOW_CM_PER_HOUR = 3.5;
const BLOWING_SNOW_FROM_MPS = 7;
const BLOWING_SNOW_RANGE_MPS = 12;
const BLOWING_SNOW_NEEDS_CM = 2;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

// Visibility read on a log scale, because the eye reads fog that way: 10 km is clear air, 1 km a
// grey morning, and 100 m or less a whiteout where the next house is gone.
export function whiteoutFromVisibility(meters: number) {
  const top = Math.log10(CLEAR_VISIBILITY_METERS);
  const bottom = Math.log10(VISIBILITY_FLOOR_METERS);
  return clamp01((top - Math.log10(Math.max(0, meters) + VISIBILITY_FLOOR_METERS)) / (top - bottom));
}

// Snow in the air: what is falling, what the wind lifts off the ground once there is snow to lift,
// and whatever the reported visibility says must be there.
export function snowInAir(rateCmPerHour: number, windMetersPerSecond: number, depthCm: number, whiteout: number) {
  const falling = rateCmPerHour / HEAVY_SNOW_CM_PER_HOUR;
  const lifted = depthCm >= BLOWING_SNOW_NEEDS_CM ? clamp01((windMetersPerSecond - BLOWING_SNOW_FROM_MPS) / BLOWING_SNOW_RANGE_MPS) * 0.8 : 0;
  return clamp01(Math.max(falling, lifted, whiteout * 0.85));
}

const DEGREES = Math.PI / 180;

// The wind is sampled as a vector so a shift from 350 to 10 degrees turns through north rather
// than all the way round.
function windAt(wind: BlizzardSeries["wind"], minutes: number) {
  const east = sampleAt(wind, minutes, (w) => Math.sin(w.fromDegrees * DEGREES));
  const north = sampleAt(wind, minutes, (w) => Math.cos(w.fromDegrees * DEGREES));
  const length = Math.hypot(east, north) || 1;
  return {
    toward: [-east / length, -north / length] as [number, number],
    speed: sampleAt(wind, minutes, (w) => w.metersPerSecond),
    gust: sampleAt(wind, minutes, (w) => w.gustMetersPerSecond ?? w.metersPerSecond),
  };
}

const MINUTE_MS = 60_000;

// The sun's height above the horizon in degrees, for a moment and a place (NOAA's low-precision
// formulas, good to a few tenths of a degree). Needs no time zone: the sun keeps its own clock.
export function sunElevationDegrees(epochMs: number, { lat, lng }: LatLng) {
  const date = new Date(epochMs);
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((epochMs - startOfYear) / (24 * 60 * MINUTE_MS));
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const year = (2 * Math.PI * (dayOfYear + (utcMinutes / 60 - 12) / 24)) / 365;
  const equationOfTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(year) - 0.032077 * Math.sin(year) - 0.014615 * Math.cos(2 * year) - 0.040849 * Math.sin(2 * year));
  const declination =
    0.006918 -
    0.399912 * Math.cos(year) +
    0.070257 * Math.sin(year) -
    0.006758 * Math.cos(2 * year) +
    0.000907 * Math.sin(2 * year) -
    0.002697 * Math.cos(3 * year) +
    0.00148 * Math.sin(3 * year);
  const solarMinutes = utcMinutes + equationOfTime + 4 * lng;
  const hourAngle = (solarMinutes / 4 - 180) * DEGREES;
  const latitude = lat * DEGREES;
  const cosZenith = Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / DEGREES;
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

// Full day once the sun is a few degrees up, full night by the end of civil twilight.
export const daylightFromElevation = (degrees: number) => smoothstep(-7, 3, degrees);

export function daylightAt(warningAt: string, minutes: number, place: LatLng) {
  const warning = Date.parse(warningAt);
  if (!Number.isFinite(warning)) return 1;
  return daylightFromElevation(sunElevationDegrees(warning + minutes * MINUTE_MS, place));
}

export function blizzardWeather(scenario: Scenario | null, minutes: number, place: LatLng): BlizzardWeather {
  const series = scenario?.kind === "blizzard" ? (scenario.series as BlizzardSeriesWithPower) : null;
  const depthCm = series ? sampleAt(series.snow, minutes, (s) => s.depthCm) : 0;
  const rateCmPerHour = series ? sampleAt(series.snow, minutes, (s) => s.rateCmPerHour) : 0;
  const wind = series && series.wind.length > 0 ? windAt(series.wind, minutes) : { toward: [0, 1] as [number, number], speed: 0, gust: 0 };
  const visibilityMeters = series && series.visibility.length > 0 ? sampleAt(series.visibility, minutes, (v) => v.meters) : CLEAR_VISIBILITY_METERS;
  const whiteout = whiteoutFromVisibility(visibilityMeters);
  return {
    depthMeters: depthCm / 100,
    rateCmPerHour,
    windToward: wind.toward,
    windMetersPerSecond: wind.speed,
    gustMetersPerSecond: wind.gust,
    visibilityMeters,
    whiteout,
    snowfall: snowInAir(rateCmPerHour, wind.speed, depthCm, whiteout),
    daylight: scenario ? daylightAt(scenario.clock.warningAt, minutes, place) : 1,
    powerOutShare: series?.power?.length ? clamp01(sampleAt(series.power, minutes, (p) => p.shareOut)) : 0,
  };
}
