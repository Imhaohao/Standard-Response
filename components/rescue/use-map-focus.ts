"use client";

import { useCallback, useMemo, useState } from "react";
import { FlyTarget } from "@/components/map/map-stage";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { nearestHome } from "./house-card";
import { Home } from "./marks";
import { FocusProps } from "./need-panel";
import { Person } from "./use-rescue-board";

// What the dispatcher is looking at. A home is opened from a list row (the map flies there) or by
// clicking it on the map (it doesn't); either way its house card opens beside it. A row hovered
// rings its pin without moving anything, so the lists and the map point at each other.

type Selection = { householdId: string; point: Point; personId?: string; fly: boolean; n: number };

export function useMapFocus(homes: Home[], toLocal: (at: LatLng) => Point) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [hoveredPerson, setHoveredPerson] = useState<Person | null>(null);
  const [hoveredHome, setHoveredHome] = useState<string | null>(null);

  const select = useCallback(
    (next: Omit<Selection, "n">) =>
      setSelection((current) => (current?.householdId === next.householdId && next.fly ? null : { ...next, n: (current?.n ?? 0) + 1 })),
    [],
  );

  const focusProps = useMemo<FocusProps>(
    () => ({
      focusId: selection?.personId ?? null,
      onFocus: (person) => select({ householdId: person.householdId, point: person.at, personId: person._id, fly: true }),
      onHover: setHoveredPerson,
    }),
    [selection?.personId, select],
  );

  const homeFocus = useMemo(
    () => ({
      onFocus: (householdId: string) => {
        const home = homes.find((candidate) => candidate._id === householdId);
        if (home) select({ householdId, point: toLocal(home), fly: true });
      },
      onHover: setHoveredHome,
    }),
    [homes, toLocal, select],
  );

  const pickHome = useCallback(
    (point: Point) => {
      const home = nearestHome(homes, point, toLocal);
      if (!home) return setSelection(null);
      select({ householdId: home._id, point: toLocal(home), fly: false });
    },
    [homes, toLocal, select],
  );

  const flyTarget = useMemo<FlyTarget | null>(
    () => (selection?.fly ? { point: selection.point, key: `${selection.householdId}-${selection.n}` } : null),
    [selection],
  );

  const closeCard = useCallback(() => setSelection(null), []);

  return {
    ...emphasis(selection, hoveredPerson, hoveredHome),
    flyTarget,
    focusProps,
    homeFocus,
    pickHome,
    card: selection,
    closeCard,
  };
}

// The pin to ring, and the home whose pickup to bring forward: what's under the pointer first.
function emphasis(selection: Selection | null, hoveredPerson: Person | null, hoveredHome: string | null) {
  return {
    pinFocus: hoveredPerson?._id ?? selection?.personId ?? null,
    homeEmphasis: hoveredHome ?? hoveredPerson?.householdId ?? selection?.householdId ?? null,
  };
}

// Clicking the map opens a house card while nothing is being drawn; a drawing tool owns the click otherwise.
export function useMapClick(tool: string, draw: (point: Point) => void, pickHome: (point: Point) => void) {
  return tool === "look" ? pickHome : draw;
}
