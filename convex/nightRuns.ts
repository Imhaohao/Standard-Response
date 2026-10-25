import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { MutationCtx, query } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { Doc, Id, TableNames } from "./_generated/dataModel";

// Every night is kept. A rewind copies the night into `nightRuns` / `nightRunRows`, clears it, and
// puts the homes and arranged pickups back as they were when the run started, so the Ready check and
// the warning can be run again on the same households. A reset keeps the night the same way before
// it clears everything. Nothing here reads a run back into the live tables except a rewind's restore.

// What the night writes. A rewind and a reset both copy these into the run and clear them.
const NIGHT_TABLES = [
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
  "neighborCalls",
  "pickupPlans",
  "vehicles",
  "shelters",
  "vehicleRoutes",
  "vehicleLoads",
  "dispatchState",
] as const;
// The setup a reset also clears. A rewind keeps it: homes are put back, the zone and personas stay.
const SETUP_TABLES = ["households", "zones", "personas"] as const;
// What a run starts from, and what a rewind puts back.
const START_TABLES = ["households", "pickupPlans"] as const;

type Mode = "rewind" | "reset";
type NightTable = (typeof NIGHT_TABLES)[number] | (typeof SETUP_TABLES)[number];

// One run may read 4,096 rows in total, and each row saved is a read, a write and a delete.
const BATCH = 500;

function saved(runId: Id<"nightRuns">, kind: "start" | "end", table: TableNames, row: { _id: string; _creationTime: number }) {
  const { _id, _creationTime, ...doc } = row;
  return { runId, kind, table, docId: _id, createdAt: _creationTime, doc };
}

async function currentRun(ctx: MutationCtx) {
  return await ctx.db
    .query("nightRuns")
    .withIndex("by_status", (q) => q.eq("status", "current"))
    .first();
}

// The Ready check or the warning starts a run, unless one is already going: its start is the setup
// that a rewind returns to. Called before either changes a home.
export async function startRunIfNone(ctx: MutationCtx) {
  if (await currentRun(ctx)) return;
  const runId = await ctx.db.insert("nightRuns", { startedAt: Date.now(), status: "current" });
  for (const table of START_TABLES) {
    for (const row of await ctx.db.query(table).take(1000)) await ctx.db.insert("nightRunRows", saved(runId, "start", table, row));
  }
}

async function nothingToSave(ctx: MutationCtx) {
  for (const table of [...NIGHT_TABLES, ...SETUP_TABLES]) if (await ctx.db.query(table).first()) return false;
  return true;
}

// Ends the current run, or opens one for a night that began before runs were kept, and starts copying
// it. A deployment with nothing in it has no night to keep.
export async function archiveNight(ctx: MutationCtx, control: Doc<"control">, mode: Mode) {
  const run = await currentRun(ctx);
  if (!run && (await nothingToSave(ctx))) return undefined;
  const ending = { endedAt: Date.now(), warningIssuedAt: control.warningIssuedAt, hazard: control.hazard, status: "archiving" as const, endedBy: mode };
  const runId = run ? run._id : await ctx.db.insert("nightRuns", { startedAt: Date.now(), ...ending });
  if (run) await ctx.db.patch("nightRuns", runId, ending);
  await ctx.scheduler.runAfter(0, internal.nightRuns.archiveStep, { runId, mode, stage: mode === "rewind" ? "homes" : "tables", savedRows: 0 });
  return runId;
}

// A home the night touched, in a run that began before runs were kept, goes back to what we knew
// before any call: who and where it is, and the rider list's prior. A home nobody reached keeps all of it.
const LEARNED_ON_CALLS = {
  canLeave: undefined,
  peopleCount: undefined,
  mobility: undefined,
  assistanceRequired: undefined,
  medical: undefined,
  pets: undefined,
  hasCar: undefined,
  confidence: undefined,
  corrections: undefined,
  escalation: undefined,
  ready: undefined,
  readyMisses: undefined,
  neighborSearch: undefined,
  ladder: undefined,
  doorPriority: undefined,
  lastAttemptAt: undefined,
  outcome: "unknown" as const,
  callStatus: "not_called" as const,
  attempts: 0,
};

const reached = (home: Doc<"households">) => home.attempts > 0 || home.ready !== undefined || (home.readyMisses ?? 0) > 0;

async function restoreHome(ctx: MutationCtx, home: Doc<"households">, start: Map<string, Record<string, unknown>>) {
  const before = start.get(home._id);
  if (before) return await ctx.db.replace("households", home._id, before as Omit<Doc<"households">, "_id" | "_creationTime">);
  if (reached(home)) await ctx.db.patch("households", home._id, { ...LEARNED_ON_CALLS, needProbability: home.needPrior });
}

