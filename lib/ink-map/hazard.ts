"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { useSimNow } from "@/lib/use-sim-now";
import { createProjection } from "./data";
import { buildFireField, FireField, ScenarioGeoJson, scenarioFronts } from "./fire-field";

export type Hazard = { field: FireField; label: string; basis: string };

type ScenarioFile = ScenarioGeoJson & { metadata?: { label?: string; basis?: string } };

// Track D's scenario for the operator's hazard, in the map's own metres. Reloaded when the hazard changes.
export function useHazard(origin: LatLng | undefined): Hazard | null {
  // A deployment from before the hazard switch returns no hazard at all; that night is a wildfire.
  const control = useQuery(api.control.get);
  const kind = control === undefined ? undefined : (control.hazard ?? "wildfire");
  const [loaded, setLoaded] = useState<{ kind: string; file: ScenarioFile | null } | null>(null);
  useEffect(() => {
    if (!kind) return;
    let live = true;
    void fetch(`/api/scenario?hazard=${kind}`)
      .then((response) => response.json() as Promise<ScenarioFile | null>)
      .then((data) => live && setLoaded({ kind, file: data }));
    return () => {
      live = false;
    };
  }, [kind]);
  const file = loaded && loaded.kind === kind ? loaded.file : null;

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

// Minute 0 is the warning, and the fire runs on the night's clock, the same clock Track D's
// deadlines use. At normal speed that is the wall clock; the rescue map can pause or speed it up.
export const SIM_MINUTES_PER_SECOND = 1 / 60;

export type FireClock = { minutes: number; last: number };

export function useFireClock(hazard: Hazard | null, issuedAt: number | undefined): FireClock {
  const now = useSimNow(250);
  const last = hazard?.field.fronts[hazard.field.fronts.length - 1]?.minutes ?? 0;
  const elapsed = issuedAt === undefined || now === 0 ? 0 : ((now - issuedAt) / 1000) * SIM_MINUTES_PER_SECOND;
  return { minutes: Math.min(Math.max(0, elapsed), last), last };
}
