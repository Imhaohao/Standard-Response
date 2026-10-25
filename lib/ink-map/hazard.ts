"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { HazardKind } from "@/lib/cities";
import { LatLng } from "@/lib/geo";
import { simTime } from "@/lib/sim-clock";
import { createProjection } from "./data";
import { buildFireField, FireField, ScenarioGeoJson, scenarioFronts } from "./fire-field";
import type { Scenario } from "./scenario";

// `burns` is false for a hazard that isn't a fire, such as an earthquake's damage bands: the map
// shades the area it reaches but draws no flames, embers or smoke over it. A hazard from a scenario
// file (useScenario) also names its kind and carries the file, and the map draws it with that
// kind's layer (lib/ink-map/hazard-layers); one without a kind is drawn as the fire always was.
export type Hazard = { field: FireField; label: string; basis: string; burns?: boolean; kind?: HazardKind; scenario?: Scenario };

type ScenarioFile = ScenarioGeoJson & { metadata?: { label?: string; basis?: string } };

// The scenario for the operator's hazard, in the map's own metres. Reloaded when the hazard changes.
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
      burns: loaded?.kind === "wildfire",
    };
  }, [origin, file, loaded?.kind]);
}

// Minute 0 is the warning, and the fire runs on the night's clock, the same clock the hazard
// runner's deadlines use. At normal speed that is the wall clock; the rescue map can pause or speed it up.
export const SIM_MINUTES_PER_SECOND = 1 / 60;

export type FireClock = { minutes: number; last: number };

// Tenths of a minute: fine enough that the front moves smoothly at any playback speed, coarse
// enough that the screen re-renders only when the fire actually moves, and never while paused.
const MINUTE_STEP = 0.1;
const CLOCK_TICK_MS = 250;

export function useFireClock(hazard: Hazard | null, issuedAt: number | undefined): FireClock {
  const clock = useQuery(api.control.get)?.clock;
  const last = hazard?.field.fronts[hazard.field.fronts.length - 1]?.minutes ?? 0;
  const [minutes, setMinutes] = useState(0);
  useEffect(() => {
    const read = () => {
      const elapsed = issuedAt === undefined ? 0 : ((simTime(clock, Date.now()) - issuedAt) / 1000) * SIM_MINUTES_PER_SECOND;
      setMinutes(Math.round(Math.min(Math.max(0, elapsed), last) / MINUTE_STEP) * MINUTE_STEP);
    };
    read();
    const id = setInterval(read, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [clock, issuedAt, last]);
  return { minutes, last };
}
