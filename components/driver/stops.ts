"use client";

import { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";

export type Stop = FunctionReturnType<typeof api.offers.forVehicle>[number];
export type Vehicles = FunctionReturnType<typeof api.vehicles.list>;
export type Vehicle = Vehicles[number];

export const stopPlace = (stop: Stop): LatLng | null =>
  stop.lat !== undefined && stop.lng !== undefined ? { lat: stop.lat, lng: stop.lng } : null;

// Demo drivers (driven from this page) first, then everyone else.
export const pickerOrder = (vehicles: Vehicles) =>
  [...vehicles].sort((a, b) => Number(a.driverIsSimulated) - Number(b.driverIsSimulated) || a.label.localeCompare(b.label));

type OfferMemory = { seen: Map<string, Stop>; closed: Set<string>; dismissed: Set<string> };

// Offers this phone has shown. One the plan replaces either flips to "changed" right away, or, with
// hold on (a slow phone), stays tappable so the server can reject the late accept.
function useOfferMemory(live: Stop[]) {
  const [memory, setMemory] = useState<OfferMemory>({ seen: new Map(), closed: new Set(), dismissed: new Set() });
  const unseen = live.filter((stop) => memory.seen.get(stop._id)?.status !== stop.status);
  useEffect(() => {
    if (unseen.length === 0) return;
    const id = setTimeout(() =>
      setMemory((m) => ({ ...m, seen: new Map([...m.seen, ...unseen.map((s) => [s._id, s] as const)]) })),
    );
    return () => clearTimeout(id);
  });
  const mark = (key: "closed" | "dismissed", stopId: string) => setMemory((m) => ({ ...m, [key]: new Set([...m[key], stopId]) }));
  return { memory, mark };
}

export type DriverBoard = {
  offers: Stop[];
  changed: Stop[];
  run: Stop[];
  markChanged: (stopId: string) => void;
  dismiss: (stopId: string) => void;
};

// Sorts what the driver sees into three piles: offers to answer, offers a re-plan took away, and the
// accepted run in stop order.
export function useDriverBoard(stops: Stop[], hold: boolean): DriverBoard {
  const pending = stops.filter((stop) => stop.status !== "accepted");
  const { memory, mark } = useOfferMemory(pending);
  const liveIds = new Set(stops.map((stop) => stop._id));
  const gone = [...memory.seen.values()].filter((stop) => !liveIds.has(stop._id) && stop.status === "offered" && !memory.dismissed.has(stop._id));
  const isChanged = (stop: Stop) => memory.closed.has(stop._id) || (!liveIds.has(stop._id) && !hold);
  const shown = [...pending.filter((stop) => !memory.dismissed.has(stop._id)), ...gone];

  return {
    offers: shown.filter((stop) => !isChanged(stop)),
    changed: shown.filter(isChanged),
    run: stops.filter((stop) => stop.status === "accepted"),
    markChanged: (stopId) => mark("closed", stopId),
    dismiss: (stopId) => mark("dismissed", stopId),
  };
}
