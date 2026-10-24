"use client";

import { useMemo } from "react";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { buildPlaceIndex, buildingForPoint } from "@/lib/ink-map/place";
import { BuildingState } from "@/lib/ink-map/renderer";

// One person who needs help, in map metres. Level is how red their building goes; a pulse means
// nobody has answered them yet.
export type NeedMark = { point: Point; level: number; pulse?: boolean };

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
      const held = states.get(id);
      if (held && held.level >= mark.level) continue;
      states.set(id, { level: mark.level, pulse: mark.pulse ?? false });
    }
    return states;
  }, [data, index, marks]);
}
