"use client";

import { useEffect, useMemo, useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { BUILDING_KIND, createProjection, InkMapData, Point } from "@/lib/ink-map/data";
import { arrivalMinutesAt, buildFireField, FireField, ScenarioGeoJson, scenarioFronts } from "@/lib/ink-map/fire-field";

export type StoryHouse = { id: number; center: Point; arrives: number };
export type StoryMap = { data: InkMapData; scenario: ScenarioGeoJson; fire: FireField; house: StoryHouse; homes: Point[] };

// The story's house stands in for the Mitchells' home: the house the fire reaches nearest the block
// LAist reported, the 100 block of W Terrace St in west Altadena, placed where the replay put it
// (data/eaton/replay-results.json, "terrace-w-100"). It is a neighbour's roof, not their address.
const STORY_BLOCK = { lat: 34.19456, lng: -118.1507 };

function pickStoryHouse(data: InkMapData, fire: FireField): StoryHouse | null {
  const [bx, by] = createProjection(data.origin).toLocal(STORY_BLOCK);
  let best: (StoryHouse & { distance: number }) | null = null;
  for (const building of data.buildings) {
    if (building.kind !== BUILDING_KIND.house) continue;
    const distance = Math.hypot(building.center[0] - bx, building.center[1] - by);
    if (best && distance >= best.distance) continue;
    const arrives = arrivalMinutesAt(fire, building.center);
    if (arrives === null) continue;
    best = { id: building.id, center: building.center, arrives, distance };
  }
  return best && { id: best.id, center: best.center, arrives: best.arrives };
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
