import { internalQuery, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";

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

// Riders picked up and not yet dropped off: the request is "arrived" and its assignment completed.
async function onboardRiders(ctx: QueryCtx) {
  const arrived = await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", "arrived")).take(500);
  const riders = [];
  for (const request of arrived) {
    const rows = await ctx.db.query("assignments").withIndex("by_requestId", (q) => q.eq("requestId", request._id)).take(50);
    const completed = rows.find((a) => a.status === "completed");
    if (completed) riders.push({ vehicleId: completed.vehicleId, load: request.load });
  }
  return riders;
}

// People already dropped at, or promised to, each shelter. Their requests carry the party size.
async function shelterOccupancy(ctx: QueryCtx) {
  const occupied: Record<string, number> = {};
  for (const assignment of await assignmentsWith(ctx, ["accepted", "completed"])) {
    if (!assignment.shelterId) continue;
    const request = await ctx.db.get("requests", assignment.requestId);
    if (!request) continue;
    const party = request.load.seats + request.load.wheelchairSpaces + request.load.stretcherSpaces;
    occupied[assignment.shelterId] = (occupied[assignment.shelterId] ?? 0) + party;
  }
  return occupied;
}

export async function readSnapshot(ctx: QueryCtx) {
  const control = await ctx.db.query("control").first();
  return {
    requests: await openRequests(ctx),
    live: await assignmentsWith(ctx, ["proposed", "offered", "accepted"]),
    // A driver who declined, cancelled or let the offer expire isn't offered the same rider again.
    refused: await assignmentsWith(ctx, ["declined", "revoked", "expired"]),
    onboard: await onboardRiders(ctx),
    vehicles: await ctx.db.query("vehicles").take(200),
    shelters: await ctx.db.query("shelters").take(50),
    closures: await ctx.db.query("roadClosures").take(1000),
    routes: await ctx.db.query("vehicleRoutes").take(200),
    shelterOccupancy: await shelterOccupancy(ctx),
    autoApprove: control?.autoApprove ?? false,
  };
}

export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;

export const snapshot = internalQuery({ args: {}, handler: readSnapshot });

