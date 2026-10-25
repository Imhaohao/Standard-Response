import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { ActionCtx, internalAction, internalQuery, MutationCtx, query, QueryCtx } from "./_generated/server";
import { internalMutation } from "./functions";
import { simNow } from "./clock";
import { agencyTransfers, createCheckingAccount, createCustomer, createTransfer, customerAccounts, getTransfer, NessieConfig, nessieConfig, transferIdOf } from "./nessie";
import { completedRouteMiles } from "./reimburseMiles";
import schema, { reimbursementStatus } from "./schema";

// Mileage for volunteer drivers, paid through Capital One's Nessie sandbox. When the resident
// confirms that their neighbor or named helper picked them up (pickups.ts markDone), one row is
// written for the ride and `pay` is scheduled in the same transaction. Agency vans never come here.
//
// A ride is paid at most once:
//   - the row is keyed by ride (`rideKey`), written only if absent, inside the completing mutation;
//   - `claim` lets one attempt at a time hold the row, and never touches a paid row;
//   - `postedAt` is written before the transfer is sent, so an attempt that follows one whose result
//     is unknown first looks the transfer up in Nessie (by id, else by the ride's reference in the
//     description) and only sends a new one when Nessie has none.

// IRS charitable mileage rate (26 U.S.C. 170(i)), the rate the law sets for driving done for a charity.
const DEFAULT_RATE_PER_MILE = 0.14;
const DEFAULT_MAX_DOLLARS = 25;
// An attempt that has held a row this long without finishing is presumed dead. Every Nessie request
// times out well inside it (nessie.ts), so a live attempt never outlasts its claim.
export const CLAIM_LEASE_MS = 5 * 60_000;

type Reimbursement = Doc<"reimbursements">;

