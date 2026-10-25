import type { QueryCtx } from "./_generated/server";
import { EDGES, edgeIndexOf, EdgeTime, freeFlow } from "./roadGraph";
import { MIN_SPEED_SHARE } from "../lib/crowd/greenshields";

// Evacuation traffic in the dispatcher's drive times. The mesh add-on's traffic forecast
// (lib/crowd/forecast.ts, run by `npm run forecast:traffic`) runs an ensemble of Langevin crowd
// simulations of the town an hour ahead and publishes how much slower each direction of each
// street will be than free flow, for 0–15, 15–30 and 30–60 minutes ahead. Here that becomes the
// time a vehicle takes to drive each street, so the solver, the revocation check, the ETA a rider
// hears and the simulated van's own drive all account for everyone else leaving. Vans drive in that
// traffic like any other car; nothing here gives them right of way.
//
// Each street is priced at the median over the ensemble for the window the drive reaches it in.
// Past the forecast's last window the last one holds. With no forecast for this incident, or one
// older than TRAFFIC_STALE_MS (the runner stopped), every street drives at free flow, as before.
// The forecast is a simulation of the synthetic population, not measured traffic.

export const TRAFFIC_STALE_MS = 15 * 60_000;

// What the dispatcher keeps of a forecast: each window in minutes from `baseAt` (the night's clock),
// with the median slowdown of every direction of a street that slows.
export type DispatchTraffic = {
  baseAt: number;
  windows: { from: number; to: number; edges: { key: string; slowdown: number }[] }[];
};

async function newestFor<T extends "meshTrafficForecasts" | "meshDriveTimes">(ctx: QueryCtx, table: T) {
  const control = await ctx.db.query("control").first();
  const latest = await ctx.db.query(table).withIndex("by_issuedAt").order("desc").first();
  if (!latest || control?.warningIssuedAt === undefined || latest.warningIssuedAt !== control.warningIssuedAt) return null;
  return latest;
}

// The agency view's forecast: the newest, if it was made for the current incident.
export async function currentTrafficForecast(ctx: QueryCtx) {
  return await newestFor(ctx, "meshTrafficForecasts");
}

// The dispatcher's cut of the same forecast (`meshDriveTimes`, a few tens of kB, read every re-plan).
export async function trafficForDispatch(ctx: QueryCtx, now: number): Promise<DispatchTraffic | null> {
  const latest = await newestFor(ctx, "meshDriveTimes");
  if (!latest || now - latest.baseAt > TRAFFIC_STALE_MS) return null;
  return {
    baseAt: latest.baseAt,
    windows: latest.windows.map(({ from, to, edgeKeys, slowdowns }) => ({ from, to, edges: edgeKeys.map((key, i) => ({ key, slowdown: slowdowns[i] })) })),
  };
}

// How many times longer a street takes at this slowdown, down to the crowd model's standstill floor.
export const timeFactor = (slowdown: number) => 1 / Math.max(MIN_SPEED_SHARE, 1 - slowdown);

// Drive times for a trip setting out at `now`. A drive that crosses from one window into the next
// covers the rest of the street at the next window's speed, so leaving later never arrives sooner.
export function trafficEdgeTime(traffic: DispatchTraffic | null, now: number): EdgeTime {
  if (!traffic || traffic.windows.length === 0) return freeFlow;
  const elapsed = (now - traffic.baseAt) / 1000;
  const windows = traffic.windows.map((window) => {
    const factors = new Map<number, number>();
    for (const { key, slowdown } of window.edges) {
      const index = edgeIndexOf(key);
      if (index !== undefined) factors.set(index, timeFactor(slowdown));
    }
    // Seconds after setting out when this window ends.
    return { end: window.to * 60 - elapsed, factors };
  });
  const last = windows.length - 1;
  return (edgeIndex, at) => {
    let freeSecondsLeft = EDGES[edgeIndex].seconds;
    let clock = at;
    const first = windows.findIndex((window) => clock < window.end);
    for (let k = first < 0 ? last : first; ; k++) {
      const window = windows[Math.min(k, last)];
      const factor = window.factors.get(edgeIndex) ?? 1;
      const end = k < last ? window.end : Infinity;
      const covered = (end - clock) / factor;
      if (covered >= freeSecondsLeft) return clock + freeSecondsLeft * factor - at;
      freeSecondsLeft -= covered;
      clock = end;
    }
  };
}
