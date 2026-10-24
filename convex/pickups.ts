import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { applyRecordPatch } from "./households";
import { resolveFollowUpFor } from "./calls";
import { pickupFailure, pickupStatus } from "./schema";

// The pickup check. When a warning covers a household with a helper on file, the helper is called
// first ("can you pick up Walter now?"), then the resident once the helper's ETA has passed ("has
// Ana picked you up?"). A pickup that isn't happening becomes a ride request at once, its needs
// already filled in from the Ready check profile. Track B's voice server places the real calls
// through the mutations below; the stand-in in pickupSim.ts plays the simulated households.

type Plan = Doc<"pickupPlans">;
type Failure = typeof pickupFailure.type;
type Role = "helper" | "resident";

// Nobody waits on a promise we can't check: unconfirmed this long after the warning, it fell through.
export const PICKUP_CHECK_LIMIT_MS = 8 * 60_000;
export const MAX_HELPER_ATTEMPTS = 2;
export const MAX_RESIDENT_ATTEMPTS = 2;
const DEFAULT_ETA_MINUTES = 15;
const MAX_ETA_MINUTES = 60;

const role = v.union(v.literal("helper"), v.literal("resident"));

const FAILURE_EVENTS: Record<Failure, (helper: string, place: string) => string> = {
  helper_declined: (helper, place) => `${helper} can't pick up ${place}. Opened a ride request`,
  helper_unreachable: (helper, place) => `Couldn't confirm ${helper} is picking up ${place}. Opened a ride request`,
  helper_never_came: (helper, place) => `${helper} never reached ${place}. Opened a ride request`,
  resident_unreachable: (helper, place) => `${helper} said they'd pick up ${place}, but nobody answers there. Added to the door-check list`,
};

async function logPickup(ctx: MutationCtx, plan: Plan, message: string) {
  await ctx.db.insert("events", { kind: "dispatch", message, householdId: plan.householdId, at: Date.now() });
}

async function placeOf(ctx: MutationCtx, plan: Plan) {
  const household = await ctx.db.get("households", plan.householdId);
  return household?.residentName ? `${household.residentName} on ${streetOf(household.address)}` : (household?.address ?? "the home");
}

const streetOf = (address: string) => address.replace(/^\s*\d+[A-Za-z]?\s+/, "");

// The promise is off. A ride request opens from the profile, or field teams knock when the
// resident can't be reached to say whether anyone came.
export async function fellThrough(ctx: MutationCtx, plan: Plan, reason: Failure) {
  const place = await placeOf(ctx, plan);
  await ctx.db.patch("pickupPlans", plan._id, { status: "fell_through", reason, ringing: undefined, updatedAt: Date.now() });
  await logPickup(ctx, plan, FAILURE_EVENTS[reason](plan.helperName, place));
  if (reason === "resident_unreachable") await resolveFollowUpFor(ctx, plan.householdId, "door_check");
  else await applyRecordPatch(ctx, plan.householdId, { canLeave: "no" }, { canLeave: 1 });
}

async function markComing(ctx: MutationCtx, plan: Plan, etaMinutes: number | undefined) {
  const minutes = Math.min(Math.max(Math.round(etaMinutes ?? DEFAULT_ETA_MINUTES), 1), MAX_ETA_MINUTES);
  const now = Date.now();
  await ctx.db.patch("pickupPlans", plan._id, { status: "coming", ringing: undefined, helperEtaAt: now + minutes * 60_000, updatedAt: now });
  await logPickup(ctx, plan, `${plan.helperName} is on the way to ${await placeOf(ctx, plan)}, about ${minutes} min out`);
}

async function markDone(ctx: MutationCtx, plan: Plan) {
  await ctx.db.patch("pickupPlans", plan._id, { status: "done", ringing: undefined, updatedAt: Date.now() });
  await ctx.db.patch("households", plan.householdId, { outcome: "leaving", callStatus: "complete" });
  await logPickup(ctx, plan, `${plan.helperName} picked up ${await placeOf(ctx, plan)}`);
}

// The warning reached these homes: start calling their helpers.
export async function startPickupChecks(ctx: MutationCtx, now: number) {
  const arranged = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", "arranged")).take(200);
  for (const plan of arranged) {
    const household = await ctx.db.get("households", plan.householdId);
    if (!household?.inZone) continue;
    await ctx.db.patch("pickupPlans", plan._id, { status: "checking", checkStartedAt: now, updatedAt: now });
  }
}

export async function expireStaleChecks(ctx: MutationCtx, now: number) {
  const checking = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", "checking")).take(200);
  for (const plan of checking) {
    if (plan.ringing || now - (plan.checkStartedAt ?? now) < PICKUP_CHECK_LIMIT_MS) continue;
    await fellThrough(ctx, plan, "helper_unreachable");
  }
}

export async function beginAttempt(ctx: MutationCtx, plan: Plan, who: Role) {
  const attempts = who === "helper" ? { helperAttempts: plan.helperAttempts + 1 } : { residentAttempts: plan.residentAttempts + 1 };
  await ctx.db.patch("pickupPlans", plan._id, { ...attempts, ringing: who, lastAttemptAt: Date.now(), updatedAt: Date.now() });
}

