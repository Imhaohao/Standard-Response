import { ConvexError, v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { simNow } from "./clock";
import { dialableNumber, putRealNumber, takeRealNumberOff } from "./riders";
import { isFictionalNumber } from "../lib/phone-number";
import { isFileLanguage, languageInEnglish } from "./languages";

// A dispatcher fixing a home's file from its house card. This is not a caller correcting the agent,
// so nothing goes in `households.corrections` (the voice evals count those). Numbers still change
// only through `putRealNumber` / `takeRealNumberOff`. The language is read when each call starts,
// so the next call speaks the new one.

const MAX_NAME_LENGTH = 60;

const numberKeeper = v.union(v.null(), v.object({ kind: v.literal("judge") }), v.object({ kind: v.literal("team"), name: v.string() }));
type NumberKeeper = typeof numberKeeper.type;

async function teamPhone(ctx: QueryCtx, phone: string) {
  return await ctx.db
    .query("demoNumbers")
    .withIndex("by_phone", (q) => q.eq("phone", phone))
    .first();
}

// A judge's house belongs to the kiosk (convex/claims.ts) and a team phone to Real phones
// (convex/demoNumbers.ts). Changing those numbers here would leave their lists pointing at nothing.
async function keeperOf(ctx: QueryCtx, household: Doc<"households">): Promise<NumberKeeper> {
  const claim = await ctx.db
    .query("claims")
    .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
    .first();
  if (claim) return { kind: "judge" };
  const team = await teamPhone(ctx, household.callbackNumber);
  return team ? { kind: "team", name: team.name } : null;
}

function keeperRefusal(keeper: NonNullable<NumberKeeper>) {
  if (keeper.kind === "judge") return "A judge holds this house, so its number stays until the judges' houses are cleared";
  return `This is ${keeper.name}'s phone from Real phones. Move it or switch it off there`;
}

// Taking the number off only does something when there is a real number or a stand-in to restore.
const canTakeOff = (household: Doc<"households">) => Boolean(household.standIn) || !isFictionalNumber(household.callbackNumber);

// House card: whether the number can be edited here, and whether "Take off" would do anything.
export const numberState = query({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), v.object({ keeper: numberKeeper, canTakeOff: v.boolean() })),
  handler: async (ctx, { householdId }) => {
    const household = await ctx.db.get("households", householdId);
    if (!household) return null;
    return { keeper: await keeperOf(ctx, household), canTakeOff: canTakeOff(household) };
  },
});

async function changeNumber(ctx: MutationCtx, household: Doc<"households">, phone: string | null, residentName?: string) {
  const keeper = await keeperOf(ctx, household);
  if (keeper) throw new ConvexError(keeperRefusal(keeper));
  if (phone === null) return await takeRealNumberOff(ctx, household._id);
  const callbackNumber = dialableNumber(phone);
  if (callbackNumber === household.callbackNumber) return;
  const team = await teamPhone(ctx, callbackNumber);
  if (team) throw new ConvexError(`That's ${team.name}'s phone in Real phones. Put it on a house from there`);
  await putRealNumber(ctx, household._id, callbackNumber, residentName);
}

function cleanLanguage(language: string) {
  if (!isFileLanguage(language)) throw new ConvexError("Pick a language from the list");
  return language;
}

function cleanName(residentName: string) {
  const name = residentName.trim();
  if (name.length > MAX_NAME_LENGTH) throw new ConvexError(`Keep the name under ${MAX_NAME_LENGTH} characters`);
  return name === "" ? undefined : name;
}

async function logLanguage(ctx: MutationCtx, household: Doc<"households">, language: string) {
  await ctx.db.insert("events", {
    kind: "record",
    message: `Dispatcher set ${household.address} to ${languageInEnglish(language)}`,
    householdId: household._id,
    at: await simNow(ctx),
  });
}

async function applyLanguage(ctx: MutationCtx, household: Doc<"households">, language: string | undefined) {
  if (language === undefined || language === household.language) return;
  await ctx.db.patch("households", household._id, { language: cleanLanguage(language) });
  await logLanguage(ctx, household, language);
}

async function homeOf(ctx: QueryCtx, householdId: Id<"households">) {
  const household = await ctx.db.get("households", householdId);
  if (!household) throw new ConvexError("That home is gone");
  return household;
}

// House card: save a home's name, number and language in one go. Send only what changed. `phone: null`
// takes the real number off and puts the home back as it was, so a name sent with it is ignored.
// Everything is one transaction: a refused number leaves the language and name unsaved too.
export const save = mutation({
  args: {
    householdId: v.id("households"),
    language: v.optional(v.string()),
    residentName: v.optional(v.string()),
    phone: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { householdId, language, residentName, phone }) => {
    const household = await homeOf(ctx, householdId);
    const name = residentName === undefined ? undefined : cleanName(residentName);
    if (language !== undefined) cleanLanguage(language);
    if (phone !== undefined) await changeNumber(ctx, household, phone, name);
    await applyLanguage(ctx, household, language);
    if (residentName !== undefined && phone !== null) await ctx.db.patch("households", householdId, { residentName: name });
    return null;
  },
});
