import { v } from "convex/values";
import { MutationCtx, query, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { DEFAULT_TRAINING, GlobalModel, INITIAL_MODEL, isValidMix, Mix, UPLOAD_MIN_MASS } from "../lib/mesh/federated";
import { coarsenTime, consensusOf, isValidReport, REPORT_TTL_MS, RoadReport } from "../lib/mesh/reports";
import { addToRound, closeRound, emptyRound, freshOptimizerState, OpenRound, roundIsReady } from "../lib/mesh/rounds";
import { trafficForecastFields } from "./schema";
import { currentTrafficForecast } from "./traffic";

// Mesh add-on: what phones upload when one of them has internet, and what the agency reads back.
// Uploads carry no phone or person id. Road reports are kept as sent (with their random report id,
// so the same report relayed by two gateways counts once). Model updates arrive only as mixes of at
// least UPLOAD_MIN_MASS phones' worth of noised updates; this file refuses anything smaller.
// The core flow reads only the traffic forecast: the dispatcher's drive times (convex/traffic.ts).

const MAX_REPORTS_PER_UPLOAD = 400;
const MAX_MIXES_PER_UPLOAD = 8;
const READ_LIMIT = 8000;
const FORECASTS_KEPT = 3;
const MAX_FORECAST_WINDOWS = 6;
const MAX_FORECAST_POINTS = 40;
const MAX_FORECAST_ROWS = 400;

const reportArg = v.object({
  id: v.string(),
  segment: v.string(),
  status: v.union(v.literal("blocked"), v.literal("clear")),
  cause: v.optional(v.string()),
  observedAt: v.number(),
  hops: v.number(),
});

const mixArg = v.object({ version: v.number(), sum: v.array(v.number()), mass: v.number() });

const modelShape = v.object({ version: v.number(), weights: v.array(v.number()), issuedAt: v.number(), contributors: v.number() });

export const uploadReports = mutation({
  args: { reports: v.array(reportArg) },
  returns: v.object({ added: v.number(), refused: v.number() }),
  handler: async (ctx, { reports }) => {
    const now = Date.now();
    let added = 0;
    let refused = 0;
    for (const report of reports.slice(0, MAX_REPORTS_PER_UPLOAD)) {
      if (!isValidReport(report, now)) {
        refused += 1;
        continue;
      }
      const existing = await ctx.db
        .query("meshReports")
        .withIndex("by_reportId", (q) => q.eq("reportId", report.id))
        .first();
      if (existing) continue;
      await ctx.db.insert("meshReports", {
        reportId: report.id,
        segment: report.segment,
        status: report.status,
        cause: report.cause,
        observedAt: report.observedAt,
        hops: report.hops,
        receivedAt: coarsenTime(now),
      });
      added += 1;
    }
    return { added, refused: refused + Math.max(0, reports.length - MAX_REPORTS_PER_UPLOAD) };
  },
});

async function latestModelRow(ctx: QueryCtx) {
  return await ctx.db.query("meshModels").withIndex("by_version").order("desc").first();
}

const publicModel = (row: { version: number; weights: number[]; issuedAt: number; contributors: number } | null): GlobalModel =>
  row ? { version: row.version, weights: row.weights, issuedAt: row.issuedAt, contributors: row.contributors } : INITIAL_MODEL;

async function openRound(ctx: MutationCtx, baseVersion: number) {
  const row = await ctx.db.query("meshRound").first();
  if (row) return row;
  const id = await ctx.db.insert("meshRound", { ...emptyRound(baseVersion), refused: 0 });
  return (await ctx.db.get("meshRound", id))!;
}

// Adds each accepted mix to the open round; a full round becomes the next model version.
export const uploadMixes = mutation({
  args: { mixes: v.array(mixArg) },
  returns: v.object({ accepted: v.number(), refused: v.number(), model: modelShape }),
  handler: async (ctx, { mixes }) => {
    const latest = await latestModelRow(ctx);
    let model = publicModel(latest);
    let optimizer = latest ? { first: latest.first, second: latest.second } : freshOptimizerState();
    const row = await openRound(ctx, model.version);
    let round: OpenRound = { baseVersion: row.baseVersion, sum: row.sum, mass: row.mass, uploads: row.uploads, staleMass: row.staleMass };
    let accepted = 0;
    let refused = 0;
    for (const mix of mixes.slice(0, MAX_MIXES_PER_UPLOAD) as Mix[]) {
      const next = isValidMix(mix, DEFAULT_TRAINING) && mix.mass >= UPLOAD_MIN_MASS ? addToRound(round, mix) : null;
      if (!next) {
        refused += 1;
        continue;
      }
      round = next;
      accepted += 1;
      if (!roundIsReady(round)) continue;
      const result = closeRound(model, round, Date.now(), optimizer);
      await ctx.db.insert("meshModels", {
        ...result.model,
        ...result.state,
        round: { mass: round.mass, uploads: round.uploads, staleMass: round.staleMass },
      });
      model = result.model;
      optimizer = result.state;
      round = emptyRound(model.version);
    }
    await ctx.db.patch("meshRound", row._id, { ...round, refused: row.refused + refused });
    return { accepted, refused, model };
  },
});

export const model = query({
  args: {},
  returns: modelShape,
  handler: async (ctx) => publicModel(await latestModelRow(ctx)),
});

const consensusShape = v.object({
  segment: v.string(),
  status: v.union(v.literal("blocked"), v.literal("clear"), v.literal("unknown")),
  blockedWeight: v.number(),
  clearWeight: v.number(),
  reports: v.number(),
  lastObservedAt: v.number(),
  causes: v.array(v.string()),
});

// What the agency knows street by street from the mesh. `now` is passed (rounded to the minute) so
// the time-decayed vote updates while the page is open.
export const roads = query({
  args: { now: v.number() },
  returns: v.object({ segments: v.array(consensusShape), reports: v.number(), relayed: v.number() }),
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("meshReports")
      .withIndex("by_observedAt", (q) => q.gte("observedAt", now - REPORT_TTL_MS))
      .order("desc")
      .take(READ_LIMIT);
    const bySegment = new Map<string, RoadReport[]>();
    for (const row of rows) {
      const report = { id: row.reportId, segment: row.segment, status: row.status, observedAt: row.observedAt, hops: row.hops } as RoadReport;
      if (row.cause) report.cause = row.cause as RoadReport["cause"];
      bySegment.set(row.segment, [...(bySegment.get(row.segment) ?? []), report]);
    }
    const segments = [...bySegment].map(([segment, reports]) => consensusOf(segment, reports, now));
    return { segments, reports: rows.length, relayed: rows.filter((row) => row.hops > 0).length };
  },
});

