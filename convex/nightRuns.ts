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
  "truckDrills",
] as const;
// The setup a reset also clears. A rewind keeps it: homes are put back, the zone and personas stay.
const SETUP_TABLES = ["households", "zones", "personas"] as const;
// What a run starts from, and what a rewind puts back.
const START_TABLES = ["households", "pickupPlans"] as const;

type Mode = "rewind" | "reset";
// The two points a rewind can go back to: before the Ready check (`start`), or after it and just
// before the warning (`warning`).
export type Checkpoint = "start" | "warning";
type Kind = Checkpoint | "end";
type NightTable = (typeof NIGHT_TABLES)[number] | (typeof SETUP_TABLES)[number];

// One run may read 4,096 rows in total, and each row saved is a read, a write and a delete.
const BATCH = 500;
// Putting a home back changes its outcome and call status, and each of those queues a count update.
// The queue entry is reread on every update, so the bytes add up with the square of the home count.
// Two hundred homes in one transaction crossed Convex's 16 MB read limit and the save died there.
// Forty stays near a megabyte. Exported so the test can build a town that takes two steps.
export const HOUSEHOLD_BATCH = 40;
// A save step schedules the next one. If that chain stops, the next Ready check or warning starts it again.
const ARCHIVE_STALE_MS = 45_000;

function saved(runId: Id<"nightRuns">, kind: Kind, table: TableNames, row: { _id: string; _creationTime: number }) {
  const { _id, _creationTime, ...doc } = row;
  return { runId, kind, table, docId: _id, createdAt: _creationTime, doc };
}

async function currentRun(ctx: MutationCtx) {
  return await ctx.db
    .query("nightRuns")
    .withIndex("by_status", (q) => q.eq("status", "current"))
    .first();
}

async function saveCheckpoint(ctx: MutationCtx, runId: Id<"nightRuns">, kind: Checkpoint) {
  for (const table of START_TABLES) {
    for (const row of await ctx.db.query(table).take(1000)) await ctx.db.insert("nightRunRows", saved(runId, kind, table, row));
  }
}

// The Ready check or the warning starts a run, unless one is already going: its start is the setup
// that a rewind returns to. Called before either changes a home.
export async function startRunIfNone(ctx: MutationCtx) {
  if (await currentRun(ctx)) return;
  const runId = await ctx.db.insert("nightRuns", { startedAt: Date.now(), status: "current" });
  await saveCheckpoint(ctx, runId, "start");
}

// The warning, before it changes any home: the Ready check's results, which a rewind to the warning
// puts back. Taken fresh at each warning, so a profile fixed after a rewind is part of the next one.
export async function saveWarningCheckpoint(ctx: MutationCtx) {
  await startRunIfNone(ctx);
  const run = await currentRun(ctx);
  if (!run) return;
  for (const table of START_TABLES) {
    const stale = await ctx.db
      .query("nightRunRows")
      .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", run._id).eq("kind", "warning").eq("table", table))
      .take(1000);
    for (const row of stale) await ctx.db.delete("nightRunRows", row._id);
  }
  await saveCheckpoint(ctx, run._id, "warning");
}

async function nothingToSave(ctx: MutationCtx) {
  for (const table of [...NIGHT_TABLES, ...SETUP_TABLES]) if (await ctx.db.query(table).first()) return false;
  return true;
}

