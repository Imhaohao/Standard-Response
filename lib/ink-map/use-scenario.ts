"use client";

import { useEffect, useMemo, useState } from "react";
import { cityById } from "@/lib/cities";
import { createProjection } from "./data";
import { buildFireField, scenarioFronts } from "./fire-field";
import type { Hazard } from "./hazard";
import type { Scenario } from "./scenario";

export const scenarioUrl = (cityId: string) => `/scenarios/${cityId}.json`;

// A city's scenario file, with its fronts turned into the arrival field the map shades. Reads only
// public/scenarios, never Convex, so a page can show any city's disaster on its own.
export function useScenario(cityId: string): Hazard | null {
  const [loaded, setLoaded] = useState<{ cityId: string; scenario: Scenario | null } | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(scenarioUrl(cityId))
      .then((response) => (response.ok ? (response.json() as Promise<Scenario>) : null))
      .catch(() => null)
      .then((scenario) => live && setLoaded({ cityId, scenario }));
    return () => {
      live = false;
    };
  }, [cityId]);
  const scenario = loaded?.cityId === cityId ? loaded.scenario : null;

  return useMemo(() => {
    if (!scenario?.fronts.features.length) return null;
    const fronts = scenarioFronts(scenario.fronts, createProjection(cityById(cityId).origin).toLocal);
    return {
      field: buildFireField(fronts),
      label: scenario.label,
      basis: scenario.basis,
      burns: scenario.kind === "wildfire",
      kind: scenario.kind,
      scenario,
    };
  }, [scenario, cityId]);
}
