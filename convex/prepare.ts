import { v } from "convex/values";
import { MutationCtx, query, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { emptyRound } from "../lib/mesh/rounds";
import { AREA_IDS } from "../lib/prepare/areas";
import { applyUpload, CountyState, freshTally, freshTask, TaskState } from "../lib/prepare/county";
import { CAMPAIGN, Mix } from "../lib/prepare/mixing";
import { estimatesFrom, TALLY_ITEMS, townEstimates } from "../lib/prepare/tally";
import { initialModel, SurveyModel, TASK_IDS, TaskId, taskDimensions } from "../lib/prepare/tasks";

// Readiness survey add-on: what gateway phones upload for the households around them, and what the
// county reads back. Uploads are mixes only (lib/prepare/mixing.ts): sums over five or more
// households of noised model updates or randomized-response counts. No answer, phone, person or
// uploader id ever arrives. Nothing in the core flow or the mesh reads these tables.

const MAX_MIXES_PER_UPLOAD = 16;
const HISTORY = 60;

const mixArg = v.object({ channel: v.string(), sum: v.array(v.number()), mass: v.number() });
const modelShape = v.object({ version: v.number(), weights: v.array(v.number()), issuedAt: v.number(), contributors: v.number(), sampleRate: v.number() });
const modelsShape = v.object({ water: modelShape, money: modelShape });

async function latestModelRow(ctx: QueryCtx, task: TaskId) {
  return await ctx.db
    .query("prepareModels")
    .withIndex("by_task_version", (q) => q.eq("task", task))
    .order("desc")
    .first();
}

type ModelRow = { version: number; weights: number[]; issuedAt: number; contributors: number; sampleRate: number };
const publicModel = (task: TaskId, row: ModelRow | null): SurveyModel =>
  row ? { version: row.version, weights: row.weights, issuedAt: row.issuedAt, contributors: row.contributors, sampleRate: row.sampleRate } : initialModel(task);

async function latestModels(ctx: QueryCtx) {
  const entries = await Promise.all(TASK_IDS.map(async (task) => [task, publicModel(task, await latestModelRow(ctx, task))] as const));
  return Object.fromEntries(entries) as Record<TaskId, SurveyModel>;
}

async function roundRow(ctx: QueryCtx, task: TaskId) {
  return await ctx.db
    .query("prepareRounds")
    .withIndex("by_task", (q) => q.eq("task", task))
    .first();
}

async function tallyRow(ctx: QueryCtx) {
  return await ctx.db
    .query("prepareTallies")
    .withIndex("by_campaign", (q) => q.eq("campaign", CAMPAIGN))
    .first();
}

async function loadTask(ctx: QueryCtx, task: TaskId): Promise<TaskState> {
  const latest = await latestModelRow(ctx, task);
  const model = publicModel(task, latest);
  const round = await roundRow(ctx, task);
  const fresh = freshTask(task);
  return {
    model,
    optimizer: latest ? { first: latest.first, second: latest.second } : fresh.optimizer,
    round: round ? { baseVersion: round.baseVersion, sum: round.sum, mass: round.mass, uploads: round.uploads, staleMass: round.staleMass } : emptyRound(model.version, taskDimensions(task)),
  };
}

async function saveTask(ctx: MutationCtx, task: TaskId, state: TaskState) {
  const row = await roundRow(ctx, task);
  if (row) await ctx.db.patch("prepareRounds", row._id, state.round);
  else await ctx.db.insert("prepareRounds", { task, ...state.round });
}

// Adds an upload's mixes to the open rounds and the counts; each full round becomes the next
// version of its model. Returns the newest models for the gateway to pass on.
export const upload = mutation({
  args: { mixes: v.array(mixArg) },
  returns: v.object({ accepted: v.number(), refused: v.number(), models: modelsShape }),
  handler: async (ctx, { mixes }) => {
    const tally = await tallyRow(ctx);
    const tasks = Object.fromEntries(await Promise.all(TASK_IDS.map(async (task) => [task, await loadTask(ctx, task)] as const))) as Record<TaskId, TaskState>;
    const state: CountyState = { tasks, tally: tally ? { sum: tally.sum, mass: tally.mass, uploads: tally.uploads } : freshTally(), refused: 0, staleBlocks: 0 };
    const result = applyUpload(state, mixes.slice(0, MAX_MIXES_PER_UPLOAD) as Mix[], Date.now());
    const refused = result.refused + Math.max(0, mixes.length - MAX_MIXES_PER_UPLOAD);
    for (const closed of result.closed) {
      await ctx.db.insert("prepareModels", {
        task: closed.task,
        ...closed.model,
        ...closed.optimizer,
        round: { mass: closed.round.mass, uploads: closed.round.uploads, staleMass: closed.round.staleMass },
      });
    }
    for (const task of TASK_IDS) await saveTask(ctx, task, state.tasks[task]);
    const counts = { ...state.tally, refused: (tally?.refused ?? 0) + refused };
    if (tally) await ctx.db.patch("prepareTallies", tally._id, counts);
    else await ctx.db.insert("prepareTallies", { campaign: CAMPAIGN, ...counts });
    const models = Object.fromEntries(TASK_IDS.map((task) => [task, state.tasks[task].model])) as Record<TaskId, SurveyModel>;
    return { accepted: result.accepted, refused, models };
  },
});

// The newest version of every shared model. Public: phones download it on any connection.
export const models = query({
  args: {},
  returns: modelsShape,
  handler: async (ctx) => await latestModels(ctx),
});

const estimateShape = v.object({ answered: v.number(), share: v.union(v.number(), v.null()), low: v.union(v.number(), v.null()), high: v.union(v.number(), v.null()) });
const estimatesShape = v.record(v.string(), estimateShape);

// What the county knows from the counts: every area's estimated share per item, and the town's.
export const counts = query({
  args: {},
  returns: v.object({
    areas: v.array(v.object({ id: v.string(), estimates: estimatesShape })),
    town: estimatesShape,
    households: v.number(),
    uploads: v.number(),
    refused: v.number(),
    items: v.array(v.object({ id: v.string(), topic: v.string(), label: v.string() })),
  }),
  handler: async (ctx) => {
    const row = await tallyRow(ctx);
    const sum = row?.sum ?? freshTally().sum;
    return {
      areas: estimatesFrom(sum).map((estimates, i) => ({ id: AREA_IDS[i], estimates })),
      town: townEstimates(sum),
      households: row?.mass ?? 0,
      uploads: row?.uploads ?? 0,
      refused: row?.refused ?? 0,
      items: TALLY_ITEMS.map(({ id, topic, label }) => ({ id, topic, label })),
    };
  },
});

// Each model's recent versions and its open round, for the county view.
export const history = query({
  args: {},
  returns: v.array(
    v.object({
      task: v.string(),
      versions: v.array(v.object({ version: v.number(), issuedAt: v.number(), contributors: v.number(), weights: v.array(v.number()) })),
      open: v.union(v.null(), v.object({ baseVersion: v.number(), mass: v.number(), uploads: v.number() })),
    }),
  ),
  handler: async (ctx) =>
    await Promise.all(
      TASK_IDS.map(async (task) => {
        const rows = await ctx.db
          .query("prepareModels")
          .withIndex("by_task_version", (q) => q.eq("task", task))
          .order("desc")
          .take(HISTORY);
        const open = await roundRow(ctx, task);
        return {
          task,
          versions: rows.map(({ version, issuedAt, contributors, weights }) => ({ version, issuedAt, contributors, weights })),
          open: open ? { baseVersion: open.baseVersion, mass: open.mass, uploads: open.uploads } : null,
        };
      }),
    ),
});

// Clears every survey table, from the command line only: `npx convex run prepare:clear`.
export const clear = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let removed = 0;
    for (const table of ["prepareModels", "prepareRounds", "prepareTallies"] as const) {
      for (const row of await ctx.db.query(table).take(4000)) {
        await ctx.db.delete(table, row._id);
        removed += 1;
      }
    }
    return removed;
  },
});
