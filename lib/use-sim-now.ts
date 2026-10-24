"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { simTime } from "./sim-clock";
import { useNow } from "./time";

// The night's clock as the backend keeps it, which the rescue map can pause or speed up. Compare
// stored times against this, never against Date.now(). Like useNow, it reads 0 before the first tick.
export function useSimNow(intervalMs = 1000) {
  const clock = useQuery(api.control.get)?.clock;
  const real = useNow(intervalMs);
  return real === 0 ? 0 : simTime(clock, real);
}
