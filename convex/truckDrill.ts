import { v } from "convex/values";
import { MutationCtx, query } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { minutesUntilHazard } from "./fireArrival";
import { DEFAULT_HAZARD, Hazard } from "./hazards";
import { located, outcomeFor, rideNeedFor } from "./model";
import { demoAreaHomes, SHELTERS } from "./seed";
import { runTruck, TruckHome } from "./truckRun";
import { ENGINE } from "./vehicleRun";

// The one-truck drill on the rescue map: a single fire engine sets out at the warning to pick up
// everyone in the zone who can't leave on their own. The whole run is worked out here at once
// (convex/truckRun.ts) and the map plays it back, so it never touches the live vehicles or plans.
//
// Who it picks up: the night's residents who told us they need a ride. Before the calls have found
// anyone, it uses the truth cards of the 200 simulated homes the warning seeds, labeled as such.

// LA County Fire Station 12 on Lincoln Ave, Altadena; the point is approximate and snaps to the nearest intersection.
const STATION = { name: "Station 12, Lincoln Ave", lat: 34.1916, lng: -118.1586 };
// The drill plays back in about two minutes, and never faster than an hour a minute.
const PLAYBACK_SECONDS = 120;
const MIN_PLAYBACK_RATE = 60;

type Target = TruckHome & { householdId?: Id<"households"> };

const NEEDS_RIDE = ["needs_ride", "needs_accessible"] as const;

function targetOf(hazard: Hazard, address: string, at: { lat: number; lng: number }, need: { boardingMinutes: number }, people: number) {
  return { address, at, people: Math.max(people, 1), boardingSeconds: need.boardingMinutes * 60, fireSeconds: minutesUntilHazard(at, hazard) * 60 };
}

async function boardTargets(ctx: MutationCtx, hazard: Hazard): Promise<Target[]> {
  const targets: Target[] = [];
  for (const outcome of NEEDS_RIDE) {
    const rows = await ctx.db.query("households").withIndex("by_outcome", (q) => q.eq("outcome", outcome)).take(300);
    for (const household of rows) {
      const need = rideNeedFor(household);
      if (!household.inZone || !located(household) || !need) continue;
      const at = { lat: household.lat, lng: household.lng };
      targets.push({ ...targetOf(hazard, household.address, at, need, household.peopleCount ?? 1), householdId: household._id });
    }
  }
  return targets;
}

export function areaTargets(hazard: Hazard): Target[] {
  return demoAreaHomes().flatMap((home) => {
    const { truth } = home.persona;
    const need = rideNeedFor({ ...truth, outcome: outcomeFor({ ...truth, callStatus: "complete" }) });
    return need ? [targetOf(hazard, home.address, { lat: home.lat, lng: home.lng }, need, truth.peopleCount)] : [];
  });
}

async function shelterOf(ctx: MutationCtx) {
  const shelter = await ctx.db.query("shelters").first();
  const { name, lat, lng } = shelter ?? SHELTERS[0];
  return { name, lat, lng };
}

const rounded = (value: number) => Math.round(value * 1e6) / 1e6;

function drillRow(targets: Target[], source: Doc<"truckDrills">["source"], shelter: Doc<"truckDrills">["shelter"], spec: typeof ENGINE) {
  const run = runTruck(STATION, shelter, targets, spec);
  return {
    ranAt: Date.now(),
    playbackRate: Math.max(MIN_PLAYBACK_RATE, run.endSeconds / PLAYBACK_SECONDS),
    source,
    ...spec,
    station: STATION,
    shelter,
    endSeconds: run.endSeconds,
    trucksNeeded: run.trucksNeeded,
    legs: run.legs.map((leg) => ({ ...leg, path: leg.path.map((p) => ({ lat: rounded(p.lat), lng: rounded(p.lng) })) })),
    stops: run.stops,
    homes: targets.map((target, i) => ({
      householdId: target.householdId,
      address: target.address,
      lat: target.at.lat,
      lng: target.at.lng,
      people: target.people,
      fireSeconds: target.fireSeconds,
      ...run.homes[i],
    })),
  };
}

export const latest = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("truckDrills").order("desc").first(),
});

export const run = mutation({
  args: { speedMph: v.optional(v.number()), seats: v.optional(v.number()) },
  returns: v.id("truckDrills"),
  handler: async (ctx, args) => {
    const speedMph = Math.min(Math.max(args.speedMph ?? ENGINE.speedMph, 5), 65);
    const seats = Math.min(Math.max(Math.round(args.seats ?? ENGINE.seats), 1), 12);
    const control = await ctx.db.query("control").first();
    const hazard = control?.hazard ?? DEFAULT_HAZARD;
    const board = await boardTargets(ctx, hazard);
    const [targets, source] = board.length > 0 ? [board, "board" as const] : [areaTargets(hazard), "simulated_area" as const];
    for (const old of await ctx.db.query("truckDrills").take(10)) await ctx.db.delete("truckDrills", old._id);
    return await ctx.db.insert("truckDrills", drillRow(targets, source, await shelterOf(ctx), { speedMph, seats }));
  },
});

export const clear = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const old of await ctx.db.query("truckDrills").take(10)) await ctx.db.delete("truckDrills", old._id);
    return null;
  },
});
