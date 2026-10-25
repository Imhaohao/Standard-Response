"use client";

import { useEffect, useMemo, useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { BUILDING_KIND, createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { arrivalMinutesAt, buildFireField, FireField, ScenarioGeoJson, scenarioFronts } from "@/lib/ink-map/fire-field";

export type StoryHouse = { id: number; center: Point; arrives: number };
export type StoryMap = { data: InkMapData; scenario: ScenarioGeoJson; fire: FireField; house: StoryHouse; homes: Point[] };

// The story's house stands in for the Mitchells' home: a house in west Altadena that the scenario
// fire, which follows the Eaton Fire's path, reaches a few hours into the night. It is not their address.
const STORY_HOUSE_ARRIVAL_MINUTES = 150;

function pickStoryHouse(data: InkMapData, fire: FireField): StoryHouse | null {
  let best: StoryHouse | null = null;
  for (const building of data.buildings) {
    if (building.kind !== BUILDING_KIND.house) continue;
    const arrives = arrivalMinutesAt(fire, building.center);
    if (arrives === null) continue;
    if (best && Math.abs(arrives - STORY_HOUSE_ARRIVAL_MINUTES) >= Math.abs(best.arrives - STORY_HOUSE_ARRIVAL_MINUTES)) continue;
    best = { id: building.id, center: building.center, arrives };
  }
  return best;
}

function useScenario() {
  const [scenario, setScenario] = useState<ScenarioGeoJson | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/scenario?hazard=wildfire")
      .then((response) => response.json() as Promise<ScenarioGeoJson | null>)
      .then((file) => live && setScenario(file));
    return () => {
      live = false;
    };
  }, []);
  return scenario;
}

export function useStoryMap(): StoryMap | null {
  const data = useInkMapData();
  const scenario = useScenario();
  return useMemo(() => {
    if (!data || !scenario?.features?.length) return null;
    const fire = buildFireField(scenarioFronts(scenario, createProjection(data.origin).toLocal));
    const house = pickStoryHouse(data, fire);
    if (!house) return null;
    const homes = data.buildings.filter((b) => b.kind === BUILDING_KIND.house || b.kind === BUILDING_KIND.apartments).map((b) => b.center);
    return { data, scenario, fire, house, homes };
  }, [data, scenario]);
}
