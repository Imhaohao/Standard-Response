import { ConvexError, v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { isFictionalNumber } from "../lib/phone-number";
import { callListKey } from "../lib/warning-call-list";
import { dialableNumber, putRealNumber, takeRealNumberOff } from "./riders";

// The team's real phones for the demo. A number goes on a house through riders.ts, the one path for
// real numbers, and remembers that house's address so it can go back after a reset.

const MAX_NUMBERS = 100;
const MAX_HOMES = 1000;

async function homeWithNumber(ctx: QueryCtx, phone: string) {
  return await ctx.db
    .query("households")
    .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", phone))
    .first();
}

async function numberRow(ctx: QueryCtx, numberId: Id<"demoNumbers">) {
  const row = await ctx.db.get("demoNumbers", numberId);
  if (!row) throw new ConvexError("That number is gone");
  return row;
}

async function takeOffItsHome(ctx: MutationCtx, row: Doc<"demoNumbers">) {
  const home = await homeWithNumber(ctx, row.phone);
  if (home) await takeRealNumberOff(ctx, home._id);
}

// Real numbers on houses that nobody has added to the list, like a house made for one person. Judges'
// numbers are left out: the kiosk owns them (convex/claims.ts) and `claims:clearAll` takes them off.
async function unlistedRealNumbers(ctx: QueryCtx, homes: Doc<"households">[], rows: Doc<"demoNumbers">[]) {
  const claims = await ctx.db.query("claims").take(MAX_HOMES);
  const managed = new Set([...rows.map((row) => row.phone), ...claims.map((claim) => claim.phone)]);
  return homes.filter((home) => !isFictionalNumber(home.callbackNumber) && !managed.has(home.callbackNumber));
}

// The phones switched on in the list: the only ones the warning, its pickup checks and its callbacks
// ring. A number added here can be called without a code change.
export async function callListOf(ctx: QueryCtx) {
  const rows = await ctx.db.query("demoNumbers").take(MAX_NUMBERS);
  return new Set(rows.filter((row) => row.paused !== true).map((row) => callListKey(row.phone)));
}

export const callList = query({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => [...(await callListOf(ctx))],
});

export const list = query({
  args: {},
  returns: v.object({
    numbers: v.array(
      v.object({
        _id: v.id("demoNumbers"),
        name: v.string(),
        phone: v.string(),
        rememberedAddress: v.optional(v.string()),
        on: v.boolean(),
        home: v.union(v.null(), v.object({ householdId: v.id("households"), address: v.string() })),
      }),
    ),
    unlistedOnHouses: v.number(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("demoNumbers").take(MAX_NUMBERS);
    const homes = await ctx.db.query("households").take(MAX_HOMES);
    const homeByPhone = new Map(homes.map((home) => [home.callbackNumber, home]));
    const numbers = rows.map((row) => {
      const home = homeByPhone.get(row.phone);
      return {
        _id: row._id,
        name: row.name,
        phone: row.phone,
        rememberedAddress: row.address,
        on: row.paused !== true,
        home: home ? { householdId: home._id, address: home.address } : null,
      };
    });
    return { numbers, unlistedOnHouses: (await unlistedRealNumbers(ctx, homes, rows)).length };
  },
});

export const add = mutation({
  args: { name: v.string(), phone: v.string() },
  returns: v.id("demoNumbers"),
  handler: async (ctx, { name, phone }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Add whose phone this is");
    const dialable = dialableNumber(phone);
    const existing = await ctx.db
      .query("demoNumbers")
      .withIndex("by_phone", (q) => q.eq("phone", dialable))
      .first();
    if (existing) throw new ConvexError(`That's ${existing.name}'s number, already in the list`);
    return await ctx.db.insert("demoNumbers", { name: trimmed, phone: dialable });
  },
});

// Adds every real number already on a house to the list, named after the resident on file.
export const addNumbersOnHouses = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("demoNumbers").take(MAX_NUMBERS);
    const homes = await ctx.db.query("households").take(MAX_HOMES);
    const unlisted = await unlistedRealNumbers(ctx, homes, rows);
    for (const home of unlisted) {
      await ctx.db.insert("demoNumbers", { name: home.residentName ?? "No name on file", phone: home.callbackNumber, address: home.address });
    }
    return unlisted.length;
  },
});

