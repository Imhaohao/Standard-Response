import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { vehicleCanServe } from "./model";
import { approveAssignment, liveAssignmentsFor, liveAssignmentsForVehicle, replaceAssignment, revokeAssignment } from "./offers";
import { audit } from "./requests";

const offer = v.object({
  requestId: v.id("requests"),
  vehicleId: v.id("vehicles"),
  shelterId: v.optional(v.id("shelters")),
  etaMinutes: v.number(),
  stopOrder: v.number(),
});

export const proposal = v.object({
  solver: v.union(v.literal("stand_in"), v.literal("heuristic"), v.literal("ortools")),
  solveMs: v.number(),
  offers: v.array(offer),
  // Open offers this plan changes. They end silently.
  replace: v.array(v.id("assignments")),
  // Accepted pickups no route reaches in time. The rider is told right away.
  revoke: v.array(v.id("assignments")),
  requestCount: v.optional(v.number()),
  vehicleCount: v.optional(v.number()),
  fallbackReason: v.optional(v.string()),
});

export type Proposal = typeof proposal.type;
type Offer = typeof offer.type;

async function nextVersion(ctx: MutationCtx) {
  const latest = await ctx.db.query("plans").withIndex("by_version").order("desc").first();
  return (latest?.version ?? 0) + 1;
}

async function assertOfferAllowed(ctx: MutationCtx, item: Offer) {
  const request = await ctx.db.get("requests", item.requestId);
  const vehicle = await ctx.db.get("vehicles", item.vehicleId);
  if (!request || !vehicle) throw new Error("Offer names a missing request or vehicle");
  if (!vehicleCanServe(vehicle, request)) throw new Error(`${vehicle.label} can't serve request ${request._id}`);
  const vehicleRun = await liveAssignmentsForVehicle(ctx, vehicle._id);
  const lastAccepted = Math.max(-1, ...vehicleRun.filter((a) => a.status === "accepted").map((a) => a.stopOrder));
  if (item.stopOrder <= lastAccepted) throw new Error(`${vehicle.label}'s accepted run can't take new stops`);
  const live = await liveAssignmentsFor(ctx, request._id);
  if (live.length > 0) throw new Error(`Request ${request._id} already has a live assignment; replace it first`);
  return request;
}

type Change = Doc<"plans">["changes"][number];

async function changeFor(ctx: MutationCtx, assignmentId: Id<"assignments">, kind: "replace" | "revoke"): Promise<Change> {
  const assignment = await ctx.db.get("assignments", assignmentId);
  if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);
  return { kind, requestId: assignment.requestId, vehicleId: assignment.vehicleId };
}

// Writes plan vN. Accepted runs never change here except through `revoke`.
export async function writePlan(ctx: MutationCtx, plan: Proposal, autoApprove: boolean) {
  const version = await nextVersion(ctx);
  const now = Date.now();
  const changes: Change[] = [];
  for (const id of plan.replace) {
    changes.push(await changeFor(ctx, id, "replace"));
    await replaceAssignment(ctx, id);
  }
  for (const id of plan.revoke) {
    changes.push(await changeFor(ctx, id, "revoke"));
    await revokeAssignment(ctx, id);
  }
  for (const item of plan.offers) {
    const request = await assertOfferAllowed(ctx, item);
    const assignmentId = await ctx.db.insert("assignments", {
      ...item,
      householdId: request.householdId,
      planVersion: version,
      status: "proposed",
      proposedAt: now,
    });
    changes.push({ kind: "offer", requestId: item.requestId, vehicleId: item.vehicleId });
    if (autoApprove) await approveAssignment(ctx, assignmentId);
  }
  const { solver, solveMs, requestCount, vehicleCount, fallbackReason } = plan;
  await ctx.db.insert("plans", { version, solver, solveMs, requestCount, vehicleCount, fallbackReason, changes, createdAt: now });
  await audit(ctx, "plan", `New plan with ${changes.length} change${changes.length === 1 ? "" : "s"}`, { planVersion: version });
  return version;
}

// Dispatch solver (Track C) writes each re-solve here. Proposed offers wait for the dispatcher.
export const propose = mutation({
  args: proposal,
  returns: v.number(),
  handler: async (ctx, plan) => {
    const control = await ctx.db.query("control").first();
    return await writePlan(ctx, plan, control?.autoApprove ?? false);
  },
});

export const latest = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("plans").withIndex("by_version").order("desc").first(),
});

export const auditTrail = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => await ctx.db.query("auditLog").order("desc").take(limit),
});
