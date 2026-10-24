import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { audit } from "./requests";

type Announces = Doc<"callbacks">["announces"];

export async function queueCallback(ctx: MutationCtx, assignment: Doc<"assignments">, announces: Announces) {
  const key = `${assignment.requestId}:${assignment._id}:${announces}`;
  const refs = { requestId: assignment.requestId, assignmentId: assignment._id };
  const existing = await ctx.db.query("callbacks").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (existing) {
    await audit(ctx, "callback_duplicate", `Duplicate ${announces} callback ignored`, refs);
    return existing._id;
  }
  await audit(ctx, "callback_queued", `${announces} callback queued`, refs);
  return await ctx.db.insert("callbacks", {
    key,
    requestId: assignment.requestId,
    assignmentId: assignment._id,
    householdId: assignment.householdId,
    announces,
    state: "pending",
    createdAt: Date.now(),
  });
}

// Voice server subscribes to this and places each call.
export const pending = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("callbacks").withIndex("by_state", (q) => q.eq("state", "pending")).take(50);
  },
});

async function setState(ctx: MutationCtx, callbackId: Id<"callbacks">, patch: Partial<Doc<"callbacks">>) {
  const callback = await ctx.db.get("callbacks", callbackId);
  if (!callback) throw new Error(`Callback ${callbackId} not found`);
  // Played is final. A repeated or late event must not move it back or restamp its time.
  if (callback.state === "played") return;
  await ctx.db.patch("callbacks", callbackId, patch);
}

export const markPlaced = mutation({
  args: { callbackId: v.id("callbacks") },
  returns: v.null(),
  handler: async (ctx, { callbackId }) => {
    await setState(ctx, callbackId, { state: "placed", placedAt: Date.now() });
    return null;
  },
});

// The template was spoken to the resident.
export const markPlayed = mutation({
  args: { callbackId: v.id("callbacks") },
  returns: v.null(),
  handler: async (ctx, { callbackId }) => {
    await setState(ctx, callbackId, { state: "played", playedAt: Date.now() });
    return null;
  },
});

// Nobody answered. The voice server retries through the reach ladder.
export const markUnanswered = mutation({
  args: { callbackId: v.id("callbacks") },
  returns: v.null(),
  handler: async (ctx, { callbackId }) => {
    await setState(ctx, callbackId, { state: "unanswered" });
    return null;
  },
});

// Under-the-hood screen: recent callbacks with their timing.
export const recent = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db.query("callbacks").order("desc").take(limit);
    return await Promise.all(
      rows.map(async (row) => ({ ...row, address: (await ctx.db.get("households", row.householdId))?.address })),
    );
  },
});
