import { cancel, type WorkflowId } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

// What the purge deletes for a closed incident, one bounded step at a time (convex/incident.ts runs
// the steps and reschedules itself). "Real" means a household with `simulated: false`.
//
// Deleted: real households (name, phone, address, medical, mobility, notes, Ready profile, helper
// contacts all live on that row), their calls, transcript lines, texts, callbacks, requests,
// assignments, pickup plans and neighbor calls, nominations, and the activity-list, audit-log and
// archived-night rows that name them. Audit log rows are deleted rather than scrubbed: their
// messages carry addresses and names that no pattern removes reliably.
// Each batch of households also leaves Elastic's search index (convex/elastic.ts forgetHomes).
// Kept: simulated households and their rows, vans, shelters, zones, roads, the model and mesh data.

export type Counts = Record<string, number>;
export type Phase = "events" | "auditLog" | "callbacks" | "nominations" | "callPlans" | "archive" | "households";
export const PHASES: readonly Phase[] = ["events", "auditLog", "callbacks", "nominations", "callPlans", "archive", "households"];

export const SCRUB_PAGE = 200;
export const HOUSEHOLD_BATCH = 10;
const DELETE_CHUNK = 256;

export function addCount(counts: Counts, table: string, amount = 1): Counts {
  return { ...counts, [table]: (counts[table] ?? 0) + amount };
}

async function isRealHome(ctx: MutationCtx, householdId: Id<"households"> | undefined) {
  if (!householdId) return false;
  const household = await ctx.db.get("households", householdId);
  return household !== null && !household.simulated;
}

async function isSimulatedHome(ctx: MutationCtx, householdId: string | undefined) {
  if (!householdId) return false;
  const household = await ctx.db.get("households", householdId as Id<"households">);
  return household !== null && household.simulated;
}

async function requestIsReal(ctx: MutationCtx, requestId: Id<"requests"> | undefined) {
  if (!requestId) return false;
  const request = await ctx.db.get("requests", requestId);
  return request !== null && (await isRealHome(ctx, request.householdId));
}

async function nominationNamesRealPerson(ctx: MutationCtx, nomination: Doc<"nominations">) {
  const reference = nomination.fromHouseholdId ?? nomination.matchedHouseholdId;
  return !reference || (await isRealHome(ctx, reference));
}

const ARCHIVE_ALWAYS = new Set(["transcriptLines", "texts", "nominations", "auditLog"]);
const ARCHIVE_BY_SIMULATED_FLAG = new Set(["households", "calls", "pickupPlans"]);

// An archived night row (convex/nightRuns.ts) holds a copy of a live row, so it holds the same data.
async function archivedRowHoldsRealData(ctx: MutationCtx, row: Doc<"nightRunRows">) {
  if (ARCHIVE_ALWAYS.has(row.table)) return true;
  const doc = row.doc as { simulated?: boolean; householdId?: string };
  if (ARCHIVE_BY_SIMULATED_FLAG.has(row.table)) return doc.simulated !== true;
  if (row.table === "events" && !doc.householdId) return false;
  return !(await isSimulatedHome(ctx, doc.householdId));
}

type ScrubbedTable = "events" | "auditLog" | "callbacks" | "nominations" | "nightRunRows";

const REAL_ROW_TESTS: { [T in ScrubbedTable]: (ctx: MutationCtx, row: Doc<T>) => Promise<boolean> } = {
  events: (ctx, row) => isRealHome(ctx, row.householdId),
  auditLog: (ctx, row) => requestIsReal(ctx, row.requestId),
  callbacks: (ctx, row) => isRealHome(ctx, row.householdId),
  nominations: nominationNamesRealPerson,
  nightRunRows: archivedRowHoldsRealData,
};

export async function scrubPage(ctx: MutationCtx, table: ScrubbedTable, cursor: string | null, counts: Counts) {
  const page = await ctx.db.query(table).paginate({ cursor, numItems: SCRUB_PAGE });
  const test = REAL_ROW_TESTS[table] as (ctx: MutationCtx, row: Doc<ScrubbedTable>) => Promise<boolean>;
  let next = counts;
  for (const row of page.page) {
    if (!(await test(ctx, row))) continue;
    await ctx.db.delete(table, row._id);
    next = addCount(next, table);
  }
  return { done: page.isDone, cursor: page.continueCursor, counts: next };
}

// Call plans list homes with the model's reason for each; the real ones come out.
// Volunteer mileage payments key on the volunteer's phone digits and carry their first name. The
// transfers themselves stay in Nessie's ledger; our copies of who was paid go with the incident.
async function scrubVolunteerPay(ctx: MutationCtx, counts: Counts) {
  let next = counts;
  for (const table of ["reimbursements", "volunteerAccounts"] as const) {
    const rows = await ctx.db.query(table).take(500);
    for (const row of rows) await ctx.db.delete(table, row._id);
    next = addCount(next, table, rows.length);
  }
  return next;
}

