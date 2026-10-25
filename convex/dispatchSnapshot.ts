import { internalQuery, QueryCtx } from "./_generated/server";
import { simTime } from "../lib/sim-clock";
import { Doc } from "./_generated/dataModel";
import { trafficForDispatch } from "./traffic";
import { readClosures } from "./roads";

// Everything one re-plan reads, in one consistent read.

const PLANNABLE = ["received", "approved", "driver_accepted", "en_route", "reassigning"] as const;

async function openRequests(ctx: QueryCtx) {
  const lists = await Promise.all(
    PLANNABLE.map((status) => ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", status)).take(500)),
  );
  return await Promise.all(
    lists.flat().map(async (request) => {
      const household = await ctx.db.get("households", request.householdId);
      return {
        request,
        lat: household?.lat,
        lng: household?.lng,
        oxygen: household?.medical?.includes("oxygen") ?? false,
        escalated: household?.escalation !== undefined,
      };
    }),
  );
}

async function assignmentsWith(ctx: QueryCtx, statuses: Doc<"assignments">["status"][]) {
  const lists = await Promise.all(
    statuses.map((status) => ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", status)).take(500)),
  );
  return lists.flat();
}

const REFUSALS = ["declined", "revoked", "expired"] as const;

// A driver who declined, cancelled or let the offer expire isn't offered the same rider again.
// Read per open request: across the whole table, a long night's refusals of riders long since
// carried would crowd out tonight's.
async function refusalsFor(ctx: QueryCtx, requests: { request: Doc<"requests"> }[]) {
  const lists = await Promise.all(
    requests.flatMap(({ request }) =>
      REFUSALS.map((status) =>
        ctx.db
          .query("assignments")
          .withIndex("by_requestId_and_status", (q) => q.eq("requestId", request._id).eq("status", status))
          .take(50),
      ),
    ),
  );
  return lists.flat();
}

// Riders picked up and not yet dropped off, as the movement tick keeps them.
async function onboardRiders(ctx: QueryCtx) {
  const loads = await ctx.db.query("vehicleLoads").take(200);
  return loads.flatMap((row) => row.riders.map((rider) => ({ vehicleId: row.vehicleId, shelterId: rider.shelterId, load: rider.load })));
}

export async function readSnapshot(ctx: QueryCtx) {
  const control = await ctx.db.query("control").first();
  const now = simTime(control?.clock, Date.now());
  const requests = await openRequests(ctx);
  return {
    now,
    requests,
    live: await assignmentsWith(ctx, ["proposed", "offered", "accepted"]),
    refused: await refusalsFor(ctx, requests),
    onboard: await onboardRiders(ctx),
    vehicles: await ctx.db.query("vehicles").take(200),
    shelters: await ctx.db.query("shelters").take(50),
    closures: await readClosures(ctx),
    routes: await ctx.db.query("vehicleRoutes").take(200),
    autoApprove: control?.autoApprove ?? false,
    // Forecast evacuation traffic for drive times, or null for free flow.
    traffic: await trafficForDispatch(ctx, now),
  };
}

export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;

export const snapshot = internalQuery({ args: {}, handler: readSnapshot });

