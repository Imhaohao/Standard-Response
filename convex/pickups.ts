import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { applyRecordPatch } from "./households";
import { resolveFollowUpFor } from "./calls";
import { askNearbyDriver } from "./neighborPickups";
import { canDrive, fitsInACar } from "./neighborRules";
import { syncRequest } from "./requests";
import { pickupFailure, pickupPurpose, pickupRole, pickupStatus } from "./schema";
import { simNow } from "./clock";

// The pickup check. When a warning covers a household with a helper on file, or tonight's calls
// pair a home that can't get out with a neighbor who has a car, both sides confirm the pickup:
//   1. the helper is asked ("can you pick up Walter now?" and roughly when),
//   2. on a yes, the resident is called and asked whether they'll go with them,
//   3. on a yes, the helper is called back to hear that the resident is ready for them,
//   4. once the helper's ETA has passed, the resident is asked "has Ana picked you up?".
// When a later call changes the picture (the resident can leave on their own, now needs more than a
// car, or the helper can't drive after all), the pickup ends and whichever side had already agreed
// is called with the update. A pickup that isn't happening becomes a ride request at once, its needs
// already filled in from the Ready check profile. The voice server places the real calls
// through the mutations below; the stand-in in pickupSim.ts plays the simulated households.

type Plan = Doc<"pickupPlans">;
type Failure = typeof pickupFailure.type;
type Role = "helper" | "resident";
// What a call is for: asking the plan's question, asking the resident to confirm, or a status update.
export type Purpose = "ask" | "confirm" | "notice";

// Nobody waits on a promise we can't check: unconfirmed this long after the warning, it fell through.
export const PICKUP_CHECK_LIMIT_MS = 8 * 60_000;
export const MAX_HELPER_ATTEMPTS = 2;
export const MAX_RESIDENT_ATTEMPTS = 2;
export const MAX_CONFIRM_ATTEMPTS = 2;
export const MAX_NOTICE_ATTEMPTS = 2;
const DEFAULT_ETA_MINUTES = 15;
const MAX_ETA_MINUTES = 60;

const role = pickupRole;
const purpose = v.optional(pickupPurpose);

const FAILURE_EVENTS: Record<Failure, (helper: string, place: string) => string> = {
  helper_declined: (helper, place) => `${helper} can't pick up ${place}. Opened a ride request`,
  helper_unreachable: (helper, place) => `Couldn't confirm ${helper} is picking up ${place}. Opened a ride request`,
  helper_never_came: (helper, place) => `${helper} never reached ${place}. Opened a ride request`,
  resident_unreachable: (helper, place) => `${helper} said they'd pick up ${place}, but nobody answers there. Added to the door-check list`,
  resident_declined: (helper, place) => `${place} said no to a ride with ${helper}`,
  needs_changed: (helper, place) => `${place} now needs more help than ${helper} can give. Opened a ride request`,
  not_needed: (helper, place) => `${place} can get out on their own now, so ${helper} isn't needed`,
};

// A neighbor we asked had no arrangement to begin with, and the ride request never closed.
const RECRUIT_FAILURE_EVENTS: Record<Failure, (helper: string, place: string) => string> = {
  helper_declined: (helper, place) => `${helper} can't pick up ${place}. Their ride request stays open`,
  helper_unreachable: (helper, place) => `Couldn't reach ${helper} about ${place}. Their ride request stays open`,
  helper_never_came: (helper, place) => `${helper} never reached ${place}. Their ride request stays open`,
  resident_unreachable: FAILURE_EVENTS.resident_unreachable,
  resident_declined: (helper, place) => `${place} said no to a ride with ${helper}. Their ride request stays open`,
  needs_changed: (helper, place) => `${place} now needs more help than ${helper}'s car can give. Their ride request stays open`,
  not_needed: FAILURE_EVENTS.not_needed,
};

// Reasons that come from the resident's side. The helper, if they already said yes, is told it's off.
const RESIDENT_SIDE = new Set<Failure>(["resident_declined", "needs_changed", "not_needed"]);

async function logPickup(ctx: MutationCtx, plan: Plan, message: string) {
  await ctx.db.insert("events", { kind: "dispatch", message, householdId: plan.householdId, at: await simNow(ctx) });
}

async function placeOf(ctx: MutationCtx, plan: Plan) {
  const household = await ctx.db.get("households", plan.householdId);
  return household?.residentName ? `${household.residentName} on ${streetOf(household.address)}` : (household?.address ?? "the home");
}

