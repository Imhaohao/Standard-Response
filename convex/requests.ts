import { v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { auditKind, escalation, requestStatus } from "./schema";
import { deadlineFor, PartyNeed, RideParty, rideNeedFor, ridePartiesFor, vehicleCanServe } from "./model";
import { closeAssignmentsFor, liveAssignmentsFor, replaceAssignment, revokeAssignment } from "./offers";
import { helperCovers } from "./pickupCover";
import { simNow } from "./clock";

export type RequestStatus = Doc<"requests">["status"];

// Every status but closed.
const OPEN_STATUSES: RequestStatus[] = ["received", "approved", "driver_accepted", "en_route", "reassigning", "arrived"];

// Waiting for a driver: the only statuses a new offer may be made for.
export const OFFERABLE = new Set<RequestStatus>(["received", "approved", "reassigning"]);

// The only legal moves. Every status write goes through `transitionRequest`.
const NEXT: Record<RequestStatus, RequestStatus[]> = {
  received: ["approved", "closed"],
  approved: ["received", "driver_accepted", "closed"],
  driver_accepted: ["en_route", "arrived", "reassigning", "closed"],
  en_route: ["arrived", "reassigning", "closed"],
  reassigning: ["driver_accepted", "closed"],
  arrived: ["closed"],
  closed: [],
};

export async function audit(
  ctx: MutationCtx,
  kind: typeof auditKind.type,
  message: string,
  refs: { requestId?: Id<"requests">; assignmentId?: Id<"assignments">; planVersion?: number } = {},
) {
  await ctx.db.insert("auditLog", { kind, message, ...refs, at: await simNow(ctx) });
}

export async function transitionRequest(ctx: MutationCtx, requestId: Id<"requests">, to: RequestStatus) {
  const request = await ctx.db.get("requests", requestId);
  if (!request) throw new Error(`Request ${requestId} not found`);
  if (request.status === to) return request;
  if (!NEXT[request.status].includes(to)) {
    throw new Error(`Request ${requestId} cannot move from ${request.status} to ${to}`);
  }
  await ctx.db.patch("requests", requestId, { status: to, updatedAt: await simNow(ctx) });
  await audit(ctx, "status", `${request.status} to ${to}`, { requestId });
  return { ...request, status: to };
}

// An open offer went away before anyone accepted it. The rider never heard about it, so nothing is said.
export async function releaseRequest(ctx: MutationCtx, requestId: Id<"requests">) {
  const request = await ctx.db.get("requests", requestId);
  if (request?.status === "approved") await transitionRequest(ctx, requestId, "received");
}

// By status, so a home whose rider changed their mind many times still finds its open requests.
export async function openRequestsFor(ctx: QueryCtx, householdId: Id<"households">) {
  const byStatus = await Promise.all(
    OPEN_STATUSES.map((status) =>
      ctx.db
        .query("requests")
        .withIndex("by_householdId_and_status", (q) => q.eq("householdId", householdId).eq("status", status))
        .take(5),
    ),
  );
  return byStatus.flat().sort((a, b) => a._creationTime - b._creationTime);
}

// The patient's ride when a home rides in two parties: it's the one a caller asks about.
export async function openRequestFor(ctx: QueryCtx, householdId: Id<"households">) {
  const open = await openRequestsFor(ctx, householdId);
  return open.find((r) => r.party !== "companions") ?? open[0] ?? null;
}

async function closeRequest(ctx: MutationCtx, request: Doc<"requests">) {
  await closeAssignmentsFor(ctx, request._id);
  await transitionRequest(ctx, request._id, "closed");
}

async function dropIncompatibleAssignments(ctx: MutationCtx, request: Doc<"requests">) {
  for (const assignment of await liveAssignmentsFor(ctx, request._id)) {
    const vehicle = await ctx.db.get("vehicles", assignment.vehicleId);
    if (vehicle && vehicleCanServe(vehicle, request)) continue;
    if (assignment.status === "accepted") await revokeAssignment(ctx, assignment._id);
    else await replaceAssignment(ctx, assignment._id);
  }
}

// A whole-home ride and the patient's ride are the same request, so a split or a merge keeps its van.
const partyKey = (party?: RideParty) => (party === "companions" ? "companions" : "main");

async function syncParty(ctx: MutationCtx, householdId: Id<"households">, open: Doc<"requests">[], shared: { deadlineAt: number; updatedAt: number }, { party, need }: PartyNeed) {
  const existing = open.find((r) => partyKey(r.party) === partyKey(party));
  if (!existing) {
    await ctx.db.insert("requests", { householdId, status: "received", ...need, ...shared, ...(party ? { party } : {}) });
    return;
  }
  const fields = { ...need, ...shared, party };
  await ctx.db.patch("requests", existing._id, fields);
  await dropIncompatibleAssignments(ctx, { ...existing, ...fields });
}

// Keeps the ride requests in step with the household record. Called after every record change,
// so a correction on a call reaches any open offer.
export async function syncRequest(ctx: MutationCtx, householdId: Id<"households">) {
  const household = await ctx.db.get("households", householdId);
  if (!household) return;
  const need = rideNeedFor(household);
  const open = await openRequestsFor(ctx, householdId);
  if (!need) {
    for (const request of open) await closeRequest(ctx, request);
    return;
  }
  // A neighbor on the way means no van yet; a ride already open keeps its van.
  if (open.length === 0 && (await helperCovers(ctx, householdId))) return;
  const parties = ridePartiesFor(need, await ctx.db.query("vehicles").take(500));
  const shared = { deadlineAt: deadlineFor(household.fireArrivalAt), updatedAt: await simNow(ctx) };
  for (const party of parties) await syncParty(ctx, householdId, open, shared, party);
  const kept = new Set(parties.map((p) => partyKey(p.party)));
  for (const request of open) if (!kept.has(partyKey(request.party))) await closeRequest(ctx, request);
}

export const forHousehold = query({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), v.object({ _id: v.id("requests"), status: requestStatus })),
  handler: async (ctx, { householdId }) => {
    const request = await openRequestFor(ctx, householdId);
    return request ? { _id: request._id, status: request.status } : null;
  },
});

// Every request that isn't closed, with the household's location. Dispatchers and the rescue map read this.
export const open = query({
  args: {},
  handler: async (ctx) => {
    const lists = await Promise.all(
      OPEN_STATUSES.map((status) =>
        ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", status)).take(500),
      ),
    );
    return await Promise.all(
      lists.flat().map(async (request) => {
        const household = await ctx.db.get("households", request.householdId);
        return {
          ...request,
          address: household?.address ?? "Unknown address",
          lat: household?.lat,
          lng: household?.lng,
          escalation: household?.escalation,
          residentName: household?.residentName,
          callbackNumber: household?.callbackNumber,
        };
      }),
    );
  },
});

// Hard escalations go red at the top of the dispatcher's list.
export const escalate = mutation({
  args: { householdId: v.id("households"), kind: escalation },
  returns: v.null(),
  handler: async (ctx, { householdId, kind }) => {
    await escalateHousehold(ctx, householdId, kind);
    return null;
  },
});

export async function escalateHousehold(ctx: MutationCtx, householdId: Id<"households">, kind: typeof escalation.type) {
  const household = await ctx.db.get("households", householdId);
  if (!household) throw new Error(`Household ${householdId} not found`);
  await ctx.db.patch("households", householdId, { escalation: kind });
  await ctx.db.insert("events", {
    kind: "dispatch",
    message: `${household.address} escalated: ${kind.replace("_", " ")}`,
    householdId,
    at: await simNow(ctx),
  });
}
