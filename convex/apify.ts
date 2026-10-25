import { v } from "convex/values";
import { MutationCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { internalMutation } from "./functions";
import { point } from "./schema";
import { insidePolygon, located, Point } from "./model";
import { simNow } from "./clock";
import { edgeKeysOf, edgesRunningAlong, streetNames } from "./roadGraph";
import { insertClosures } from "./roads";

// Evacuation zones and road closures reported by the "California evacuation status" Apify Actor (convex/http.ts).
// A zone with riders inside is applied the way the dispatcher does it: riders:setZone, then control:issueWarning.
// A full road closure on our road graph is written like any other closure, so the next plan routes around it.

const HOUSEHOLD_LIMIT = 5000;
const PRIOR_ZONE_LIMIT = 200;

const zoneArg = v.object({
  key: v.string(),
  name: v.string(),
  status: v.union(v.literal("warning"), v.literal("order")),
  rings: v.array(v.array(point)),
  drill: v.boolean(),
});

type ZoneArg = typeof zoneArg.type;
type Household = Doc<"households">;

const resultShape = v.object({
  applied: v.number(),
  duplicates: v.number(),
  noRiders: v.number(),
  ridersInside: v.number(),
  warningStarted: v.boolean(),
});

const insideAnyRing = (household: Point, rings: Point[][]) => rings.some((ring) => insidePolygon(household, ring));

function countRidersInside(households: Household[], rings: Point[][]) {
  return households.filter((household) => located(household) && insideAnyRing(household, rings)).length;
}

async function warningEpoch(ctx: MutationCtx) {
  return (await ctx.db.query("control").first())?.warningIssuedAt;
}

async function isRepeat(ctx: MutationCtx, zone: ZoneArg, epoch: number | undefined) {
  const existing = await ctx.db
    .query("apifyZones")
    .withIndex("by_key", (q) => q.eq("key", zone.key))
    .first();
  return existing !== null && existing.status === zone.status && existing.warningIssuedAt === epoch;
}

// Every ring of an applied zone stays covered, because riders:setZone marks only the latest polygon.
async function keepAppliedZonesCovered(ctx: MutationCtx, rings: Point[][]) {
  const households = await ctx.db.query("households").take(HOUSEHOLD_LIMIT);
  for (const household of households) {
    const covered = located(household) && insideAnyRing(household, rings);
    if (covered && !household.inZone) await ctx.db.patch("households", household._id, { inZone: true });
  }
}

async function ringsOfEarlierZones(ctx: MutationCtx, epoch: number | undefined, freshKeys: Set<string>) {
  const earlier = await ctx.db.query("apifyZones").take(PRIOR_ZONE_LIMIT);
  return earlier.filter((row) => row.warningIssuedAt === epoch && !freshKeys.has(row.key)).flatMap((row) => row.rings);
}

async function recordZone(ctx: MutationCtx, zone: ZoneArg, ridersInside: number, epoch: number | undefined, at: number) {
  const existing = await ctx.db
    .query("apifyZones")
    .withIndex("by_key", (q) => q.eq("key", zone.key))
    .first();
  const fields = { key: zone.key, name: zone.name, status: zone.status, rings: zone.rings, ridersInside, warningIssuedAt: epoch, receivedAt: at };
  if (existing) await ctx.db.patch("apifyZones", existing._id, fields);
  else await ctx.db.insert("apifyZones", fields);
  const label = zone.drill ? "Apify drill" : "Apify";
  await ctx.db.insert("events", { kind: "control", message: `${label}: ${zone.name} went to ${zone.status}, ${ridersInside} riders inside`, at });
}

type Candidate = { zone: ZoneArg; ridersInside: number };

async function sortZones(ctx: MutationCtx, zones: ZoneArg[], epoch: number | undefined) {
  const households = await ctx.db.query("households").take(HOUSEHOLD_LIMIT);
  const fresh: Candidate[] = [];
  let duplicates = 0;
  let noRiders = 0;
  for (const zone of zones) {
    if (await isRepeat(ctx, zone, epoch)) {
      duplicates += 1;
      continue;
    }
    const ridersInside = countRidersInside(households, zone.rings);
    if (ridersInside === 0) noRiders += 1;
    else fresh.push({ zone, ridersInside });
  }
  return { fresh, duplicates, noRiders };
}

async function startWarning(ctx: MutationCtx, before: number | undefined) {
  await ctx.runMutation(api.control.issueWarning, {});
  const after = await warningEpoch(ctx);
  return { warningStarted: before === undefined && after !== undefined, epoch: after };
}

export const applyZones = internalMutation({
  args: { zones: v.array(zoneArg) },
  returns: resultShape,
  handler: async (ctx, { zones }) => {
    const before = await warningEpoch(ctx);
    const { fresh, duplicates, noRiders } = await sortZones(ctx, zones, before);
    if (fresh.length === 0) return { applied: 0, duplicates, noRiders, ridersInside: 0, warningStarted: false };

    for (const { zone } of fresh) {
      for (const polygon of zone.rings) await ctx.runMutation(api.riders.setZone, { polygon });
    }
    const { warningStarted, epoch } = await startWarning(ctx, before);

    const freshKeys = new Set(fresh.map(({ zone }) => zone.key));
    const covered = [...fresh.flatMap(({ zone }) => zone.rings), ...(await ringsOfEarlierZones(ctx, epoch, freshKeys))];
    await keepAppliedZonesCovered(ctx, covered);

    const at = await simNow(ctx);
    for (const { zone, ridersInside } of fresh) await recordZone(ctx, zone, ridersInside, epoch, at);
    const ridersInside = countRidersInside(await ctx.db.query("households").take(HOUSEHOLD_LIMIT), covered);
    return { applied: fresh.length, duplicates, noRiders, ridersInside, warningStarted };
  },
});

const closureArg = v.union(
  v.object({ key: v.string(), name: v.string(), status: v.literal("closed"), path: v.array(point) }),
  v.object({ key: v.string(), name: v.string(), status: v.literal("lifted") }),
);

const closureResultShape = v.object({
  closed: v.number(),
  duplicates: v.number(),
  offOurRoads: v.number(),
  reopened: v.number(),
});

// The streets a lifted closure had shut, or null when it isn't one of ours.
async function reopen(ctx: MutationCtx, key: string) {
  const row = await ctx.db
    .query("roadClosures")
    .withIndex("by_sourceKey", (q) => q.eq("sourceKey", key))
    .first();
  if (!row || row.source !== "apify") return null;
  await ctx.db.delete("roadClosures", row._id);
  return row.streets ?? [];
}

const placeOf = (streets: string[], fallback: string) => (streets.length > 0 ? streets.join(", ") : fallback);

// Statewide feeds report closures far from our riders. Only one that runs along a street on our road
// graph is written; the rest are counted and dropped.
export const applyClosures = internalMutation({
  args: { closures: v.array(closureArg) },
  returns: closureResultShape,
  handler: async (ctx, { closures }) => {
    const result = { closed: 0, duplicates: 0, offOurRoads: 0, reopened: 0 };
    const at = await simNow(ctx);
    for (const closure of closures) {
      if (closure.status === "lifted") {
        const streets = await reopen(ctx, closure.key);
        if (streets === null) continue;
        result.reopened += 1;
        await ctx.db.insert("events", { kind: "control", message: `Apify: ${placeOf(streets, closure.name)} reopened`, at });
        continue;
      }
      const edges = edgesRunningAlong(closure.path);
      if (edges.length === 0) {
        result.offOurRoads += 1;
        continue;
      }
      const streets = streetNames(edges);
      const edgeKeys = edgeKeysOf(edges);
      const added = await insertClosures(ctx, [
        { path: closure.path, source: "apify", sourceKey: closure.key, edgeKeys, streets, edgeKey: edgeKeys[0], confirmed: true },
      ]);
      if (added === 0) {
        result.duplicates += 1;
        continue;
      }
      result.closed += 1;
      await ctx.db.insert("events", { kind: "control", message: `Apify: road closed on ${placeOf(streets, closure.name)}`, at });
    }
    return result;
  },
});