export async function helperReplied(ctx: MutationCtx, plan: Plan, coming: boolean, etaMinutes?: number) {
  if (plan.status !== "checking") return;
  if (coming) await markComing(ctx, plan, etaMinutes);
  else await fellThrough(ctx, plan, "helper_declined");
}

export async function residentReplied(ctx: MutationCtx, plan: Plan, pickedUp: boolean) {
  if (plan.status !== "coming") return;
  if (pickedUp) await markDone(ctx, plan);
  else await fellThrough(ctx, plan, "helper_never_came");
}

export async function noAnswer(ctx: MutationCtx, plan: Plan, who: Role) {
  if (plan.status === "checking" && who === "helper" && plan.helperAttempts >= MAX_HELPER_ATTEMPTS) {
    return await fellThrough(ctx, plan, "helper_unreachable");
  }
  if (plan.status === "coming" && who === "resident" && plan.residentAttempts >= MAX_RESIDENT_ATTEMPTS) {
    return await fellThrough(ctx, plan, "resident_unreachable");
  }
  await ctx.db.patch("pickupPlans", plan._id, { ringing: undefined, updatedAt: Date.now() });
}

async function livePlan(ctx: MutationCtx, planId: Id<"pickupPlans">) {
  const plan = await ctx.db.get("pickupPlans", planId);
  if (!plan) throw new Error(`Pickup plan ${planId} not found`);
  return plan;
}

// Voice server: a pickup-check call connected.
export const startAttempt = mutation({
  args: { planId: v.id("pickupPlans"), role },
  returns: v.null(),
  handler: async (ctx, { planId, role: who }) => {
    await beginAttempt(ctx, await livePlan(ctx, planId), who);
    return null;
  },
});

// Voice server: the helper said whether they can pick the resident up, and roughly when.
export const helperAnswered = mutation({
  args: { planId: v.id("pickupPlans"), coming: v.boolean(), etaMinutes: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { planId, coming, etaMinutes }) => {
    await helperReplied(ctx, await livePlan(ctx, planId), coming, etaMinutes);
    return null;
  },
});

// Voice server: the resident said whether their helper picked them up.
export const residentAnswered = mutation({
  args: { planId: v.id("pickupPlans"), pickedUp: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { planId, pickedUp }) => {
    await residentReplied(ctx, await livePlan(ctx, planId), pickedUp);
    return null;
  },
});

// Voice server: nobody picked up. The second miss ends the check.
export const unanswered = mutation({
  args: { planId: v.id("pickupPlans"), role },
  returns: v.null(),
  handler: async (ctx, { planId, role: who }) => {
    await noAnswer(ctx, await livePlan(ctx, planId), who);
    return null;
  },
});

// Voice server: real pickup checks to place. Retry timing and who is due are the server's job.
export const callQueue = query({
  args: {},
  handler: async (ctx) => {
    const lists = await Promise.all(
      (["checking", "coming"] as const).map((status) =>
        ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(100),
      ),
    );
    const real = lists.flat().filter((plan) => !plan.simulated);
    return await Promise.all(
      real.map(async (plan) => {
        const household = await ctx.db.get("households", plan.householdId);
        return {
          _id: plan._id,
          status: plan.status,
          ringing: plan.ringing,
          helperName: plan.helperName,
          helperPhone: plan.helperPhone,
          relation: plan.relation,
          helperAttempts: plan.helperAttempts,
          residentAttempts: plan.residentAttempts,
          lastAttemptAt: plan.lastAttemptAt,
          helperEtaAt: plan.helperEtaAt,
          address: household?.address ?? "",
          residentName: household?.residentName,
          residentPhone: household?.callbackNumber ?? "",
          language: household?.language ?? "en",
        };
      }),
    );
  },
});

// Rescue map: every prearranged pickup and where it stands, with both ends located.
export const board = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("pickupPlans"),
      householdId: v.id("households"),
      status: pickupStatus,
      reason: v.optional(pickupFailure),
      ringing: v.optional(role),
      helperName: v.string(),
      relation: v.optional(v.string()),
      helperEtaAt: v.optional(v.number()),
      updatedAt: v.number(),
      home: v.union(v.null(), v.object({ lat: v.number(), lng: v.number(), address: v.string(), residentName: v.optional(v.string()) })),
      helperHome: v.union(v.null(), v.object({ lat: v.number(), lng: v.number() })),
    }),
  ),
  handler: async (ctx) => {
    const plans = await ctx.db.query("pickupPlans").take(500);
    return await Promise.all(
      plans.map(async (plan) => {
        const household = await ctx.db.get("households", plan.householdId);
        const helper = plan.helperHouseholdId ? await ctx.db.get("households", plan.helperHouseholdId) : null;
        return {
          _id: plan._id,
          householdId: plan.householdId,
          status: plan.status,
          reason: plan.reason,
          ringing: plan.ringing,
          helperName: plan.helperName,
          relation: plan.relation,
          helperEtaAt: plan.helperEtaAt,
          updatedAt: plan.updatedAt,
          home:
            household?.lat !== undefined && household.lng !== undefined
              ? { lat: household.lat, lng: household.lng, address: household.address, residentName: household.residentName }
              : null,
          helperHome: helper?.lat !== undefined && helper.lng !== undefined ? { lat: helper.lat, lng: helper.lng } : null,
        };
      }),
    );
  },
});
