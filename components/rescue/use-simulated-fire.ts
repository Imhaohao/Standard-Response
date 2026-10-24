"use client";

import { useCallback, useMemo, useState } from "react";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { Hazard } from "@/lib/ink-map/hazard";
import { downwindOf, ignitionHazard } from "@/lib/ink-map/ignition";
import { nearestHome } from "./house-card";
import { Home } from "./marks";

type Ignition = { point: Point; wind: Point; startedAt: number };

// A fire the dispatcher lights at a house to rehearse. It stands in for the scenario on this screen
// only, starts burning the moment it is lit, and spreads the way the scenario's wind blows.
export function useSimulatedFire(scenario: Hazard | null, homes: Home[], toLocal: (at: LatLng) => Point) {
  const [ignition, setIgnition] = useState<Ignition | null>(null);

  const ignite = useCallback(
    (point: Point) => {
      const home = nearestHome(homes, point, toLocal);
      if (!home) return;
      setIgnition({ point: toLocal(home), wind: downwindOf(scenario?.field.fronts), startedAt: Date.now() });
    },
    [homes, toLocal, scenario],
  );

  const hazard = useMemo(() => (ignition ? ignitionHazard(ignition.point, ignition.wind) : null), [ignition]);
  const clear = useCallback(() => setIgnition(null), []);
  return { hazard, startedAt: ignition?.startedAt, ignite, clear };
}