// Moves the number onto a house, taking it off the house it was on. Only a house with a fictional
// number can take it, so a real rider's number or another person's phone is never overwritten.
export const putOn = mutation({
  args: { numberId: v.id("demoNumbers"), householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, { numberId, householdId }) => {
    const row = await numberRow(ctx, numberId);
    const current = await homeWithNumber(ctx, row.phone);
    if (current?._id === householdId) return null;
    const target = await ctx.db.get("households", householdId);
    if (target && !isFictionalNumber(target.callbackNumber)) throw new ConvexError(`${target.address} already has a real number`);
    if (current) await takeRealNumberOff(ctx, current._id);
    const home = await putRealNumber(ctx, householdId, row.phone, row.name);
    await ctx.db.patch("demoNumbers", numberId, { address: home.address, paused: undefined });
    return null;
  },
});

// Off takes the number off its house so nobody calls it, and remembers the house. On puts it back there.
export const setOn = mutation({
  args: { numberId: v.id("demoNumbers"), on: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { numberId, on }) => {
    const row = await numberRow(ctx, numberId);
    if (!on) {
      await takeOffItsHome(ctx, row);
      await ctx.db.patch("demoNumbers", numberId, { paused: true });
      return null;
    }
    await putBackOnRememberedHouse(ctx, row);
    await ctx.db.patch("demoNumbers", numberId, { paused: undefined });
    return null;
  },
});

export const remove = mutation({
  args: { numberId: v.id("demoNumbers") },
  returns: v.null(),
  handler: async (ctx, { numberId }) => {
    const row = await numberRow(ctx, numberId);
    await takeOffItsHome(ctx, row);
    await ctx.db.delete("demoNumbers", numberId);
    return null;
  },
});

function takesRealNumber(home: Doc<"households"> | null): home is Doc<"households"> {
  return home !== null && isFictionalNumber(home.callbackNumber) && home.callStatus !== "in_call";
}

// The house the number remembers, or when that house is gone (another scenario's town), has another real
// phone or is on a call, the simulated home the warning would call first. A real phone always gets a house.
async function houseFor(ctx: MutationCtx, row: Doc<"demoNumbers">, homes: Doc<"households">[]) {
  const remembered = homes.filter((household) => household.address === row.address);
  const simulated = homes.filter((household) => household.simulated && household.inZone).sort((a, b) => b.callPriority - a.callPriority);
  for (const candidate of [...remembered, ...simulated]) {
    // Read again: a number put back earlier in this loop may already be on it.
    const home = await ctx.db.get("households", candidate._id);
    if (takesRealNumber(home)) return home;
  }
  return null;
}

async function putBackOne(ctx: MutationCtx, row: Doc<"demoNumbers">, homes: Doc<"households">[]) {
  if (await homeWithNumber(ctx, row.phone)) return false;
  const home = await houseFor(ctx, row, homes);
  if (!home) return false;
  await putRealNumber(ctx, home._id, row.phone, row.name);
  await ctx.db.patch("demoNumbers", row._id, { address: home.address });
  return true;
}

async function putBackOnRememberedHouse(ctx: MutationCtx, row: Doc<"demoNumbers">) {
  const homes = await ctx.db.query("households").take(MAX_HOMES);
  if (!(await homeWithNumber(ctx, row.phone)) && !(await putBackOne(ctx, row, homes))) {
    throw new ConvexError("No house is free for this number yet. Start the Ready check or a scenario to load the town");
  }
}

// After a reset clears every home: each number that's on goes back on the house it was last on, or on the
// simulated home called first when that house is gone or taken. Returns how many went back.
export const putBack = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db.query("demoNumbers").take(MAX_NUMBERS);
    const homes = await ctx.db.query("households").take(MAX_HOMES);
    let restored = 0;
    for (const row of rows) if (!row.paused && (await putBackOne(ctx, row, homes))) restored += 1;
    return restored;
  },
});