export const rounds = query({
  args: {},
  returns: v.object({
    models: v.array(
      v.object({
        version: v.number(),
        issuedAt: v.number(),
        contributors: v.number(),
        weights: v.array(v.number()),
        round: v.optional(v.object({ mass: v.number(), uploads: v.number(), staleMass: v.number() })),
      }),
    ),
    open: v.union(v.null(), v.object({ baseVersion: v.number(), mass: v.number(), uploads: v.number(), refused: v.number() })),
  }),
  handler: async (ctx) => {
    const models = await ctx.db.query("meshModels").withIndex("by_version").order("desc").take(50);
    const open = await ctx.db.query("meshRound").first();
    return {
      models: models.map(({ version, issuedAt, contributors, weights, round }) => ({ version, issuedAt, contributors, weights, round })),
      open: open ? { baseVersion: open.baseVersion, mass: open.mass, uploads: open.uploads, refused: open.refused } : null,
    };
  },
});

// Written by the traffic forecast runner. Keeps the last few forecasts and drops older ones.
export const publishTrafficForecast = mutation({
  args: trafficForecastFields,
  returns: v.null(),
  handler: async (ctx, forecast) => {
    const sizes = forecast.windows.map((w) => w.segments.length + w.streets.length + (w.edges?.length ?? 0));
    if (forecast.windows.length > MAX_FORECAST_WINDOWS || forecast.timeline.length > MAX_FORECAST_POINTS || sizes.some((n) => n > MAX_FORECAST_ROWS)) {
      throw new Error("traffic forecast too large");
    }
    await ctx.db.insert("meshTrafficForecasts", forecast);
    const older = await ctx.db.query("meshTrafficForecasts").withIndex("by_issuedAt").order("desc").take(FORECASTS_KEPT + 10);
    for (const row of older.slice(FORECASTS_KEPT)) await ctx.db.delete("meshTrafficForecasts", row._id);
    return null;
  },
});

// The agency view: the newest forecast for the current incident, or null.
export const trafficForecast = query({
  args: {},
  handler: async (ctx) => await currentTrafficForecast(ctx),
});

// Clears every mesh table, from the command line only: `npx convex run mesh:clear`.
export const clear = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let removed = 0;
    for (const table of ["meshReports", "meshModels", "meshRound", "meshTrafficForecasts"] as const) {
      for (const row of await ctx.db.query(table).take(READ_LIMIT)) {
        await ctx.db.delete(table, row._id);
        removed += 1;
      }
    }
    return removed;
  },
});
