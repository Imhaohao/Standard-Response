"use client";

import { useEffect, useMemo, useState } from "react";
import { LatLng } from "@/lib/geo";
import { createProjection, Point } from "./data";
import { contains } from "./fire-field";

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
