"use client";

import { useCallback, useMemo, useState } from "react";
import { LatLng } from "@/lib/geo";
import { Building, Point } from "@/lib/ink-map/data";
import { contains } from "@/lib/ink-map/fire-field";
import { Hazard } from "@/lib/ink-map/hazard";
import { downwindOf, FireResponse, ignitionHazard } from "@/lib/ink-map/ignition";
import { nearestHome } from "./house-card";
import { Home } from "./marks";

type Ignition = { point: Point; wind: Point; startedAt: number };

const FIRST_RESPONSE: FireResponse = { construction: "older", engines: 1 };

// A fire the dispatcher lights at a house to rehearse. It stands in for the scenario on this screen
// only, starts burning the moment it is lit, and spreads the way the scenario's wind blows. Changing
// how the homes are built or how many crews respond re-runs the same fire from the same moment.
export function useSimulatedFire(scenario: Hazard | null, buildings: Building[], homes: Home[], toLocal: (at: LatLng) => Point) {
  const [ignition, setIgnition] = useState<Ignition | null>(null);
  const [response, setResponse] = useState<FireResponse>(FIRST_RESPONSE);

  const ignite = useCallback(
    (point: Point) => {
      const home = nearestHome(homes, point, toLocal);
      if (!home) return;
      setIgnition({ point: toLocal(home), wind: downwindOf(scenario?.field.fronts), startedAt: Date.now() });
    },
    [homes, toLocal, scenario],
  );

  const fire = useMemo(() => (ignition ? ignitionHazard(buildings, ignition.point, ignition.wind, response) : null), [buildings, ignition, response]);
  const homesReached = useMemo(() => {
    const ring = fire?.field.fronts[fire.field.fronts.length - 1].ring;
    return ring ? homes.filter((home) => contains(ring, ...toLocal(home))).length : 0;
  }, [fire, homes, toLocal]);
  const clear = useCallback(() => setIgnition(null), []);
  return { hazard: fire, startedAt: ignition?.startedAt, ignite, clear, response, setResponse, homesReached };
}