const streetOf = (address: string) => address.replace(/^\s*\d+[A-Za-z]?\s+/, "");

// Who still has to hear about a pickup that just ended. A helper who already said yes is told it's
// off when the change came from the resident's side; a resident who heard their helper was coming is
// told when the helper drops out.
function noticesOnEnd(plan: Plan, reason: Failure) {
  if (plan.status !== "coming") return {};
  if (RESIDENT_SIDE.has(reason)) return { helperNotice: "called_off" as const, helperNoticeAttempts: 0 };
  if (reason === "helper_declined" && plan.residentToldAt !== undefined) return { residentNotice: "helper_cancelled" as const, residentNoticeAttempts: 0 };
  return {};
}

// The promise is off. A ride request opens from the profile, or field teams knock when the
// resident can't be reached to say whether anyone came.
export async function fellThrough(ctx: MutationCtx, plan: Plan, reason: Failure) {
  const place = await placeOf(ctx, plan);
  await ctx.db.patch("pickupPlans", plan._id, { status: "fell_through", reason, ringing: undefined, ...noticesOnEnd(plan, reason), updatedAt: await simNow(ctx) });
  await logPickup(ctx, plan, (plan.recruited ? RECRUIT_FAILURE_EVENTS : FAILURE_EVENTS)[reason](plan.helperName, place));
  if (reason === "resident_unreachable") await resolveFollowUpFor(ctx, plan.householdId, "door_check");
  else if (RESIDENT_SIDE.has(reason)) await syncRequest(ctx, plan.householdId);
  else if (plan.recruited) await askNearbyDriver(ctx, plan.householdId);
  else await applyRecordPatch(ctx, plan.householdId, { canLeave: "no" }, { canLeave: 1 });
}

async function markComing(ctx: MutationCtx, plan: Plan, etaMinutes: number | undefined) {
  const minutes = Math.min(Math.max(Math.round(etaMinutes ?? DEFAULT_ETA_MINUTES), 1), MAX_ETA_MINUTES);
  const now = await simNow(ctx);
  await ctx.db.patch("pickupPlans", plan._id, { status: "coming", ringing: undefined, helperEtaAt: now + minutes * 60_000, updatedAt: now });
  await logPickup(ctx, plan, `${plan.helperName} is on the way to ${await placeOf(ctx, plan)}, about ${minutes} min out`);
}

