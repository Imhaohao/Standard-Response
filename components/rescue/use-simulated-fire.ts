"use client";

import { useQuery } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { contains } from "@/lib/ink-map/fire-field";
import { Hazard } from "@/lib/ink-map/hazard";
import { simTime } from "@/lib/sim-clock";
import { downwindOf, FireResponse, ignitionHazard } from "@/lib/ink-map/ignition";
import { streetNetwork } from "@/lib/ink-map/street-network";
import { warningZoneAround } from "@/lib/ink-map/warning-zone";
import { nearestHome } from "./house-card";
import { Home } from "./marks";

type Ignition = { point: Point; wind: Point; startedAt: number };

const BUILDING_REACH_METERS = 40;

// Any building on the map can be lit, not only the homes on file: the one whose middle is nearest
// the click, if it is close enough to be the one clicked.
function nearestBuilding(data: InkMapData, [x, y]: Point): Point | null {
  let best: Point | null = null;
  let bestDistance = BUILDING_REACH_METERS;
  for (const building of data.buildings) {
    const distance = Math.hypot(building.center[0] - x, building.center[1] - y);
    if (distance < bestDistance) [best, bestDistance] = [building.center, distance];
  }
  return best;
}

const FIRST_RESPONSE: FireResponse = { construction: "older", engines: 1 };

// A fire the dispatcher lights at a house to rehearse. It stands in for the scenario on this screen
// only, starts burning the moment it is lit, and spreads the way the scenario's wind blows. Changing
// how the homes are built or how many crews respond re-runs the same fire from the same moment.
// The warning zone it proposes holds every building that burns, and the homes to warn are the ones inside it.
export function useSimulatedFire(scenario: Hazard | null, data: InkMapData | null, homes: Home[], toLocal: (at: LatLng) => Point) {
  const [ignition, setIgnition] = useState<Ignition | null>(null);
  const [response, setResponse] = useState<FireResponse>(FIRST_RESPONSE);
  const clock = useQuery(api.control.get)?.clock;

  const ignite = useCallback(
    (point: Point) => {
      const home = nearestHome(homes, point, toLocal);
      const at = home ? toLocal(home) : data ? nearestBuilding(data, point) : null;
      if (!at) return;
      setIgnition({ point: at, wind: downwindOf(scenario?.field.fronts), startedAt: simTime(clock, Date.now()) });
    },
    [homes, toLocal, scenario, clock, data],
  );

  const fire = useMemo(() => (ignition && data ? ignitionHazard(data.buildings, ignition.point, ignition.wind, response) : null), [data, ignition, response]);
  const zone = useMemo(() => (fire && data ? warningZoneAround(streetNetwork(data), fire.burnedAt) : null), [fire, data]);
  const homesToWarn = useMemo(() => {
    const ring = zone?.ring ?? fire?.field.fronts[fire.field.fronts.length - 1].ring;
    return ring ? homes.filter((home) => contains(ring, ...toLocal(home))).length : 0;
  }, [zone, fire, homes, toLocal]);
  const clear = useCallback(() => setIgnition(null), []);
  return { hazard: fire, startedAt: ignition?.startedAt, ignite, clear, response, setResponse, zoneCorners: zone?.corners ?? null, homesToWarn };
}
