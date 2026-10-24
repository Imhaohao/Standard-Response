import { v } from "convex/values";
import { internalMutation, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { audit, releaseRequest, transitionRequest } from "./requests";
import { queueCallback } from "./callbacks";

export const OFFER_TTL_MS = 2 * 60_000;

const LIVE = new Set<Doc<"assignments">["status"]>(["proposed", "offered", "accepted"]);

export async function liveAssignmentsFor(ctx: QueryCtx, requestId: Id<"requests">) {
  const rows = await ctx.db
    .query("assignments")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .take(50);
  return rows.filter((a) => LIVE.has(a.status));
}

export async function liveAssignmentsForVehicle(ctx: QueryCtx, vehicleId: Id<"vehicles">) {
  const rows = await ctx.db
    .query("assignments")
    .withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicleId))
    .take(100);
  return rows.filter((a) => LIVE.has(a.status));
}

async function mustGet(ctx: QueryCtx, assignmentId: Id<"assignments">) {
  const assignment = await ctx.db.get("assignments", assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
  return assignment;
}

export async function approveAssignment(ctx: MutationCtx, assignmentId: Id<"assignments">) {
  const assignment = await mustGet(ctx, assignmentId);
  if (assignment.status !== "proposed") return;
  await ctx.db.patch("assignments", assignmentId, { status: "offered", offeredAt: Date.now() });
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
  await ctx.db.patch("assignments", assignmentId, { status: "accepted", respondedAt: Date.now() });
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
  await ctx.db.patch("assignments", assignment._id, { status, respondedAt: Date.now() });
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
  await ctx.db.patch("assignments", assignmentId, { status: "revoked", respondedAt: Date.now() });
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
    await ctx.db.patch("assignments", assignment._id, { status, respondedAt: Date.now() });
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