async function markDone(ctx: MutationCtx, plan: Plan) {
  await ctx.db.patch("pickupPlans", plan._id, { status: "done", ringing: undefined, updatedAt: await simNow(ctx) });
  await ctx.db.patch("households", plan.householdId, { outcome: "leaving", callStatus: "complete" });
  // A neighbor's pickup leaves a ride request open behind it; nobody needs that van now.
  await syncRequest(ctx, plan.householdId);
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

const COUNTERS: Record<Purpose, Record<Role, keyof Plan>> = {
  ask: { helper: "helperAttempts", resident: "residentAttempts" },
  confirm: { helper: "confirmAttempts", resident: "confirmAttempts" },
  notice: { helper: "helperNoticeAttempts", resident: "residentNoticeAttempts" },
};

export const attemptsOf = (plan: Plan, who: Role, why: Purpose = "ask") => (plan[COUNTERS[why][who]] as number | undefined) ?? 0;

export async function beginAttempt(ctx: MutationCtx, plan: Plan, who: Role, why: Purpose = "ask") {
  const now = await simNow(ctx);
  const counter = COUNTERS[why][who];
  await ctx.db.patch("pickupPlans", plan._id, { [counter]: attemptsOf(plan, who, why) + 1, ringing: who, lastAttemptAt: now, updatedAt: now });
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

// The resident's half of the confirmation. A yes owes the helper a call saying they'll be ready.
export async function residentConfirmed(ctx: MutationCtx, plan: Plan, confirmed: boolean) {
  if (plan.status !== "coming" || plan.residentConfirmedAt !== undefined) return;
  if (!confirmed) return await fellThrough(ctx, plan, "resident_declined");
  const now = await simNow(ctx);
  await ctx.db.patch("pickupPlans", plan._id, {
    residentConfirmedAt: now,
    residentToldAt: plan.residentToldAt ?? now,
    helperNotice: "resident_ready",
    helperNoticeAttempts: 0,
    ringing: undefined,
    updatedAt: now,
  });
  await logPickup(ctx, plan, `${await placeOf(ctx, plan)} confirmed the pickup with ${plan.helperName}`);
}

const NOTICE_EVENTS = {
  resident_ready: (helper: string, place: string) => `Told ${helper} that ${place} is ready for them`,
  called_off: (helper: string, place: string) => `Told ${helper} the pickup at ${place} is off`,
  helper_cancelled: (helper: string, place: string) => `Told ${place} that ${helper} can't come`,
};

// The status update owed to this side was heard (or left on voicemail).
export async function noticeHeard(ctx: MutationCtx, plan: Plan, who: Role) {
  const notice = who === "helper" ? plan.helperNotice : plan.residentNotice;
  if (!notice) return;
  const cleared = who === "helper" ? { helperNotice: undefined } : { residentNotice: undefined };
  await ctx.db.patch("pickupPlans", plan._id, { ...cleared, ringing: undefined, updatedAt: await simNow(ctx) });
  await logPickup(ctx, plan, NOTICE_EVENTS[notice](plan.helperName, await placeOf(ctx, plan)));
}

// A missed confirmation or status update ends nothing: the helper is already on the way, and the
// resident is still asked "has your helper picked you up?" once the ETA passes.
async function missedExtra(ctx: MutationCtx, plan: Plan, who: Role, why: "confirm" | "notice") {
  // A notice left on voicemail, or a confirmation already given, is not a miss.
  const settled = why === "confirm" ? plan.residentConfirmedAt !== undefined : (who === "helper" ? plan.helperNotice : plan.residentNotice) === undefined;
  if (settled) return await ctx.db.patch("pickupPlans", plan._id, { ringing: undefined, updatedAt: await simNow(ctx) });
  const exhausted = attemptsOf(plan, who, why) >= (why === "confirm" ? MAX_CONFIRM_ATTEMPTS : MAX_NOTICE_ATTEMPTS);
  const dropNotice = why === "notice" && exhausted ? (who === "helper" ? { helperNotice: undefined } : { residentNotice: undefined }) : {};
  await ctx.db.patch("pickupPlans", plan._id, { ...dropNotice, ringing: undefined, updatedAt: await simNow(ctx) });
  if (!exhausted) return;
  const place = await placeOf(ctx, plan);
  const message = why === "confirm" ? `Couldn't reach ${place} to confirm the pickup with ${plan.helperName}` : `Couldn't reach ${who === "helper" ? plan.helperName : place} with an update on the pickup at ${place}`;
  await logPickup(ctx, plan, message);
}

export async function noAnswer(ctx: MutationCtx, plan: Plan, who: Role, why: Purpose = "ask") {
  if (why !== "ask") return await missedExtra(ctx, plan, who, why);
  if (plan.status === "checking" && who === "helper" && plan.helperAttempts >= MAX_HELPER_ATTEMPTS) {
    return await fellThrough(ctx, plan, "helper_unreachable");
  }
  if (plan.status === "coming" && who === "resident" && plan.residentAttempts >= MAX_RESIDENT_ATTEMPTS) {
    return await fellThrough(ctx, plan, "resident_unreachable");
  }
  await ctx.db.patch("pickupPlans", plan._id, { ringing: undefined, updatedAt: await simNow(ctx) });
}

const LIVE = ["checking", "coming"] as const;
const isLive = (plan: Plan) => (LIVE as readonly string[]).includes(plan.status);

const livePlansFor = async (ctx: MutationCtx, householdId: Id<"households">) =>
  (await ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(20)).filter(isLive);

async function livePlansWithHelper(ctx: MutationCtx, helperHouseholdId: Id<"households">) {
  const lists = await Promise.all(LIVE.map((status) => ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(200)));
  return lists.flat().filter((plan) => plan.helperHouseholdId === helperHouseholdId);
}

// A neighbor we found tonight was asked because the resident couldn't get out in a car of their
// own; a later answer can undo either half. A helper arranged ahead of time is the family's plan,
// and only the resident's "picked up?" answer ends it.
function residentChange(plan: Plan, resident: Doc<"households">): Failure | null {
  if (!plan.recruited) return null;
  if (resident.outcome === "leaving") return "not_needed";
  return fitsInACar(resident) ? null : "needs_changed";
}

// A record change reaches every pickup it touches, as a correction reaches an open offer.
export async function reviewPickups(ctx: MutationCtx, before: Doc<"households">) {
  const after = await ctx.db.get("households", before._id);
  if (!after) return;
  for (const plan of await livePlansFor(ctx, after._id)) {
    const reason = residentChange(plan, after);
    if (reason) await fellThrough(ctx, plan, reason);
  }
  if (!canDrive(before) || canDrive(after)) return;
  for (const plan of await livePlansWithHelper(ctx, after._id)) await fellThrough(ctx, plan, "helper_declined");
}

async function livePlan(ctx: MutationCtx, planId: Id<"pickupPlans">) {
  const plan = await ctx.db.get("pickupPlans", planId);
  if (!plan) throw new Error(`Pickup plan ${planId} not found`);
  return plan;
}

// Voice server: a pickup-check call connected.
export const startAttempt = mutation({
  args: { planId: v.id("pickupPlans"), role, purpose },
  returns: v.null(),
  handler: async (ctx, { planId, role: who, purpose: why }) => {
    await beginAttempt(ctx, await livePlan(ctx, planId), who, why);
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

// Voice server: the resident said whether they'll go with the helper who just said yes.
export const residentConfirmation = mutation({
  args: { planId: v.id("pickupPlans"), confirmed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { planId, confirmed }) => {
    await residentConfirmed(ctx, await livePlan(ctx, planId), confirmed);
    return null;
  },
});

// Voice server: one side heard the status update it was owed.
export const noticeGiven = mutation({
  args: { planId: v.id("pickupPlans"), role },
  returns: v.null(),
  handler: async (ctx, { planId, role: who }) => {
    await noticeHeard(ctx, await livePlan(ctx, planId), who);
    return null;
  },
});

// Voice server, before the confirmation call existed: the resident heard that their helper is on
// the way. Said once per plan. Kept for a voice server that hasn't been redeployed.
export const residentTold = mutation({
  args: { planId: v.id("pickupPlans") },
  returns: v.null(),
  handler: async (ctx, { planId }) => {
    const plan = await livePlan(ctx, planId);
    if (plan.residentToldAt !== undefined) return null;
    await ctx.db.patch("pickupPlans", planId, { residentToldAt: await simNow(ctx), updatedAt: await simNow(ctx) });
    await logPickup(ctx, plan, `Told ${await placeOf(ctx, plan)} that ${plan.helperName} is on the way`);
    return null;
  },
});

// Voice server: nobody picked up. The second miss ends the check.
export const unanswered = mutation({
  args: { planId: v.id("pickupPlans"), role, purpose },
  returns: v.null(),
  handler: async (ctx, { planId, role: who, purpose: why }) => {
    await noAnswer(ctx, await livePlan(ctx, planId), who, why);
    return null;
  },
});

// What the resident's end of a pickup call needs to know about them.
const residentPart = (household: Doc<"households"> | null) => ({
  address: household?.address ?? "",
  residentName: household?.residentName,
  residentPhone: household?.callbackNumber ?? "",
  language: household?.language ?? "en",
  mobility: household?.mobility,
  assistanceRequired: household?.assistanceRequired,
  oxygen: household?.medical?.includes("oxygen") ?? false,
});

const callRow = (plan: Plan, household: Doc<"households"> | null) => ({
  _id: plan._id,
  householdId: plan.householdId,
  status: plan.status,
  ringing: plan.ringing,
  helperName: plan.helperName,
  helperPhone: plan.helperPhone,
  relation: plan.relation,
  recruited: plan.recruited ?? false,
  helperHouseholdId: plan.helperHouseholdId,
  helperAttempts: plan.helperAttempts,
  residentAttempts: plan.residentAttempts,
  lastAttemptAt: plan.lastAttemptAt,
  helperEtaAt: plan.helperEtaAt,
  residentToldAt: plan.residentToldAt,
  residentConfirmedAt: plan.residentConfirmedAt,
  confirmAttempts: plan.confirmAttempts ?? 0,
  helperNotice: plan.helperNotice,
  helperNoticeAttempts: plan.helperNoticeAttempts ?? 0,
  residentNotice: plan.residentNotice,
  residentNoticeAttempts: plan.residentNoticeAttempts ?? 0,
  reason: plan.reason,
  ...residentPart(household),
});

const owesNotice = (plan: Plan) => plan.helperNotice !== undefined || plan.residentNotice !== undefined;

// Voice server: real pickup calls to place, including pickups that ended with an update still owed
// to one side. Retry timing and who is due are the server's job.
export const callQueue = query({
  args: {},
  handler: async (ctx) => {
    const lists = await Promise.all(
      (["checking", "coming", "fell_through"] as const).map((status) =>
        ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(100),
      ),
    );
    const real = lists.flat().filter((plan) => !plan.simulated && (isLive(plan) || owesNotice(plan)));
    return await Promise.all(real.map(async (plan) => callRow(plan, await ctx.db.get("households", plan.householdId))));
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