// Ends the current run, or opens one for a night that began before runs were kept, and starts copying
// it. A deployment with nothing in it has no night to keep.
export async function archiveNight(ctx: MutationCtx, control: Doc<"control">, mode: Mode, to: Checkpoint = "start") {
  const run = await currentRun(ctx);
  if (!run && (await nothingToSave(ctx))) return undefined;
  const stage: "homes" | "tables" = mode === "rewind" ? "homes" : "tables";
  const ending = {
    endedAt: Date.now(),
    warningIssuedAt: control.warningIssuedAt,
    hazard: control.hazard,
    status: "archiving" as const,
    endedBy: mode,
    rewindTo: mode === "rewind" ? to : undefined,
    archiveStage: stage,
    archiveSavedRows: 0,
    archiveTouchedAt: Date.now(),
  };
  const runId = run ? run._id : await ctx.db.insert("nightRuns", { startedAt: Date.now(), ...ending });
  if (run) await ctx.db.patch("nightRuns", runId, ending);
  await ctx.scheduler.runAfter(0, internal.nightRuns.archiveStep, { runId, mode, to, stage, savedRows: 0 });
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

// What only the night's own calls learn. A home with no warning checkpoint (a night from before they
// were saved, or a home added after the warning) loses this and keeps its Ready check profile.
const LEARNED_TONIGHT = {
  canLeave: undefined,
  confidence: undefined,
  corrections: undefined,
  escalation: undefined,
  neighborSearch: undefined,
  ladder: undefined,
  doorPriority: undefined,
  lastAttemptAt: undefined,
  outcome: "unknown" as const,
  callStatus: "not_called" as const,
  attempts: 0,
};

async function restoreHome(ctx: MutationCtx, home: Doc<"households">, checkpoint: Map<string, Record<string, unknown>>, to: Checkpoint) {
  const before = checkpoint.get(home._id);
  if (before) return await ctx.db.replace("households", home._id, before as Omit<Doc<"households">, "_id" | "_creationTime">);
  if (to === "warning") return await ctx.db.patch("households", home._id, LEARNED_TONIGHT);
  if (reached(home)) await ctx.db.patch("households", home._id, { ...LEARNED_ON_CALLS, needProbability: home.needPrior });
}

async function checkpointRows(ctx: MutationCtx, runId: Id<"nightRuns">, kind: Checkpoint, table: TableNames) {
  const rows = await ctx.db
    .query("nightRunRows")
    .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", runId).eq("kind", kind).eq("table", table))
    .take(1000);
  return new Map(rows.map((row) => [row.docId, row.doc as Record<string, unknown>]));
}

async function savedDocIds(ctx: MutationCtx, runId: Id<"nightRuns">, table: string) {
  const rows = await ctx.db
    .query("nightRunRows")
    .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", runId).eq("kind", "end").eq("table", table))
    .take(1000);
  return new Set(rows.map((row) => row.docId));
}

// Rewind: each home is saved as the night left it, then put back as it was at the checkpoint.
// A page that already has an end row is put back again and not copied twice, so a restarted step is safe.
async function homesStep(ctx: MutationCtx, runId: Id<"nightRuns">, to: Checkpoint, cursor: string | null) {
  const page = await ctx.db.query("households").paginate({ numItems: HOUSEHOLD_BATCH, cursor });
  const checkpoint = await checkpointRows(ctx, runId, to, "households");
  const already = await savedDocIds(ctx, runId, "households");
  let kept = 0;
  for (const home of page.page) {
    if (!already.has(home._id)) {
      await ctx.db.insert("nightRunRows", saved(runId, "end", "households", home));
      kept += 1;
    }
    await restoreHome(ctx, home, checkpoint, to);
  }
  return { done: page.isDone, cursor: page.continueCursor, savedRows: kept };
}

function tableLimit(table: NightTable, room: number) {
  return table === "households" ? Math.min(room, HOUSEHOLD_BATCH) : room;
}

// Saves and clears the night's rows, a batch at a time across tables.
async function tablesStep(ctx: MutationCtx, runId: Id<"nightRuns">, mode: Mode) {
  const tables: readonly NightTable[] = mode === "reset" ? [...NIGHT_TABLES, ...SETUP_TABLES] : NIGHT_TABLES;
  let kept = 0;
  for (const table of tables) {
    const room = BATCH - kept;
    if (room === 0) return { done: false, savedRows: kept };
    const limit = tableLimit(table, room);
    const rows = await ctx.db.query(table).take(limit);
    for (const row of rows) {
      await ctx.db.insert("nightRunRows", saved(runId, "end", table, row));
      await ctx.db.delete(table, row._id);
    }
    kept += rows.length;
    // A full page may have more behind it. An exact fit costs one extra empty step.
    if (rows.length === limit && limit > 0) return { done: false, savedRows: kept };
  }
  return { done: true, savedRows: kept };
}

// Rewind: the pickups arranged ahead of time, as they were at the checkpoint.
// The tables step cleared these first, so any row here means this step already finished.
async function restorePickups(ctx: MutationCtx, runId: Id<"nightRuns">, to: Checkpoint) {
  if (await ctx.db.query("pickupPlans").first()) return;
  const checkpoint = await checkpointRows(ctx, runId, to, "pickupPlans");
  for (const plan of checkpoint.values()) {
    const home = await ctx.db.get("households", plan.householdId as Id<"households">);
    if (home) await ctx.db.insert("pickupPlans", plan as Omit<Doc<"pickupPlans">, "_id" | "_creationTime">);
  }
}

// A rewind to the warning lands after the Ready check, so the next night is already under way: it
// opens with the same two checkpoints, and rewinding it again can still go back to either.
async function openRunAfterReadyCheck(ctx: MutationCtx, from: Id<"nightRuns">) {
  const runId = await ctx.db.insert("nightRuns", { startedAt: Date.now(), status: "current" });
  for (const kind of ["start", "warning"] as const) {
    for (const table of START_TABLES) {
      const rows = await ctx.db
        .query("nightRunRows")
        .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", from).eq("kind", kind).eq("table", table))
        .take(1000);
      for (const row of rows) await ctx.db.insert("nightRunRows", { runId, kind, table, docId: row.docId, createdAt: row.createdAt, doc: row.doc });
    }
  }
}

async function finish(ctx: MutationCtx, runId: Id<"nightRuns">, savedRows: number, reopen: boolean) {
  await ctx.db.patch("nightRuns", runId, { status: "archived", savedRows });
  if (reopen) await openRunAfterReadyCheck(ctx, runId);
  const control = await ctx.db.query("control").first();
  if (control?.archivingRunId === runId) await ctx.db.patch("control", control._id, { archivingRunId: undefined });
}

const stage = v.union(v.literal("homes"), v.literal("tables"), v.literal("restore"));
export const checkpoint = v.union(v.literal("start"), v.literal("warning"));

type ArchivePlace = { stage: "homes" | "tables" | "restore"; cursor?: string | null; savedRows: number };

async function scheduleArchive(ctx: MutationCtx, runId: Id<"nightRuns">, mode: Mode, to: Checkpoint, step: ArchivePlace) {
  await ctx.db.patch("nightRuns", runId, {
    archiveStage: step.stage,
    archiveCursor: step.cursor ?? undefined,
    archiveSavedRows: step.savedRows,
    archiveTouchedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.nightRuns.archiveStep, { runId, mode, to, stage: step.stage, cursor: step.cursor, savedRows: step.savedRows });
}

function placeOf(run: Doc<"nightRuns">, readyCheckStartedAt: number | undefined): ArchivePlace & { mode: Mode; to: Checkpoint } {
  const mode: Mode = run.endedBy === "reset" ? "reset" : "rewind";
  const to: Checkpoint = run.rewindTo ?? (readyCheckStartedAt ? "warning" : "start");
  const step = run.archiveStage ?? (mode === "reset" ? "tables" : "homes");
  return { mode, to, stage: step, cursor: run.archiveCursor ?? null, savedRows: run.archiveSavedRows ?? 0 };
}

// A copy that stopped partway is started again from the place it recorded.
export async function resumeArchiveIfStale(ctx: MutationCtx, control: Doc<"control">) {
  const runId = control.archivingRunId;
  if (!runId) return;
  const run = await ctx.db.get("nightRuns", runId);
  if (!run || run.status !== "archiving") {
    await ctx.db.patch("control", control._id, { archivingRunId: undefined });
    return;
  }
  const touched = run.archiveTouchedAt ?? run.endedAt ?? 0;
  if (Date.now() - touched < ARCHIVE_STALE_MS) return;
  const { mode, to, ...step } = placeOf(run, control.readyCheckStartedAt);
  await scheduleArchive(ctx, runId, mode, to, step);
}

// True while the last night is still being copied. A dead copy is started again before this returns,
// and that schedule only sticks if the caller does not then throw.
export async function nightSaveInProgress(ctx: MutationCtx, control: Doc<"control">) {
  if (!control.archivingRunId) return false;
  await resumeArchiveIfStale(ctx, control);
  const fresh = await ctx.db.get("control", control._id);
  return fresh?.archivingRunId !== undefined;
}

export const archiveStep = internalMutation({
  args: {
    runId: v.id("nightRuns"),
    mode: v.union(v.literal("rewind"), v.literal("reset")),
    // Where a rewind goes back to; a reset ignores it.
    to: v.optional(checkpoint),
    stage,
    cursor: v.optional(v.union(v.string(), v.null())),
    savedRows: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { runId, mode, to = "start", stage: step, cursor, savedRows }) => {
    const next = (place: ArchivePlace) => scheduleArchive(ctx, runId, mode, to, place);
    if (step === "homes") {
      const result = await homesStep(ctx, runId, to, cursor ?? null);
      const total = savedRows + result.savedRows;
      await next(result.done ? { stage: "tables", savedRows: total } : { stage: "homes", cursor: result.cursor, savedRows: total });
      return null;
    }
    if (step === "tables") {
      const result = await tablesStep(ctx, runId, mode);
      const total = savedRows + result.savedRows;
      if (!result.done) await next({ stage: "tables", savedRows: total });
      else if (mode === "rewind") await next({ stage: "restore", savedRows: total });
      else await finish(ctx, runId, total, false);
      return null;
    }
    await restorePickups(ctx, runId, to);
    await finish(ctx, runId, savedRows, to === "warning");
    return null;
  },
});

// The live night was left archiving after the copy died. Run once: npx convex run nightRuns:resumeStuck
export const resumeStuck = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const control = await ctx.db.query("control").first();
    if (!control?.archivingRunId) return null;
    const run = await ctx.db.get("nightRuns", control.archivingRunId);
    if (!run || run.status !== "archiving") {
      await ctx.db.patch("control", control._id, { archivingRunId: undefined });
      return null;
    }
    const { mode, to, ...step } = placeOf(run, control.readyCheckStartedAt);
    await scheduleArchive(ctx, control.archivingRunId, mode, to, step);
    return null;
  },
});

// Every night kept, newest first.
export const list = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("nightRuns").order("desc").take(100),
});

// One table of a kept night: as the night left it (`end`), as the run started (`start`), or just
// before the warning (`warning`).
export const rows = query({
  args: {
    runId: v.id("nightRuns"),
    table: v.string(),
    kind: v.optional(v.union(checkpoint, v.literal("end"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { runId, table, kind, paginationOpts }) =>
    await ctx.db
      .query("nightRunRows")
      .withIndex("by_runId_and_kind_and_table", (q) => q.eq("runId", runId).eq("kind", kind ?? "end").eq("table", table))
      .paginate(paginationOpts),
});
