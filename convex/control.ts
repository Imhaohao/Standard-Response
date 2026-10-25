import { ConvexError, v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { mutation } from "./functions";
import { internal } from "./_generated/api";
import { retimeArea, seedFleetIfEmpty, seedSimulatedArea } from "./seed";
import { coverAreaIfNoZone } from "./riders";
import { startPickupChecks } from "./pickups";
import { startCall } from "./calls";
import { MAX_RUN_MS, TICK_MS } from "./sim";
import { simNow } from "./clock";
import { clockAtSpeed, PLAYBACK_SPEEDS, runningMs } from "../lib/sim-clock";
import { DEFAULT_HAZARD, hazard } from "./hazards";
import { archiveNight, startRunIfNone } from "./nightRuns";
import { hangUpStandInReadyCalls } from "./ready";

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
    if (control.archivingRunId) throw new ConvexError("The last night is still being saved. Try again in a moment");
    const clock = clockAtSpeed(control.clock, control.clock?.speed || 1, Date.now());
    const now = clock.simAt;
    const empty = !(await ctx.db.query("households").first());
    if (empty) await seedSimulatedArea(ctx, now);
    // Before the warning changes any home: this is what a rewind puts back, unless the Ready check started the run.
    await startRunIfNone(ctx);
    if (!empty) await retimeArea(ctx, now);
    await coverAreaIfNoZone(ctx);
    // Simulated drivers drive only in a simulated town. Real households get the driver-page vans.
    await seedFleetIfEmpty(ctx, now, !(await hasSimulatedHouseholds(ctx)));
    const tickGeneration = control.tickGeneration + 1;
    const readyCheckGeneration = (control.readyCheckGeneration ?? 0) + 1;
    await ctx.db.patch("control", control._id, { warningIssuedAt: now, dialerRunning: true, tickGeneration, readyCheckRunning: false, readyCheckGeneration, clock: { ...clock, ranMs: 0 } });
    await hangUpStandInReadyCalls(ctx);
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

// What every new night starts from: the loops stopped, the clock back on the wall clock.
const NIGHT_OVER = {
  warningIssuedAt: undefined,
  dialerRunning: false,
  readyCheckRunning: false,
  readyCheckStartedAt: undefined,
  clock: undefined,
};

// A real call whose row is this old was dropped by a restart and never ended.
const STALE_CALL_MS = 30 * 60_000;

async function liveRealCall(ctx: MutationCtx) {
  for (const phase of ["ringing", "live"] as const) {
    const calls = await ctx.db.query("calls").withIndex("by_phase", (q) => q.eq("phase", phase)).take(100);
    if (calls.some((call) => !call.simulated && Date.now() - call._creationTime < STALE_CALL_MS)) return true;
  }
  return false;
}

async function endNight(ctx: MutationCtx, mode: "rewind" | "reset") {
  const control = await controlRow(ctx);
  if (control.archivingRunId) throw new ConvexError("The last night is still being saved. Try again in a moment");
  if (await liveRealCall(ctx)) throw new ConvexError("A real call is still live. Let it finish first");
  const stopLoops = { tickGeneration: control.tickGeneration + 1, readyCheckGeneration: (control.readyCheckGeneration ?? 0) + 1 };
  const runId = await archiveNight(ctx, control, mode);
  // A reset also puts the stand-in switches back; a rewind keeps how the night was set up.
  const settings = mode === "reset" ? DEFAULTS : {};
  await ctx.db.patch("control", control._id, { ...settings, ...NIGHT_OVER, ...stopLoops, archivingRunId: runId });
}

// Back to before the Ready check, on the same homes: the night is saved in `nightRuns`, then cleared,
// and every home and arranged pickup is put back as it was when the run started (convex/nightRuns.ts).
export const rewind = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await endNight(ctx, "rewind");
    return null;
  },
});

// Clears everything, homes included, after saving it in `nightRuns`.
export const reset = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await endNight(ctx, "reset");
    return null;
  },
});
