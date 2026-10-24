import { v } from "convex/values";
import { internalMutation, mutation, query, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { seedFleetIfEmpty, seedSimulatedArea } from "./seed";
import { startCall } from "./calls";
import { TICK_MS } from "./sim";

const DEFAULTS = {
  dialerRunning: false,
  maxConcurrentCalls: 12,
  simulateVoice: true,
  simulateNeedModel: true,
  simulateDispatch: true,
  simulateDrivers: true,
  autoApprove: true,
  tickGeneration: 0,
};

async function controlRow(ctx: MutationCtx) {
  const existing = await ctx.db.query("control").first();
  if (existing) return existing;
  const id = await ctx.db.insert("control", DEFAULTS);
  return (await ctx.db.get("control", id))!;
}

async function logControl(ctx: MutationCtx, message: string) {
  await ctx.db.insert("events", { kind: "control", message, at: Date.now() });
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("control").first();
    return row ?? { ...DEFAULTS, warningIssuedAt: undefined };
  },
});

// Starts the night: seeds the simulated area if empty, opens the lines, starts the stand-in loop.
export const issueWarning = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    if (control.warningIssuedAt) return null;
    const now = Date.now();
    if (!(await ctx.db.query("households").first())) await seedSimulatedArea(ctx, now);
    await seedFleetIfEmpty(ctx, now);
    const tickGeneration = control.tickGeneration + 1;
    await ctx.db.patch("control", control._id, { warningIssuedAt: now, dialerRunning: true, tickGeneration });
    await logControl(ctx, "Evacuation warning issued for west Altadena. Dialer started");
    await ctx.scheduler.runAfter(TICK_MS, internal.sim.tick, { generation: tickGeneration });
    return null;
  },
});

export const setDialer = mutation({
  args: { running: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { running }) => {
    const control = await controlRow(ctx);
    await ctx.db.patch("control", control._id, { dialerRunning: running });
    await logControl(ctx, running ? "Dialer resumed" : "Dialer paused. Live calls will finish");
    return null;
  },
});

export const setMaxConcurrentCalls = mutation({
  args: { value: v.number() },
  returns: v.null(),
  handler: async (ctx, { value }) => {
    const control = await controlRow(ctx);
    if (!Number.isFinite(value)) throw new Error("maxConcurrentCalls must be a finite number");
    const maxConcurrentCalls = Math.max(1, Math.min(48, Math.round(value)));
    await ctx.db.patch("control", control._id, { maxConcurrentCalls });
    return null;
  },
});

export const setStandIns = mutation({
  args: {
    simulateVoice: v.optional(v.boolean()),
    simulateNeedModel: v.optional(v.boolean()),
    simulateDispatch: v.optional(v.boolean()),
    simulateDrivers: v.optional(v.boolean()),
    autoApprove: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const control = await controlRow(ctx);
    await ctx.db.patch("control", control._id, args);
    return null;
  },
});

const SURGE_SIZE = 6;

// Demo lever: the phone alert went out and residents call the inbound number at once.
export const inboundSurge = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const waiting = await ctx.db
      .query("households")
      .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "not_called"))
      .take(300);
    const callers = waiting.filter((h) => h.simulated).sort(() => Math.random() - 0.5).slice(0, SURGE_SIZE);
    for (const caller of callers) {
      await startCall(ctx, { householdId: caller._id, direction: "inbound", simulated: true });
    }
    await logControl(ctx, `Inbound surge: ${callers.length} residents called the alert number`);
    return null;
  },
});

const TABLES = [
  "transcriptLines",
  "texts",
  "calls",
  "events",
  "callbacks",
  "auditLog",
  "assignments",
  "plans",
  "requests",
  "nominations",
  "roadClosures",
  "zones",
  "personas",
  "households",
  "vehicles",
  "shelters",
  "vehicleRoutes",
  "dispatchState",
] as const;
const DELETE_BATCH = 2000;

export const reset = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    await ctx.db.patch("control", control._id, {
      ...DEFAULTS,
      warningIssuedAt: undefined,
      tickGeneration: control.tickGeneration + 1,
    });
    await ctx.scheduler.runAfter(0, internal.control.clearTables, {});
    return null;
  },
});

export const clearTables = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // One run may read 4,096 rows in total, so the batch is shared across tables, not per table.
    let budget = DELETE_BATCH;
    for (const table of TABLES) {
      const rows = await ctx.db.query(table).take(budget);
      for (const row of rows) await ctx.db.delete(table, row._id);
      budget -= rows.length;
      if (budget === 0) {
        await ctx.scheduler.runAfter(0, internal.control.clearTables, {});
        return null;
      }
    }
    return null;
  },
});