async function startRows(ctx: MutationCtx, runId: Id<"nightRuns">, table: TableNames) {
  const rows = await ctx.db
    .query("nightRunRows")
    .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", runId).eq("kind", "start").eq("table", table))
    .take(1000);
  return new Map(rows.map((row) => [row.docId, row.doc as Record<string, unknown>]));
}

// Rewind: each home is saved as the night left it, then put back as the run started.
async function homesStep(ctx: MutationCtx, runId: Id<"nightRuns">, cursor: string | null) {
  const page = await ctx.db.query("households").paginate({ numItems: BATCH, cursor });
  const start = await startRows(ctx, runId, "households");
  for (const home of page.page) {
    await ctx.db.insert("nightRunRows", saved(runId, "end", "households", home));
    await restoreHome(ctx, home, start);
  }
  return { done: page.isDone, cursor: page.continueCursor, savedRows: page.page.length };
}

// Saves and clears the night's rows, a batch at a time across tables.
async function tablesStep(ctx: MutationCtx, runId: Id<"nightRuns">, mode: Mode) {
  const tables: readonly NightTable[] = mode === "reset" ? [...NIGHT_TABLES, ...SETUP_TABLES] : NIGHT_TABLES;
  let budget = BATCH;
  for (const table of tables) {
    const rows = await ctx.db.query(table).take(budget);
    for (const row of rows) {
      await ctx.db.insert("nightRunRows", saved(runId, "end", table, row));
      await ctx.db.delete(table, row._id);
    }
    budget -= rows.length;
    if (budget === 0) return { done: false, savedRows: BATCH };
  }
  return { done: true, savedRows: BATCH - budget };
}

// Rewind: the pickups people arranged ahead of time, as they were when the run started.
async function restorePickups(ctx: MutationCtx, runId: Id<"nightRuns">) {
  const start = await startRows(ctx, runId, "pickupPlans");
  for (const plan of start.values()) {
    const home = await ctx.db.get("households", plan.householdId as Id<"households">);
    if (home) await ctx.db.insert("pickupPlans", plan as Omit<Doc<"pickupPlans">, "_id" | "_creationTime">);
  }
}

async function finish(ctx: MutationCtx, runId: Id<"nightRuns">, savedRows: number) {
  await ctx.db.patch("nightRuns", runId, { status: "archived", savedRows });
  const control = await ctx.db.query("control").first();
  if (control?.archivingRunId === runId) await ctx.db.patch("control", control._id, { archivingRunId: undefined });
}

const stage = v.union(v.literal("homes"), v.literal("tables"), v.literal("restore"));

export const archiveStep = internalMutation({
  args: {
    runId: v.id("nightRuns"),
    mode: v.union(v.literal("rewind"), v.literal("reset")),
    stage,
    cursor: v.optional(v.union(v.string(), v.null())),
    savedRows: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { runId, mode, stage: step, cursor, savedRows }) => {
    const next = (args: { stage: "homes" | "tables" | "restore"; cursor?: string | null; savedRows: number }) =>
      ctx.scheduler.runAfter(0, internal.nightRuns.archiveStep, { runId, mode, ...args });
    if (step === "homes") {
      const result = await homesStep(ctx, runId, cursor ?? null);
      const total = savedRows + result.savedRows;
      await next(result.done ? { stage: "tables", savedRows: total } : { stage: "homes", cursor: result.cursor, savedRows: total });
      return null;
    }
    if (step === "tables") {
      const result = await tablesStep(ctx, runId, mode);
      const total = savedRows + result.savedRows;
      if (!result.done) await next({ stage: "tables", savedRows: total });
      else if (mode === "rewind") await next({ stage: "restore", savedRows: total });
      else await finish(ctx, runId, total);
      return null;
    }
    await restorePickups(ctx, runId);
    await finish(ctx, runId, savedRows);
    return null;
  },
});

// Every night kept, newest first.
export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("nightRuns").order("desc").take(100),
});

// One table of a kept night, as the night left it (`end`) or as the run started (`start`).
export const rows = query({
  args: {
    runId: v.id("nightRuns"),
    table: v.string(),
    kind: v.optional(v.union(v.literal("start"), v.literal("end"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { runId, table, kind, paginationOpts }) =>
    await ctx.db
      .query("nightRunRows")
      .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", runId).eq("kind", kind ?? "end").eq("table", table))
      .paginate(paginationOpts),
});
