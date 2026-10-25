import { v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { audit, releaseRequest, transitionRequest } from "./requests";
import { queueCallback } from "./callbacks";
import { OFFER_TTL_MS } from "./model";
import { simNow } from "./clock";


const LIVE = ["proposed", "offered", "accepted"] as const;

// Read by status, not by reading the oldest rows and filtering: every re-plan and expiry leaves an
// ended assignment behind, and on a long night the live ones sit far past any fixed limit.
const oldestFirst = (rows: Doc<"assignments">[][]) => rows.flat().sort((a, b) => a._creationTime - b._creationTime);

export async function liveAssignmentsFor(ctx: QueryCtx, requestId: Id<"requests">) {
  const lists = await Promise.all(
    LIVE.map((status) =>
      ctx.db
        .query("assignments")
        .withIndex("by_requestId_and_status", (q) => q.eq("requestId", requestId).eq("status", status))
        .take(50),
    ),
  );
  return oldestFirst(lists);
}

export async function liveAssignmentsForVehicle(ctx: QueryCtx, vehicleId: Id<"vehicles">) {
  const lists = await Promise.all(
    LIVE.map((status) =>
      ctx.db
        .query("assignments")
        .withIndex("by_vehicleId_and_status_and_stopOrder", (q) => q.eq("vehicleId", vehicleId).eq("status", status))
        .take(100),
    ),
  );
  return oldestFirst(lists);
}

async function mustGet(ctx: QueryCtx, assignmentId: Id<"assignments">) {
  const assignment = await ctx.db.get("assignments", assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
  return assignment;
}

export async function approveAssignment(ctx: MutationCtx, assignmentId: Id<"assignments">) {
  const assignment = await mustGet(ctx, assignmentId);
  if (assignment.status !== "proposed") return;
  await ctx.db.patch("assignments", assignmentId, { status: "offered", offeredAt: await simNow(ctx) });
  const request = await ctx.db.get("requests", assignment.requestId);
  if (request?.status === "received") await transitionRequest(ctx, request._id, "approved");
  await audit(ctx, "approved", "Offer approved and sent to the driver", {
    requestId: assignment.requestId,
    assignmentId,
    planVersion: assignment.planVersion,
  });
  await ctx.scheduler.runAfter(OFFER_TTL_MS, internal.offers.expire, { assignmentId });
}

// Succeeds only while this offer is still open. Convex runs the check and the write in one transaction.
export async function acceptAssignment(ctx: MutationCtx, assignmentId: Id<"assignments">) {
  const assignment = await mustGet(ctx, assignmentId);
  const refs = { requestId: assignment.requestId, assignmentId, planVersion: assignment.planVersion };
  if (assignment.status !== "offered") {
    await audit(ctx, "stale_accept_rejected", `Accept on a ${assignment.status} offer rejected`, refs);
    return "changed" as const;
  }
  await ctx.db.patch("assignments", assignmentId, { status: "accepted", respondedAt: await simNow(ctx) });
  await transitionRequest(ctx, assignment.requestId, "driver_accepted");
  await audit(ctx, "accepted", "Driver accepted", refs);
  await queueCallback(ctx, { ...assignment, _id: assignmentId }, "driver_accepted");
  return "accepted" as const;
}

async function endOpenOffer(
  ctx: MutationCtx,
  assignment: Doc<"assignments">,
  status: "declined" | "expired" | "replaced",
) {
  await ctx.db.patch("assignments", assignment._id, { status, respondedAt: await simNow(ctx) });
  await releaseRequest(ctx, assignment.requestId);
  await audit(ctx, status, `Offer ${status}`, {
    requestId: assignment.requestId,
    assignmentId: assignment._id,
    planVersion: assignment.planVersion,
  });
}

// An open offer the new plan changed. Silent: the rider never heard about it.
export async function replaceAssignment(ctx: MutationCtx, assignmentId: Id<"assignments">) {
  const assignment = await mustGet(ctx, assignmentId);
  if (assignment.status === "proposed" || assignment.status === "offered") {
    await endOpenOffer(ctx, assignment, "replaced");
  }
}

// An accepted pickup the driver can no longer make. The rider is told right away.
export async function revokeAssignment(ctx: MutationCtx, assignmentId: Id<"assignments">) {
  const assignment = await mustGet(ctx, assignmentId);
  if (assignment.status !== "accepted") return replaceAssignment(ctx, assignmentId);
  await ctx.db.patch("assignments", assignmentId, { status: "revoked", respondedAt: await simNow(ctx) });
  await transitionRequest(ctx, assignment.requestId, "reassigning");
  await audit(ctx, "revoked", "Accepted pickup revoked", {
    requestId: assignment.requestId,
    assignmentId,
    planVersion: assignment.planVersion,
  });
  await queueCallback(ctx, assignment, "reassigning");
}

// The rider no longer needs a ride. Ends every live assignment without calling them.
export async function closeAssignmentsFor(ctx: MutationCtx, requestId: Id<"requests">) {
  for (const assignment of await liveAssignmentsFor(ctx, requestId)) {
    const status = assignment.status === "accepted" ? "revoked" : "replaced";
    await ctx.db.patch("assignments", assignment._id, { status, respondedAt: await simNow(ctx) });
  }
}

export async function completeAssignment(ctx: MutationCtx, assignmentId: Id<"assignments">) {
  const assignment = await mustGet(ctx, assignmentId);
  await ctx.db.patch("assignments", assignmentId, { status: "completed" });
  await transitionRequest(ctx, assignment.requestId, "arrived");
}

// Rescue map: the dispatcher approves a proposed offer.
export const approve = mutation({
  args: { assignmentId: v.id("assignments") },
  returns: v.null(),
  handler: async (ctx, { assignmentId }) => {
    await approveAssignment(ctx, assignmentId);
    return null;
  },
});

// Driver page. "changed" means the plan replaced this offer; show "This assignment changed".
export const accept = mutation({
  args: { assignmentId: v.id("assignments") },
  returns: v.union(v.literal("accepted"), v.literal("changed")),
  handler: async (ctx, { assignmentId }) => await acceptAssignment(ctx, assignmentId),
});

export const decline = mutation({
  args: { assignmentId: v.id("assignments") },
  returns: v.null(),
  handler: async (ctx, { assignmentId }) => {
    const assignment = await mustGet(ctx, assignmentId);
    if (assignment.status === "offered") await endOpenOffer(ctx, assignment, "declined");
    return null;
  },
});

// Driver page: the driver can't make an accepted pickup.
export const cancelByDriver = mutation({
  args: { assignmentId: v.id("assignments") },
  returns: v.null(),
  handler: async (ctx, { assignmentId }) => {
    await revokeAssignment(ctx, assignmentId);
    return null;
  },
});

export const expire = internalMutation({
  args: { assignmentId: v.id("assignments") },
  returns: v.null(),
  handler: async (ctx, { assignmentId }) => {
    const assignment = await ctx.db.get("assignments", assignmentId);
    if (assignment?.status === "offered") await endOpenOffer(ctx, assignment, "expired");
    return null;
  },
});

// What the driver needs to know about the person, not just the van. Read-only, and additive:
// nothing that read this row before loses a field.
function riderFacts(household: Doc<"households"> | null) {
  if (!household) return null;
  return {
    residentName: household.residentName,
    language: household.language,
    peopleCount: household.peopleCount,
    mobility: household.mobility,
    assistanceRequired: household.assistanceRequired,
    medical: household.medical,
    pets: household.pets,
    // Where they sleep, care needs and a note for the crew, from the Ready check.
    ready: household.ready,
  };
}

async function withContext(ctx: QueryCtx, assignment: Doc<"assignments">) {
  const household = await ctx.db.get("households", assignment.householdId);
  const request = await ctx.db.get("requests", assignment.requestId);
  return {
    ...assignment,
    address: household?.address ?? "Unknown address",
    lat: household?.lat,
    lng: household?.lng,
    load: request?.load,
    crewNeeded: request?.crewNeeded,
    needsLift: request?.needsLift,
    deadlineAt: request?.deadlineAt,
    rider: riderFacts(household),
  };
}

// Driver page: this vehicle's accepted run in stop order, plus its open offers.
export const forVehicle = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, { vehicleId }) => {
    const live = await liveAssignmentsForVehicle(ctx, vehicleId);
    const rows = await Promise.all(live.map((a) => withContext(ctx, a)));
    return rows.sort((a, b) => a.stopOrder - b.stopOrder);
  },
});

const ACTIVE = ["proposed", "offered", "accepted"] as const;

// Rescue map: every proposed, offered and accepted assignment.
export const active = query({
  args: {},
  handler: async (ctx) => {
    const lists = await Promise.all(
      ACTIVE.map((status) => ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", status)).take(500)),
    );
    return await Promise.all(lists.flat().map((a) => withContext(ctx, a)));
  },
});
