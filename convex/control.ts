import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { retimeArea, seedFleetIfEmpty, seedSimulatedArea } from "./seed";
import { coverAreaIfNoZone } from "./riders";
import { startPickupChecks } from "./pickups";
import { startCall } from "./calls";
import { MAX_RUN_MS, TICK_MS } from "./sim";
import { simNow } from "./clock";
import { clockAtSpeed, PLAYBACK_SPEEDS, runningMs } from "../lib/sim-clock";
import { DEFAULT_HAZARD, hazard } from "./hazards";

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

async function hasSimulatedHouseholds(ctx: MutationCtx) {
  return (await ctx.db.query("households").take(1000)).some((household) => household.simulated);
}

async function logControl(ctx: MutationCtx, message: string) {
  await ctx.db.insert("events", { kind: "control", message, at: await simNow(ctx) });
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("control").first();
    if (!row) return { ...DEFAULTS, warningIssuedAt: undefined, clock: undefined, hazard: DEFAULT_HAZARD };
    return { ...row, hazard: row.hazard ?? DEFAULT_HAZARD };
  },
});

// Starts the night: seeds the simulated area if empty, opens the lines, starts the stand-in loop.
export const issueWarning = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await controlRow(ctx);
    if (control.warningIssuedAt) return null;
    const clock = clockAtSpeed(control.clock, control.clock?.speed || 1, Date.now());
    const now = clock.simAt;
    if (await ctx.db.query("households").first()) await retimeArea(ctx, now);
    else await seedSimulatedArea(ctx, now);
    await coverAreaIfNoZone(ctx);
    // Simulated drivers drive only in a simulated town. Real households get the driver-page vans.
    await seedFleetIfEmpty(ctx, now, !(await hasSimulatedHouseholds(ctx)));
    const tickGeneration = control.tickGeneration + 1;
    const readyCheckGeneration = (control.readyCheckGeneration ?? 0) + 1;
    await ctx.db.patch("control", control._id, { warningIssuedAt: now, dialerRunning: true, tickGeneration, readyCheckRunning: false, readyCheckGeneration, clock: { ...clock, ranMs: 0 } });
    await startPickupChecks(ctx, now);
    await logControl(ctx, "Evacuation warning issued for west Altadena. Dialer started");
    await ctx.scheduler.runAfter(TICK_MS, internal.sim.tick, { generation: tickGeneration });
    return null;
  },
});

// The hazard is fixed once the warning goes out: calls already made used its safety line.
export const setHazard = mutation({
  args: { hazard },
  returns: v.null(),
  handler: async (ctx, args) => {
    const control = await controlRow(ctx);
    if (control.warningIssuedAt) throw new Error("Reset before changing the hazard");
    await ctx.db.patch("control", control._id, { hazard: args.hazard });
    await logControl(ctx, `Hazard set to ${args.hazard}`);
    return null;
  },
});

// Pausing stops the loops, so a paused night costs nothing; playing again starts them on a new
// generation. Faster playback moves the clock further each tick instead of ticking more often.
export const setPlayback = mutation({
  args: { speed: v.number() },
  returns: v.null(),
  handler: async (ctx, { speed }) => {
    if (speed !== 0 && !PLAYBACK_SPEEDS.some((allowed) => allowed === speed)) throw new Error(`Playback runs at ${PLAYBACK_SPEEDS.join(", ")} times, or pauses`);
    const control = await controlRow(ctx);
    const real = Date.now();
    const resuming = (control.clock?.speed ?? 1) === 0 && speed > 0;
    const clock = clockAtSpeed(control.clock, speed, real);
    await ctx.db.patch("control", control._id, { clock });
    if (resuming) await restartLoops(ctx, { ...control, clock }, real);
    return null;
  },
});

async function restartLoops(ctx: MutationCtx, control: Doc<"control">, real: number) {
  if (control.warningIssuedAt && runningMs(control.clock!, real) < MAX_RUN_MS) {
    const tickGeneration = control.tickGeneration + 1;
    await ctx.db.patch("control", control._id, { tickGeneration });
    await ctx.scheduler.runAfter(0, internal.sim.tick, { generation: tickGeneration });
  }
  if (control.readyCheckRunning && !control.warningIssuedAt) {
    const readyCheckGeneration = (control.readyCheckGeneration ?? 0) + 1;
    await ctx.db.patch("control", control._id, { readyCheckGeneration });
    await ctx.scheduler.runAfter(0, internal.ready.tick, { generation: readyCheckGeneration });
  }
}

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
  "pickupPlans",
  "neighborCalls",
  "households",
  "vehicles",
  "shelters",
  "vehicleRoutes",
  "vehicleLoads",
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
      readyCheckRunning: false,
      readyCheckStartedAt: undefined,
      readyCheckGeneration: (control.readyCheckGeneration ?? 0) + 1,
      clock: undefined,
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
