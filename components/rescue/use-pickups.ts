"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { streetDrive } from "@/lib/ink-map/road-route";

export type PickupRow = FunctionReturnType<typeof api.pickups.board>[number];
export type PickupStatus = PickupRow["status"];
// `drive` is the helper's way over by street, or null when the helper has no home on the map.
export type Pickup = PickupRow & { home: NonNullable<PickupRow["home"]>; at: Point; helperAt: Point | null; drive: Point[] | null };

function driveBetween(data: InkMapData | null, from: Point | null, to: Point, closed: Set<string>) {
  if (!from) return null;
  return (data && streetDrive(data, from, to, closed)) ?? [from, to];
}

// Every prearranged pickup with both ends placed on the map, and the streets the helper drives.
export function usePickups(data: InkMapData | null, toLocal: (point: LatLng) => Point, closed: Set<string>) {
  const rows = useQuery(api.pickups.board);
  return useMemo(
    () =>
      (rows ?? []).flatMap((row): Pickup[] => {
        if (!row.home) return [];
        const at = toLocal(row.home);
        const helperAt = row.helperHome ? toLocal(row.helperHome) : null;
        return [{ ...row, home: row.home, at, helperAt, drive: driveBetween(data, helperAt, at, closed) }];
      }),
    [rows, toLocal, data, closed],
  );
}

export const placeName = (pickup: Pick<Pickup, "home">) =>
  pickup.home.residentName ?? pickup.home.address.replace(/^\s*\d+[A-Za-z]?\s+/, "");
