import { v } from "convex/values";
import { query, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { callPriorityFor, insidePolygon } from "./model";
import { simNow } from "./clock";
import { escalateHousehold } from "./requests";
import { nameOnFile } from "../lib/name-on-file";

// Voice agent: "Is there anyone else on your street who might not be able to leave?" A neighbor
// named without an address ("Boris is bedridden") is matched to the one home on file with that
// name. `danger` (they're dying, can't breathe) escalates that home; with no home to escalate, the
// nomination goes on the dispatcher's flagged list near the caller's address.
export const add = mutation({
  args: { fromHouseholdId: v.optional(v.id("households")), spokenAddress: v.string(), danger: v.optional(v.boolean()) },
  returns: v.id("nominations"),
  handler: async (ctx, { danger, ...args }) => {
    const at = await simNow(ctx);
    const named = await householdNamed(ctx, args.spokenAddress, args.fromHouseholdId);
    if (named) return await addMatchedByName(ctx, { ...args, at }, named, danger === true);
    if (danger) return await addUrgentUnplaced(ctx, { ...args, at });
    return await ctx.db.insert("nominations", { ...args, status: "open", at });
  },
});

type NewNomination = { fromHouseholdId?: Id<"households">; spokenAddress: string; at: number };

async function householdNamed(ctx: MutationCtx, spoken: string, callerId?: Id<"households">) {
  const others = (await ctx.db.query("households").take(5000)).filter((h) => h.residentName && h._id !== callerId);
  const name = nameOnFile(spoken, others.map((h) => h.residentName ?? ""));
  return name ? others.find((h) => h.residentName === name) : undefined;
}

async function addMatchedByName(ctx: MutationCtx, nomination: NewNomination, household: Doc<"households">, danger: boolean) {
  const id = await ctx.db.insert("nominations", { ...nomination, status: "matched", matchedHouseholdId: household._id, note: "matched by name" });
  await logMatch(ctx, `Neighbor report "${nomination.spokenAddress}" matched by name to ${household.address}`, household._id);
  if (danger) await escalateHousehold(ctx, household._id, "medical");
  return id;
}

async function addUrgentUnplaced(ctx: MutationCtx, nomination: NewNomination) {
  const caller = nomination.fromHouseholdId ? await ctx.db.get("households", nomination.fromHouseholdId) : null;
  const note = `in danger now${caller ? `, near ${caller.address}` : ""}`;
  const id = await ctx.db.insert("nominations", { ...nomination, status: "unmatched", note });
  await ctx.db.insert("events", { kind: "dispatch", message: `Urgent neighbor report "${nomination.spokenAddress}": ${note}`, householdId: caller?._id, at: nomination.at });
  return id;
}

export const open = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("nominations").withIndex("by_status", (q) => q.eq("status", "open")).take(200),
});

// Nominations address matching couldn't place, with the reason. They stay on the dispatcher's list.
export const flagged = query({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query("nominations").withIndex("by_status", (q) => q.eq("status", "unmatched")).take(200),
});

async function logMatch(ctx: MutationCtx, message: string, householdId?: Id<"households">) {
  await ctx.db.insert("events", { kind: "model", message, householdId, at: await simNow(ctx) });
}

// Address matching matched the spoken address to a household, or couldn't (say why in `note`).
export const resolve = mutation({
  args: {
    nominationId: v.id("nominations"),
    matchedHouseholdId: v.optional(v.id("households")),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { nominationId, matchedHouseholdId, note }) => {
    const nomination = await ctx.db.get("nominations", nominationId);
    if (!nomination) throw new Error(`Nomination ${nominationId} not found`);
    await ctx.db.patch("nominations", nominationId, {
      status: matchedHouseholdId ? "matched" : "unmatched",
      matchedHouseholdId,
      note,
    });
    await logMatch(
      ctx,
      matchedHouseholdId
        ? `Neighbor report "${nomination.spokenAddress}" matched to a known home`
        : `Neighbor report "${nomination.spokenAddress}" needs a dispatcher: ${note ?? "no match"}`,
      matchedHouseholdId,
    );
    return null;
  },
});

const NOMINATED_NEED_PRIOR_FLOOR = 0.05;

// Address matching matched a nomination to a real address point that isn't on the rider list yet. Finds the
// household at that address or adds one. It has no phone, so it goes straight to the door-check list.
export const matchAddress = mutation({
  args: {
    nominationId: v.id("nominations"),
    address: v.string(),
    lat: v.number(),
    lng: v.number(),
    // Census base rate for the block group, before the nomination raises it.
    needPrior: v.number(),
    needProbability: v.number(),
    fireArrivalAt: v.number(),
  },
  returns: v.id("households"),
  handler: async (ctx, { nominationId, address, lat, lng, needPrior, needProbability, fireArrivalAt }) => {
    const nomination = await ctx.db.get("nominations", nominationId);
    if (!nomination) throw new Error(`Nomination ${nominationId} not found`);
    const existing = (await ctx.db.query("households").take(5000)).find((h) => h.address === address);
    const zone = await ctx.db.query("zones").order("desc").first();
    const householdId =
      existing?._id ??
      (await ctx.db.insert("households", {
        address,
        lat,
        lng,
        callbackNumber: "",
        language: "en",
        callStatus: "door_check",
        outcome: "unreachable",
        inZone: zone ? insidePolygon({ lat, lng }, zone.polygon) : true,
        attempts: 0,
        needPrior: Math.max(needPrior, NOMINATED_NEED_PRIOR_FLOOR),
        needProbability,
        fireArrivalAt,
        callPriority: callPriorityFor(needProbability, fireArrivalAt, await simNow(ctx)),
        simulated: false,
      }));
    await ctx.db.patch("nominations", nominationId, { status: "matched", matchedHouseholdId: householdId, note: undefined });
    await logMatch(
      ctx,
      existing
        ? `Neighbor report "${nomination.spokenAddress}" matched to ${address}`
        : `Neighbor report "${nomination.spokenAddress}" placed at ${address}, not on the rider list. Added to door checks`,
      householdId,
    );
    return householdId;
  },
});
