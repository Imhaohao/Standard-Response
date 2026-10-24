import { v } from "convex/values";
import { internalAction, query, MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { liveAssignmentsFor, liveAssignmentsForVehicle } from "./offers";
import { writePlan } from "./plans";
import { audit, escalateHousehold } from "./requests";
import { vehicleCanServe } from "./model";
import { positionAt } from "./vehicleRun";
import { planFromSolution, buildWorld, solve } from "./dispatchWorld";
import type { Snapshot } from "./dispatchSnapshot";
import { simNow } from "./clock";

// Track C's real dispatcher. Every few seconds, and right away when a road closes, it snapshots the
// world, forecasts each vehicle's accepted run, revokes pickups a closure has made unreachable in
// time, and asks OR-Tools (or the heuristic when the solver service is down) for new offers.
// Every write goes through writePlan, so the contract's rules hold for this dispatcher too.

const REPLAN_EVERY_MS = 5_000;
// With nobody waiting, re-plan only this often. Each re-plan reads every open request, so this
// is most of Track C's database reads on a quiet night.
const REFRESH_EVERY_MS = 30_000;
const REPLAN_LOCK_MS = 30_000;

async function stateRow(ctx: MutationCtx) {
  const existing = await ctx.db.query("dispatchState").first();
  if (existing) return existing;
  const id = await ctx.db.insert("dispatchState", { lastReplanAt: 0, closuresSeen: 0, replans: 0 });
  return (await ctx.db.get("dispatchState", id))!;
}

// Riders waiting for a vehicle or offers waiting for approval: re-plan often.
async function hasUrgentWork(ctx: MutationCtx) {
  for (const status of ["received", "reassigning"] as const) {
    if (await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", status)).first()) return true;
  }
  return (await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", "proposed")).first()) !== null;
}

// Only accepted runs and open offers: re-plan now and then, to keep ETAs and revocations current.
async function hasLiveRuns(ctx: MutationCtx) {
  for (const status of ["offered", "accepted"] as const) {
    if (await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", status)).first()) return true;
  }
  return false;
}

// Called from the simulation tick. Starts a re-plan when one is due and none is running.
export async function maybeReplan(ctx: MutationCtx, now: number) {
  const state = await stateRow(ctx);
  if (state.replanStartedAt && now - state.replanStartedAt < REPLAN_LOCK_MS) return;
  const closures = (await ctx.db.query("roadClosures").take(1000)).length;
  const closureAdded = closures !== state.closuresSeen;
  const since = now - state.lastReplanAt;
  const due = (since >= REPLAN_EVERY_MS && (await hasUrgentWork(ctx))) || (since >= REFRESH_EVERY_MS && (await hasLiveRuns(ctx)));
  if (!closureAdded && !due) return;
  await ctx.db.patch("dispatchState", state._id, { replanStartedAt: now });
  await ctx.scheduler.runAfter(0, internal.dispatch.replan, {});
}

export const replan = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    try {
      const snap: Snapshot = await ctx.runQuery(internal.dispatchSnapshot.snapshot, {});
      const world = buildWorld(snap, snap.now);
      const { solution, fallbackReason } = await solve(world.problem);
      await ctx.runMutation(internal.dispatch.commit, planFromSolution(world, solution, fallbackReason));
    } catch (error) {
      await ctx.runMutation(internal.dispatch.fail, { error: error instanceof Error ? error.message : String(error) });
    }
    return null;
  },
});

const offerArg = v.object({
  requestId: v.id("requests"),
  vehicleId: v.id("vehicles"),
  shelterId: v.optional(v.id("shelters")),
  etaMinutes: v.number(),
  sequence: v.number(),
});

export const commitArgs = {
  offers: v.array(offerArg),
  replace: v.array(v.id("assignments")),
  revoke: v.array(v.object({ assignmentId: v.id("assignments"), reason: v.string() })),
  etaUpdates: v.array(v.object({ assignmentId: v.id("assignments"), etaMinutes: v.number() })),
  escalate: v.array(v.id("households")),
  closureEdges: v.array(v.object({ closureId: v.id("roadClosures"), edgeKeys: v.array(v.string()), streets: v.array(v.string()) })),
  closuresSeen: v.number(),
  solver: v.union(v.literal("heuristic"), v.literal("ortools")),
  solveMs: v.number(),
  requestCount: v.number(),
  vehicleCount: v.number(),
  fallbackReason: v.optional(v.string()),
};

type CommitArgs = {
  [K in keyof typeof commitArgs]: (typeof commitArgs)[K]["type"];
};
type OfferArg = typeof offerArg.type;

async function saveClosureEdges(ctx: MutationCtx, closureEdges: CommitArgs["closureEdges"]) {
  for (const { closureId, edgeKeys, streets } of closureEdges) {
    const closure = await ctx.db.get("roadClosures", closureId);
    if (!closure) continue;
    await ctx.db.patch("roadClosures", closureId, { edgeKeys, streets, edgeKey: closure.edgeKey ?? edgeKeys[0] });
  }
}

async function stillAccepted(ctx: MutationCtx, revoke: CommitArgs["revoke"]) {
  const kept: CommitArgs["revoke"] = [];
  for (const item of revoke) {
    if ((await ctx.db.get("assignments", item.assignmentId))?.status === "accepted") kept.push(item);
  }
  return kept;
}

async function stillOpen(ctx: MutationCtx, replace: Id<"assignments">[]) {
  const kept: Id<"assignments">[] = [];
  for (const id of replace) {
    const status = (await ctx.db.get("assignments", id))?.status;
    if (status === "proposed" || status === "offered") kept.push(id);
  }
  return kept;
}

async function firstFreeStop(ctx: MutationCtx, vehicleId: Id<"vehicles">, leaving: Set<Id<"assignments">>) {
  const run = await liveAssignmentsForVehicle(ctx, vehicleId);
  const accepted = run.filter((a) => a.status === "accepted" && !leaving.has(a._id));
  return Math.max(-1, ...accepted.map((a) => a.stopOrder)) + 1;
}

const OFFERABLE = new Set<Doc<"requests">["status"]>(["received", "approved", "reassigning"]);

// The world moved while the solver ran. Keep only offers the contract will still accept.
async function offerStillValid(ctx: MutationCtx, offer: OfferArg, ending: Set<Id<"assignments">>) {
  const request = await ctx.db.get("requests", offer.requestId);
  const vehicle = await ctx.db.get("vehicles", offer.vehicleId);
  if (!request || !vehicle || !OFFERABLE.has(request.status)) return false;
  if (!vehicleCanServe(vehicle, request)) return false;
  const live = await liveAssignmentsFor(ctx, request._id);
  return live.every((a) => ending.has(a._id));
}

async function validOffers(ctx: MutationCtx, offers: OfferArg[], ending: Set<Id<"assignments">>) {
  const kept = [];
  const offered = new Set<Id<"requests">>();
  for (const offer of offers) {
    if (offered.has(offer.requestId) || !(await offerStillValid(ctx, offer, ending))) continue;
    offered.add(offer.requestId);
    const { sequence, ...rest } = offer;
    kept.push({ ...rest, stopOrder: (await firstFreeStop(ctx, offer.vehicleId, ending)) + sequence });
  }
  return kept;
}

async function applyEtaUpdates(ctx: MutationCtx, updates: CommitArgs["etaUpdates"], now: number) {
  for (const { assignmentId, etaMinutes } of updates) {
    const assignment = await ctx.db.get("assignments", assignmentId);
    if (assignment?.status === "accepted") await ctx.db.patch("assignments", assignmentId, { etaMinutes, etaUpdatedAt: now });
  }
}

async function explainRevocations(ctx: MutationCtx, revoke: CommitArgs["revoke"]) {
  for (const { assignmentId, reason } of revoke) {
    const assignment = await ctx.db.get("assignments", assignmentId);
    if (!assignment) continue;
    const vehicle = await ctx.db.get("vehicles", assignment.vehicleId);
    const household = await ctx.db.get("households", assignment.householdId);
    await ctx.db.insert("events", {
      kind: "dispatch",
      message: `${vehicle?.label ?? "A vehicle"} can no longer reach ${household?.address ?? "a rider"}: ${reason}`,
      householdId: assignment.householdId,
      at: await simNow(ctx),
    });
  }
}

async function escalateUnservable(ctx: MutationCtx, householdIds: Id<"households">[]) {
  for (const householdId of householdIds) {
    const household = await ctx.db.get("households", householdId);
    if (household && household.escalation === undefined) await escalateHousehold(ctx, householdId, "unservable");
  }
}

export const commit = internalMutation({
  args: commitArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = await simNow(ctx);
    await saveClosureEdges(ctx, args.closureEdges);
    const revoke = await stillAccepted(ctx, args.revoke);
    const replace = await stillOpen(ctx, args.replace);
    const ending = new Set([...revoke.map((r) => r.assignmentId), ...replace]);
    const offers = await validOffers(ctx, args.offers, ending);
    await explainRevocations(ctx, revoke);
    if (offers.length + replace.length + revoke.length > 0) {
      const control = await ctx.db.query("control").first();
      await writePlan(
        ctx,
        {
          solver: args.solver,
          solveMs: args.solveMs,
          offers,
          replace,
          revoke: revoke.map((r) => r.assignmentId),
          requestCount: args.requestCount,
          vehicleCount: args.vehicleCount,
          fallbackReason: args.fallbackReason,
        },
        control?.autoApprove ?? false,
      );
    }
    await applyEtaUpdates(ctx, args.etaUpdates, now);
    await escalateUnservable(ctx, args.escalate);
    const state = await stateRow(ctx);
    await ctx.db.patch("dispatchState", state._id, {
      replanStartedAt: undefined,
      // The re-plan cadence limits calls to the solver, so it runs on the wall clock.
      lastReplanAt: Date.now(),
      closuresSeen: args.closuresSeen,
      lastSolver: args.solver,
      lastSolveMs: args.solveMs,
      lastFallbackReason: args.fallbackReason,
      lastError: undefined,
      replans: state.replans + 1,
    });
    return null;
  },
});