export async function scrubCallPlans(ctx: MutationCtx, counts: Counts) {
  let next = await scrubVolunteerPay(ctx, counts);
  for (const plan of await ctx.db.query("callPlans").take(100)) {
    const ranked: typeof plan.ranked = [];
    for (const entry of plan.ranked) if (!(await isRealHome(ctx, entry.householdId))) ranked.push(entry);
    if (ranked.length === plan.ranked.length) continue;
    await ctx.db.patch("callPlans", plan._id, { ranked });
    next = addCount(next, "callPlanEntries", plan.ranked.length - ranked.length);
  }
  return next;
}

async function deleteCallsWithTranscripts(ctx: MutationCtx, householdId: Id<"households">, counts: Counts) {
  let next = counts;
  const calls = await ctx.db.query("calls").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(DELETE_CHUNK);
  for (const call of calls) {
    const lines = await ctx.db.query("transcriptLines").withIndex("by_callId", (q) => q.eq("callId", call._id)).take(DELETE_CHUNK);
    for (const line of lines) await ctx.db.delete("transcriptLines", line._id);
    next = addCount(next, "transcriptLines", lines.length);
    await ctx.db.delete("calls", call._id);
  }
  return addCount(next, "calls", calls.length);
}

async function deleteRequestsWithAssignments(ctx: MutationCtx, householdId: Id<"households">, counts: Counts) {
  let next = counts;
  const requests = await ctx.db.query("requests").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(DELETE_CHUNK);
  for (const request of requests) {
    const assignments = await ctx.db.query("assignments").withIndex("by_requestId", (q) => q.eq("requestId", request._id)).take(DELETE_CHUNK);
    for (const assignment of assignments) await ctx.db.delete("assignments", assignment._id);
    next = addCount(next, "assignments", assignments.length);
    await ctx.db.delete("requests", request._id);
  }
  return addCount(next, "requests", requests.length);
}

async function deleteSimpleRows(ctx: MutationCtx, householdId: Id<"households">, counts: Counts) {
  const texts = await ctx.db.query("texts").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(DELETE_CHUNK);
  for (const text of texts) await ctx.db.delete("texts", text._id);
  const plans = await ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(DELETE_CHUNK);
  for (const plan of plans) await ctx.db.delete("pickupPlans", plan._id);
  const owned = await ctx.db.query("neighborCalls").withIndex("by_householdId", (q) => q.eq("householdId", householdId)).take(DELETE_CHUNK);
  const about = await ctx.db.query("neighborCalls").withIndex("by_forHouseholdId", (q) => q.eq("forHouseholdId", householdId)).take(DELETE_CHUNK);
  for (const row of [...owned, ...about]) await ctx.db.delete("neighborCalls", row._id);
  let next = addCount(counts, "texts", texts.length);
  next = addCount(next, "pickupPlans", plans.length);
  return addCount(next, "neighborCalls", owned.length + about.length);
}

async function cancelLadderWorkflow(ctx: MutationCtx, household: Doc<"households">) {
  if (!household.ladder) return;
  try {
    await cancel(ctx, components.workflow, household.ladder.workflowId as WorkflowId);
  } catch (error) {
    console.warn(`[incident] could not cancel ${household.ladder.workflowId}`, error);
  }
}

async function purgeHousehold(ctx: MutationCtx, household: Doc<"households">, counts: Counts) {
  await cancelLadderWorkflow(ctx, household);
  let next = await deleteCallsWithTranscripts(ctx, household._id, counts);
  next = await deleteRequestsWithAssignments(ctx, household._id, next);
  next = await deleteSimpleRows(ctx, household._id, next);
  await ctx.db.delete("households", household._id);
  return addCount(next, "households");
}

// Deletes one batch of real households and what hangs off them. `done` once none is left.
export async function purgeHouseholdBatch(ctx: MutationCtx, counts: Counts) {
  const batch = await ctx.db.query("households").withIndex("by_simulated", (q) => q.eq("simulated", false)).take(HOUSEHOLD_BATCH);
  let next = counts;
  for (const household of batch) next = await purgeHousehold(ctx, household, next);
  if (batch.length > 0) await ctx.scheduler.runAfter(0, internal.elastic.forgetHomes, { householdIds: batch.map((h) => h._id) });
  return { done: batch.length < HOUSEHOLD_BATCH, counts: next };
}

export async function realRiderDataExists(ctx: MutationCtx) {
  const real = await ctx.db.query("households").withIndex("by_simulated", (q) => q.eq("simulated", false)).first();
  return real !== null;
}
