"use client";

import { useEffect, useMemo, useState } from "react";
import { LatLng } from "@/lib/geo";
import { createProjection, Point } from "./data";
import { arrivalAt, contains, NEVER_BURNS, ScenarioFront } from "./fire-field";

type Ring = number[][];
type ZoneGeometry = { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
type ZoneFeature = { properties: { probability: number; minutesAfterWarning: number }; geometry: ZoneGeometry };

export type WindNow = { speedKmh: number; fromDegrees: number; gustKmh: number | null };
type WindSummary = { source: "nws" | "scenario"; note?: string; fetched?: string; now?: WindNow };

type DangerFile = {
  metadata: { label: string; generatedAt: string; members: number; probabilities: number[]; wind: WindSummary };
  features: ZoneFeature[];
};

export type DangerZone = { probability: number; minutes: number; rings: Point[][] };
export type DangerZones = {
  zones: DangerZone[];
  probabilities: number[];
  members: number;
  generatedAt: string;
  wind: WindSummary;
};

// The ensemble file is rebuilt as the NWS forecast updates, so the map asks again every few minutes.
const REFRESH_MS = 5 * 60_000;

function useDangerFile() {
  const [file, setFile] = useState<DangerFile | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/danger")
        .then((response) => response.json() as Promise<DangerFile | null>)
        .then((data) => live && setFile(data?.features?.length ? data : null))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return file;
}

function polygonsOf(geometry: ZoneGeometry): Ring[][] {
  return geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
}

export function useDangerZones(origin: LatLng | undefined): DangerZones | null {
  const file = useDangerFile();
  return useMemo(() => {
    if (!origin || !file) return null;
    const { toLocal } = createProjection(origin);
    const zones = file.features.map((feature) => ({
      probability: feature.properties.probability,
      minutes: feature.properties.minutesAfterWarning,
      rings: polygonsOf(feature.geometry).flatMap((polygon) => polygon.map((ring) => ring.map(([lng, lat]) => toLocal({ lat, lng })))),
    }));
    const { members, generatedAt, probabilities, wind } = file.metadata;
    return { zones, members, generatedAt, probabilities, wind };
  }, [origin, file]);
}

// For each probability, the latest frame at or before the clock, widest band first so the darker bands paint on top.
// The forecast looks this far past the clock: where the fire could be within the hour.
export const FORECAST_AHEAD_MINUTES = 60;

export function zonesAt(danger: DangerZones, minutes: number): DangerZone[] {
  const latest = new Map<number, DangerZone>();
  for (const zone of danger.zones) {
    if (zone.minutes > minutes) continue;
    const held = latest.get(zone.probability);
    if (!held || zone.minutes > held.minutes) latest.set(zone.probability, zone);
  }
  return [...latest.values()].sort((a, b) => a.probability - b.probability);
}

// The highest forecast probability whose zone holds the point at this minute, or null outside every zone.
export function chanceAt(danger: DangerZones, minutes: number, [x, y]: Point): number | null {
  const holding = zonesAt(danger, minutes).filter((zone) => zone.rings.filter((ring) => contains(ring, x, y)).length % 2 === 1);
  return holding.length ? Math.max(...holding.map((zone) => zone.probability)) : null;
}

// The forecast as three arrival maps, one per band: the minute each spot is that likely to have
// burned, interpolated between the ten-minute frames so the bands slide rather than jump. The map
// draws it on the ground, under the markers, minus whatever the scenario fire has already burned.
export type ForecastField = { minutes: Float32Array; width: number; height: number; region: { x0: number; y0: number; x1: number; y1: number } };

const FORECAST_CELLS_ACROSS = 192;
const FORECAST_PAD_METERS = 200;
const BANDS = 3;

const largestRing = (rings: Point[][]) => rings.reduce((best, ring) => (ring.length > best.length ? ring : best), rings[0]);

// The zones of each band nest as time goes on, so the first zone holding a point is found by halving.
function firstHolding(fronts: ScenarioFront[], x: number, y: number) {
  let low = 0;
  let high = fronts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (contains(fronts[middle].ring, x, y)) high = middle;
    else low = middle + 1;
  }
  return low;
}

function bandArrival(fronts: ScenarioFront[], x: number, y: number) {
  const index = firstHolding(fronts, x, y);
  if (index === fronts.length) return NEVER_BURNS;
  return index === 0 ? fronts[0].minutes : arrivalAt(fronts.slice(index - 1, index + 1), x, y);
}

export function forecastField(danger: DangerZones): ForecastField {
  const bands = [...danger.probabilities]
    .sort((a, b) => a - b)
    .slice(0, BANDS)
    .map((probability) =>
      danger.zones
        .filter((zone) => zone.probability === probability)
        .sort((a, b) => a.minutes - b.minutes)
        .map((zone) => ({ minutes: zone.minutes, ring: largestRing(zone.rings) })),
    );
  const widest = bands[0][bands[0].length - 1].ring;
  const region = {
    x0: Math.min(...widest.map((p) => p[0])) - FORECAST_PAD_METERS,
    y0: Math.min(...widest.map((p) => p[1])) - FORECAST_PAD_METERS,
    x1: Math.max(...widest.map((p) => p[0])) + FORECAST_PAD_METERS,
    y1: Math.max(...widest.map((p) => p[1])) + FORECAST_PAD_METERS,
  };
  const width = FORECAST_CELLS_ACROSS;
  const height = Math.round((width * (region.y1 - region.y0)) / (region.x1 - region.x0));
  const minutes = new Float32Array(width * height * BANDS).fill(NEVER_BURNS);
  for (let row = 0; row < height; row++) {
    const y = region.y0 + ((row + 0.5) / height) * (region.y1 - region.y0);
    for (let col = 0; col < width; col++) {
      const x = region.x0 + ((col + 0.5) / width) * (region.x1 - region.x0);
      bands.forEach((fronts, band) => {
        minutes[(row * width + col) * BANDS + band] = bandArrival(fronts, x, y);
      });
    }
  }
  return { minutes, width, height, region };
}
