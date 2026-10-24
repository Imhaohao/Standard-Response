"use client";

import { useEffect, useMemo, useState } from "react";
import { LatLng } from "@/lib/geo";
import { useNow } from "@/lib/time";
import { createProjection } from "./data";
import { buildFireField, FireField, ScenarioGeoJson, scenarioFronts } from "./fire-field";

export type Hazard = { field: FireField; label: string; basis: string };

type ScenarioFile = ScenarioGeoJson & { metadata?: { label?: string; basis?: string } };

// Track D's scenario, in the map's own metres. Loaded once per session.
export function useHazard(origin: LatLng | undefined): Hazard | null {
  const [file, setFile] = useState<ScenarioFile | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/scenario")
      .then((response) => response.json() as Promise<ScenarioFile | null>)
      .then((data) => live && data && setFile(data));
    return () => {
      live = false;
    };
  }, []);

  return useMemo(() => {
    if (!origin || !file?.features?.length) return null;
    const fronts = scenarioFronts(file, createProjection(origin).toLocal);
    return {
      field: buildFireField(fronts),
      label: file.metadata?.label ?? "Scenario input, not a forecast",
      basis: file.metadata?.basis ?? "",
    };
  }, [origin, file]);
}

// Minute 0 is the warning and the scenario runs on the wall clock, the same clock Track D's
// deadlines use. The scrubber is how anyone looks ahead.
export const SIM_MINUTES_PER_SECOND = 1 / 60;

export type FireClock = {
  minutes: number;
  last: number;
  scrubbing: boolean;
  scrub: (minutes: number) => void;
  follow: () => void;
};

export function useFireClock(hazard: Hazard | null, issuedAt: number | undefined): FireClock {
  const now = useNow(400);
  const [override, setOverride] = useState<number | null>(null);
  const last = hazard?.field.fronts[hazard.field.fronts.length - 1]?.minutes ?? 0;
  const elapsed = issuedAt === undefined ? 0 : ((now - issuedAt) / 1000) * SIM_MINUTES_PER_SECOND;
  return {
    minutes: Math.min(override ?? Math.max(0, elapsed), last),
    last,
    scrubbing: override !== null,
    scrub: setOverride,
    follow: () => setOverride(null),
  };
}
