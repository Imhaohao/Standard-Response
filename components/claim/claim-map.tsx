"use client";

import { FunctionReturnType } from "convex/server";
import { useCallback, useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { ZoomControls } from "@/components/map/zoom-controls";
import { HomeMark, MAP_TONE } from "@/components/floor/household-mark";
import { createProjection, Point } from "@/lib/ink-map/data";

export type KioskHome = FunctionReturnType<typeof api.claims.homes>[number];
// A house to glide the camera to. The key lets the same house be asked for twice.
export type FlyToHome = { householdId: Id<"households">; key: number };

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;
// A tap counts for the nearest open house within this many metres of it.
const PICK_RADIUS_METERS = 45;
const { ink: INK, paper: PAPER } = MAP_TONE;

function nearestOpen(homes: { home: KioskHome; at: Point }[], [x, y]: Point) {
  let best: KioskHome | null = null;
  let bestDistance = PICK_RADIUS_METERS;
  for (const { home, at } of homes) {
    if (home.state !== "open") continue;
    const distance = Math.hypot(at[0] - x, at[1] - y);
    if (distance < bestDistance) [best, bestDistance] = [home, distance];
  }
  return best;
}

// Houses a judge can't take are faint dots, so the open ones stand out as rings on the paper.
function HouseMark({ home, selected }: { home: KioskHome; selected: boolean }) {
  if (selected) {
    return (
      <>
        <circle r={9} fill="none" stroke={INK} strokeWidth={1.5} className="animate-ring-out" />
        <circle r={14} fill="none" stroke={PAPER} strokeWidth={5} />
        <circle r={14} fill="none" stroke={INK} strokeWidth={2.5} />
        <circle r={6} fill={INK} stroke={PAPER} strokeWidth={2} />
      </>
    );
  }
  if (home.state === "open") return <HomeMark kind="waiting" r={5.5} tone={MAP_TONE} />;
  return <circle r={2.4} fill={INK} fillOpacity={0.22} />;
}

// The real town map, full bleed. Behind the sign-in it is only scenery; once a judge has signed
// in, a click on an open house picks it.
export function ClaimMap({
  homes,
  selectedId,
  onSelect,
  flyTo,
  picking,
}: {
  homes: KioskHome[];
  selectedId: Id<"households"> | null;
  onSelect: (home: KioskHome) => void;
  flyTo: FlyToHome | null;
  picking: boolean;
}) {
  const data = useInkMapData();
  const toLocal = useMemo(() => (data ? createProjection(data.origin).toLocal : null), [data]);
  const placed = useMemo(() => (toLocal ? homes.map((home) => ({ home, at: toLocal(home) })) : []), [homes, toLocal]);
  const focus = useMemo(() => {
    const target = flyTo ? placed.find(({ home }) => home._id === flyTo.householdId) : undefined;
    return flyTo && target ? { point: target.at, key: `${flyTo.householdId}-${flyTo.key}` } : null;
  }, [flyTo, placed]);
  const pick = useCallback(
    (point: Point) => {
      const home = nearestOpen(placed, point);
      if (home) onSelect(home);
    },
    [placed, onSelect],
  );

  if (!data) return <div className="absolute inset-0 bg-map-paper" aria-hidden />;

  // Open houses draw last, so a faint neighbour never covers a ring.
  const ordered = [...homes].sort((a, b) => Number(a.state === "open") - Number(b.state === "open") || Number(a._id === selectedId) - Number(b._id === selectedId));
  return (
    <MapStage
      data={data}
      view={VIEW}
      onPick={picking ? pick : undefined}
      focus={focus}
      interactive={picking}
      className="absolute inset-0"
      controls={picking ? <ZoomControls className="absolute right-3 bottom-3" /> : null}
    >
      {ordered.map((home) => (
        <GeoAnchor key={home._id} at={home}>
          <HouseMark home={home} selected={home._id === selectedId} />
        </GeoAnchor>
      ))}
    </MapStage>
  );
}
