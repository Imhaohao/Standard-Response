"use client";

import { useEffect, useMemo } from "react";
import { buildGround, toLatLng } from "@/lib/crowd/grid";
import { CrowdSim, DEFAULT_CROWD, STATE } from "@/lib/crowd/langevin";
import { createProjection, type InkMapData, type Point } from "@/lib/ink-map/data";
import type { ScenarioGeoJson } from "@/lib/ink-map/fire-field";
import { seededRandom } from "@/lib/mesh/random";
import type { Town } from "./town";

// The flow lab's crowd model, unchanged: every household leaving as a particle under Langevin
// dynamics on the real streets. The deck runs every household in town: a sample thins the traffic
// until the jams never form.
const CELL_METERS = 30;
const SEED = 7;
// A car moving at under this share of its street's free speed is stuck in traffic.
export const JAMMED_PACE = 0.45;
// The night is run ahead to this minute in the background, so cars are already on the road when the
// crowd beat opens.
const WARM_MINUTES = 22;
const WARM_SLICE_MS = 24;

export type CrowdDot = { at: Point; jammed: boolean };

export class DeckCrowd {
  private readonly toLocal: (lat: number, lng: number) => Point;

  constructor(
    readonly sim: CrowdSim,
    data: InkMapData,
  ) {
    const projection = createProjection(data.origin);
    this.toLocal = (lat, lng) => projection.toLocal({ lat, lng });
  }

  // Steps the night for at most `budgetMs` of wall clock, or until it has covered `simSeconds`.
  run(simSeconds: number, budgetMs: number) {
    const began = performance.now();
    const target = this.sim.seconds + simSeconds;
    while (this.sim.seconds < target && performance.now() - began < budgetMs) this.sim.step();
  }

  movingDots(): CrowdDot[] {
    const { sim } = this;
    const dots: CrowdDot[] = [];
    for (let i = 0; i < sim.count; i++) {
      if (sim.state[i] !== STATE.moving) continue;
      const { lat, lng } = toLatLng(sim.x[i], sim.y[i]);
      dots.push({ at: this.toLocal(lat, lng), jammed: sim.pace[i] < JAMMED_PACE });
    }
    return dots;
  }
}

function useWarmUp(crowd: DeckCrowd | null) {
  useEffect(() => {
    if (!crowd) return;
    let frame = 0;
    const warm = () => {
      crowd.run(WARM_MINUTES * 60 - crowd.sim.seconds, WARM_SLICE_MS);
      if (crowd.sim.seconds < WARM_MINUTES * 60) frame = requestAnimationFrame(warm);
    };
    frame = requestAnimationFrame(warm);
    return () => cancelAnimationFrame(frame);
  }, [crowd]);
}

export function useDeckCrowd(data: InkMapData | null, scenario: ScenarioGeoJson | null, town: Town | null) {
  const crowd = useMemo(() => {
    if (!data || !scenario || !town) return null;
    const sim = new CrowdSim(buildGround(CELL_METERS, scenario), town.households, seededRandom(SEED + 2), () => new Set(), { ...DEFAULT_CROWD, dt: 1 });
    return new DeckCrowd(sim, data);
  }, [data, scenario, town]);
  useWarmUp(crowd);
  return crowd;
}
