"use client";

import { useMemo } from "react";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { buildPlaceIndex, buildingForPoint } from "@/lib/ink-map/place";
import { BuildingState, Occupancy } from "@/lib/ink-map/renderer";

// One household, in map metres. Level is how red their building goes for a ride request; a pulse
// means nobody has answered them yet. Occupancy darkens a roof whose household is still home, or
// clears one whose household has left.
export type NeedMark = { point: Point; level: number; pulse?: boolean; occupancy?: Occupancy };

function merge(held: BuildingState | undefined, mark: NeedMark): BuildingState {
  const louder = !held || mark.level > held.level;
  const occupancy = held?.occupancy === "stillHome" ? "stillHome" : (mark.occupancy ?? held?.occupancy);
  return {
    level: louder ? mark.level : held.level,
    pulse: louder ? (mark.pulse ?? false) : held.pulse,
    occupancy,
  };
}

// Turns people into roofs. The renderer paints buildings by index, so this is the only place the
// rescue map has to know how a household becomes a highlighted building.
export function useBuildingHighlights(data: InkMapData | null, marks: NeedMark[]): Map<number, BuildingState> {
  const index = useMemo(() => (data ? buildPlaceIndex(data) : null), [data]);
  return useMemo(() => {
    const states = new Map<number, BuildingState>();
    if (!data || !index) return states;
    for (const mark of marks) {
      const id = buildingForPoint(index, data, mark.point);
      if (id === null) continue;
      states.set(id, merge(states.get(id), mark));
    }
    return states;
  }, [data, index, marks]);
}
