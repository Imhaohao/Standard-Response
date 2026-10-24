"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";

export type PickupRow = FunctionReturnType<typeof api.pickups.board>[number];
export type PickupStatus = PickupRow["status"];
export type Pickup = PickupRow & { home: NonNullable<PickupRow["home"]>; at: Point; helperAt: Point | null };

// Every prearranged pickup with both ends placed on the map.
export function usePickups(toLocal: (point: LatLng) => Point) {
  const rows = useQuery(api.pickups.board);
  return useMemo(
    () =>
      (rows ?? []).flatMap((row): Pickup[] =>
        row.home ? [{ ...row, home: row.home, at: toLocal(row.home), helperAt: row.helperHome ? toLocal(row.helperHome) : null }] : [],
      ),
    [rows, toLocal],
  );
}

export const placeName = (pickup: Pick<Pickup, "home">) =>
  pickup.home.residentName ?? pickup.home.address.replace(/^\s*\d+[A-Za-z]?\s+/, "");