function positiveEnv(name: string, fallback: number) {
  const value = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Nessie's sandbox keeps whole dollars, so the payment rounds up to the next dollar (at least $1),
// in the volunteer's favor, and the cap rounds down.
export function amountCentsFor(miles: number) {
  const rate = positiveEnv("REIMBURSE_RATE_PER_MILE", DEFAULT_RATE_PER_MILE);
  const maxDollars = Math.max(1, Math.floor(positiveEnv("REIMBURSE_MAX", DEFAULT_MAX_DOLLARS)));
  const dollars = Math.max(1, Math.ceil(Math.round(miles * rate * 100) / 100));
  return { rate, amountCents: Math.min(dollars, maxDollars) * 100 };
}

const volunteerKeyOf = (plan: Doc<"pickupPlans">) => plan.helperPhone.replace(/\D/g, "") || `plan:${plan._id}`;
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || "the volunteer";
const reference = (id: Id<"reimbursements">) => `ref ${id}`;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// Called from the mutation that confirms a volunteer's pickup. Simulated households only pay when
// REIMBURSE_SIMULATED is "true", so the stand-in town doesn't fill the sandbox.
export async function scheduleReimbursement(ctx: MutationCtx, plan: Doc<"pickupPlans">) {
  if (plan.simulated && process.env.REIMBURSE_SIMULATED !== "true") return;
  const volunteerKey = volunteerKeyOf(plan);
  const rideKey = `${plan.householdId}:${volunteerKey}`;
  const existing = await ctx.db.query("reimbursements").withIndex("by_rideKey", (q) => q.eq("rideKey", rideKey)).first();
  if (existing) return;
  const { miles, distanceSource } = await completedRouteMiles(ctx, plan);
  const { rate, amountCents } = amountCentsFor(miles);
  const id = await ctx.db.insert("reimbursements", {
    rideKey,
    planId: plan._id,
    householdId: plan.householdId,
    volunteerKey,
    volunteerFirstName: firstNameOf(plan.helperName),
    miles,
    distanceSource,
    ratePerMile: rate,
    amountCents,
    status: amountCents > 0 ? "pending" : "nothing_owed",
    attempts: 0,
    createdAt: Date.now(),
  });
  if (amountCents > 0) await ctx.scheduler.runAfter(0, internal.reimburse.pay, { reimbursementId: id });
}

const reimbursementDoc = v.object({ ...schema.tables.reimbursements.validator.fields, _id: v.id("reimbursements"), _creationTime: v.number() });
const claimResult = v.union(v.object({ kind: v.literal("go"), row: reimbursementDoc }), v.object({ kind: v.literal("skip"), reason: v.string() }));
type Claim = typeof claimResult.type;

function skipReason(row: Reimbursement | null, now: number): string | null {
  if (!row) return "missing";
  if (row.status === "paid" || row.status === "nothing_owed") return row.status;
  if (row.status === "sending" && now - (row.claimedAt ?? 0) < CLAIM_LEASE_MS) return "another attempt holds it";
  return null;
}

// One attempt at a time. A paid row is never claimed. The attempt's number is its claim: the writes
// below refuse an attempt whose claim a later one took over.
export const claim = internalMutation({
  args: { reimbursementId: v.id("reimbursements"), configured: v.boolean() },
  returns: claimResult,
  handler: async (ctx, { reimbursementId, configured }): Promise<Claim> => {
    const row = await ctx.db.get("reimbursements", reimbursementId);
    const reason = skipReason(row, Date.now());
    if (reason !== null || !row) return { kind: "skip", reason: reason ?? "missing" };
    if (!configured) {
      await ctx.db.patch("reimbursements", row._id, { status: "not_configured", claimedAt: undefined, error: undefined });
      return { kind: "skip", reason: "not_configured" };
    }
    const held = { status: "sending" as const, claimedAt: Date.now(), attempts: row.attempts + 1, error: undefined };
    await ctx.db.patch("reimbursements", row._id, held);
    return { kind: "go", row: { ...row, ...held } };
  },
});

const holds = (row: Reimbursement | null, attempt: number): row is Reimbursement => row?.status === "sending" && row.attempts === attempt;

// Written before the transfer is sent: from here on, the result of an attempt may be unknown.
export const markPosting = internalMutation({
  args: { reimbursementId: v.id("reimbursements"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, { reimbursementId, attempt }) => {
    const row = await ctx.db.get("reimbursements", reimbursementId);
    if (!holds(row, attempt)) throw new Error(`Reimbursement ${reimbursementId} is no longer held by attempt ${attempt}`);
    await ctx.db.patch("reimbursements", reimbursementId, { postedAt: row.postedAt ?? Date.now() });
    return null;
  },
});

export const markPaid = internalMutation({
  args: { reimbursementId: v.id("reimbursements"), transferId: v.string(), nessieStatus: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { reimbursementId, transferId, nessieStatus }) => {
    const row = await ctx.db.get("reimbursements", reimbursementId);
    if (!row || row.status === "paid") return null;
    await ctx.db.patch("reimbursements", reimbursementId, {
      status: "paid",
      nessieTransferId: transferId,
      nessieStatus,
      paidAt: Date.now(),
      claimedAt: undefined,
      error: undefined,
    });
    await ctx.db.insert("events", {
      kind: "dispatch",
      message: `Reimbursed ${row.volunteerFirstName} ${dollars(row.amountCents)} for ${row.miles.toFixed(1)} miles`,
      householdId: row.householdId,
      at: await simNow(ctx),
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: { reimbursementId: v.id("reimbursements"), attempt: v.number(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, { reimbursementId, attempt, error }) => {
    const row = await ctx.db.get("reimbursements", reimbursementId);
    if (!holds(row, attempt)) return null;
    await ctx.db.patch("reimbursements", reimbursementId, { status: "failed", error: error.slice(0, 500), claimedAt: undefined });
    await ctx.db.insert("events", {
      kind: "dispatch",
      message: `Couldn't reimburse ${row.volunteerFirstName} ${dollars(row.amountCents)} yet. The payment is waiting for a retry`,
      householdId: row.householdId,
      at: await simNow(ctx),
    });
    return null;
  },
});

const savedIds = v.object({ nessieCustomerId: v.optional(v.string()), nessieAccountId: v.optional(v.string()) });

const volunteerRow = (ctx: QueryCtx, volunteerKey: string) =>
  ctx.db.query("volunteerAccounts").withIndex("by_volunteerKey", (q) => q.eq("volunteerKey", volunteerKey)).first();

export const volunteerIds = internalQuery({
  args: { volunteerKey: v.string() },
  returns: v.union(v.null(), savedIds),
  handler: async (ctx, { volunteerKey }) => {
    const row = await volunteerRow(ctx, volunteerKey);
    return row && { nessieCustomerId: row.nessieCustomerId, nessieAccountId: row.nessieAccountId };
  },
});

// Saves ids the first time they're seen and never replaces one already saved. Returns what is saved,
// which the caller then uses, so two attempts that both made a customer still pay the same account.
export const saveVolunteerIds = internalMutation({
  args: { volunteerKey: v.string(), nessieCustomerId: v.string(), nessieAccountId: v.optional(v.string()) },
  returns: savedIds,
  handler: async (ctx, { volunteerKey, nessieCustomerId, nessieAccountId }) => {
    const row = await volunteerRow(ctx, volunteerKey);
    if (!row) {
      await ctx.db.insert("volunteerAccounts", { volunteerKey, nessieCustomerId, nessieAccountId, updatedAt: Date.now() });
      return { nessieCustomerId, nessieAccountId };
    }
    const customerId = row.nessieCustomerId ?? nessieCustomerId;
    // An account only counts for the customer it was made under.
    const accountId = row.nessieAccountId ?? (customerId === nessieCustomerId ? nessieAccountId : undefined);
    await ctx.db.patch("volunteerAccounts", row._id, { nessieCustomerId: customerId, nessieAccountId: accountId, updatedAt: Date.now() });
    return { nessieCustomerId: customerId, nessieAccountId: accountId };
  },
});

async function volunteerCustomer(ctx: ActionCtx, config: NessieConfig, row: Reimbursement, saved: { nessieCustomerId?: string } | null) {
  if (saved?.nessieCustomerId) return saved.nessieCustomerId;
  const created = await createCustomer(config, row.volunteerFirstName);
  return (await ctx.runMutation(internal.reimburse.saveVolunteerIds, { volunteerKey: row.volunteerKey, nessieCustomerId: created })).nessieCustomerId!;
}

// The volunteer's checking account, made the first time they're paid. An earlier attempt that made
// the customer but not the account is picked up where it stopped.
async function volunteerAccount(ctx: ActionCtx, config: NessieConfig, row: Reimbursement): Promise<string> {
  const saved = await ctx.runQuery(internal.reimburse.volunteerIds, { volunteerKey: row.volunteerKey });
  if (saved?.nessieAccountId) return saved.nessieAccountId;
  const customerId = await volunteerCustomer(ctx, config, row, saved);
  const existing = (await customerAccounts(config, customerId))[0]?._id;
  const accountId = existing ?? (await createCheckingAccount(config, customerId));
  const stored = await ctx.runMutation(internal.reimburse.saveVolunteerIds, { volunteerKey: row.volunteerKey, nessieCustomerId: customerId, nessieAccountId: accountId });
  if (!stored.nessieAccountId) throw new Error("The volunteer's saved Nessie customer changed during setup");
  return stored.nessieAccountId;
}

// A transfer an earlier attempt may have sent: by its id when we have it, else by the reference
// every one of this ride's transfers carries in its description.
async function earlierTransfer(config: NessieConfig, row: Reimbursement) {
  if (row.postedAt === undefined) return null;
  if (row.nessieTransferId) {
    const byId = await getTransfer(config, row.nessieTransferId);
    if (byId) return byId;
  }
  const tag = reference(row._id);
  return (await agencyTransfers(config)).find((transfer) => transfer.description?.includes(tag)) ?? null;
}

async function settle(ctx: ActionCtx, config: NessieConfig, row: Reimbursement) {
  const payee = await volunteerAccount(ctx, config, row);
  const earlier = await earlierTransfer(config, row);
  if (earlier) return { id: transferIdOf(earlier), status: earlier.status };
  await ctx.runMutation(internal.reimburse.markPosting, { reimbursementId: row._id, attempt: row.attempts });
  const description = `Mileage reimbursement, ${row.miles.toFixed(1)} mi at $${row.ratePerMile}/mi (${reference(row._id)})`;
  return await createTransfer(config, payee, row.amountCents, description);
}

export const pay = internalAction({
  args: { reimbursementId: v.id("reimbursements") },
  returns: v.null(),
  handler: async (ctx, { reimbursementId }) => {
    const config = nessieConfig();
    const claimed: Claim = await ctx.runMutation(internal.reimburse.claim, { reimbursementId, configured: config !== null });
    if (claimed.kind !== "go" || !config) return null;
    try {
      const transfer = await settle(ctx, config, claimed.row);
      await ctx.runMutation(internal.reimburse.markPaid, { reimbursementId, transferId: transfer.id, nessieStatus: transfer.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.reimburse.markFailed, { reimbursementId, attempt: claimed.row.attempts, error: message });
    }
    return null;
  },
});

async function requeue(ctx: MutationCtx, row: Reimbursement | null) {
  if (row?.status !== "failed" && row?.status !== "not_configured") return false;
  await ctx.db.patch("reimbursements", row._id, { status: "pending" });
  await ctx.scheduler.runAfter(0, internal.reimburse.pay, { reimbursementId: row._id });
  return true;
}

// Try a failed or unconfigured payment again: `npx convex run reimburse:retry '{"reimbursementId":"..."}'`.
// Safe to run any number of times; a paid row is left alone and a sent transfer is looked up first.
export const retry = internalMutation({
  args: { reimbursementId: v.id("reimbursements") },
  returns: v.boolean(),
  handler: async (ctx, { reimbursementId }) => await requeue(ctx, await ctx.db.get("reimbursements", reimbursementId)),
});

// Every failed or unconfigured payment, for after the key is set: `npx convex run reimburse:retryAll`.
export const retryAll = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let count = 0;
    for (const status of ["failed", "not_configured"] as const) {
      const rows = await ctx.db.query("reimbursements").withIndex("by_status", (q) => q.eq("status", status)).take(100);
      for (const row of rows) if (await requeue(ctx, row)) count++;
    }
    return count;
  },
});

const listRow = v.object({
  _id: v.id("reimbursements"),
  householdId: v.id("households"),
  volunteerFirstName: v.string(),
  miles: v.number(),
  distanceSource: v.union(v.literal("road"), v.literal("straight_line")),
  ratePerMile: v.number(),
  amountCents: v.number(),
  status: reimbursementStatus,
  attempts: v.number(),
  nessieTransferId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  paidAt: v.optional(v.number()),
});

// Dispatcher: the latest volunteer payments, newest first. No phone or bank numbers.
export const list = query({
  args: {},
  returns: v.array(listRow),
  handler: async (ctx) => {
    const rows = await ctx.db.query("reimbursements").order("desc").take(50);
    return rows.map((row) => ({
      _id: row._id,
      householdId: row.householdId,
      volunteerFirstName: row.volunteerFirstName,
      miles: row.miles,
      distanceSource: row.distanceSource,
      ratePerMile: row.ratePerMile,
      amountCents: row.amountCents,
      status: row.status,
      attempts: row.attempts,
      nessieTransferId: row.nessieTransferId,
      error: row.error,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
    }));
  },
});