export const fail = internalMutation({
  args: { error: v.string() },
  returns: v.null(),
  handler: async (ctx, { error }) => {
    const state = await stateRow(ctx);
    await ctx.db.patch("dispatchState", state._id, { replanStartedAt: undefined, lastReplanAt: Date.now(), lastError: error });
    await audit(ctx, "plan", `Re-plan failed: ${error}`);
    return null;
  },
});

// Solver panel: what the re-planner did last, and whether the OR-Tools service is configured.
export const status = query({
  args: {},
  handler: async (ctx) => {
    const state = await ctx.db.query("dispatchState").first();
    const latestPlan = await ctx.db.query("plans").withIndex("by_version").order("desc").first();
    return { state, latestPlan, solverConfigured: Boolean(process.env.SOLVER_URL) };
  },
});

// Rescue map: the road path each vehicle still has to drive. Empty while the dispatch stand-in
// is on, because its straight-line movement doesn't follow these paths.
export const routes = query({
  args: {},
  handler: async (ctx) => {
    const control = await ctx.db.query("control").first();
    if (control?.simulateDispatch ?? true) return [];
    const rows = await ctx.db.query("vehicleRoutes").take(200);
    return rows.map((route) => ({
      vehicleId: route.vehicleId,
      target: route.target,
      boarding: route.dwellUntil !== undefined,
      // Updated every tick; vehicles:list positions update every 2.5 s.
      position: route.path.length > 0 ? positionAt(route, route.progressSeconds) : null,
      remaining: remainingPath(route.path, route.legSeconds, route.progressSeconds),
    }));
  },
});

function remainingPath(path: Doc<"vehicleRoutes">["path"], legSeconds: number[], progress: number) {
  let elapsed = 0;
  for (const [i, seconds] of legSeconds.entries()) {
    if (elapsed + seconds > progress) return path.slice(i);
    elapsed += seconds;
  }
  return path.slice(-1);
}

// Verification and demos: re-plan on the next tick instead of waiting for the interval.
export const replanNow = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const state = await stateRow(ctx);
    await ctx.db.patch("dispatchState", state._id, { lastReplanAt: 0, replanStartedAt: undefined });
    return null;
  },
});
