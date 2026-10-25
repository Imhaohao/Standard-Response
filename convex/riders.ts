import { ConvexError, v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { assistanceRequired, mobility, point } from "./schema";
import { insidePolygon, located, Point } from "./model";
import { fileLanguageOf } from "./languages";
import { simNow } from "./clock";
import { timingForHome } from "./fireArrival";
import { isFictionalNumber } from "../lib/phone-number";

// The agency's rider list. Columns, in any order:
// rider_id, name, address, lat, lng, phone, language, mobility, assistance
export const CSV_COLUMNS = ["rider_id", "name", "address", "lat", "lng", "phone", "language", "mobility", "assistance"] as const;

type Column = (typeof CSV_COLUMNS)[number];
type Row = Record<Column, string>;

const MOBILITY_VALUES = new Set<string>(mobility.members.map((m) => m.value));
const ASSISTANCE_VALUES = new Set<string>(assistanceRequired.members.map((m) => m.value));
const KNOWN_NEED_PRIOR = 0.9;
const UNKNOWN_NEED_PRIOR = 0.5;

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseRows(csv: string): Row[] {
  const [header, ...lines] = csv.split(/\r?\n/).filter((line) => line.trim() !== "");
  const names = splitCsvLine(header ?? "");
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(CSV_COLUMNS.map((c) => [c, cells[names.indexOf(c)] ?? ""])) as Row;
  });
}

type Mobility = Doc<"households">["mobility"];
type Assistance = Doc<"households">["assistanceRequired"];

const isComplete = (row: Row, lat: number, lng: number) =>
  row.address !== "" && row.phone !== "" && Number.isFinite(lat) && Number.isFinite(lng);

const mobilityOf = (row: Row) => (MOBILITY_VALUES.has(row.mobility) ? (row.mobility as Mobility) : undefined);
const assistanceOf = (row: Row) => (ASSISTANCE_VALUES.has(row.assistance) ? (row.assistance as Assistance) : undefined);
const priorFor = (known: Mobility) => (known && known !== "walks" ? KNOWN_NEED_PRIOR : UNKNOWN_NEED_PRIOR);
const blankToUndefined = (value: string) => (value === "" ? undefined : value);

function householdFromRow(row: Row) {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!isComplete(row, lat, lng)) return null;
  const knownMobility = mobilityOf(row);
  const needPrior = priorFor(knownMobility);
  return {
    address: row.address,
    lat,
    lng,
    callbackNumber: row.phone,
    language: fileLanguageOf(row.language),
    riderId: blankToUndefined(row.rider_id),
    residentName: blankToUndefined(row.name),
    mobility: knownMobility,
    assistanceRequired: assistanceOf(row),
    callStatus: "not_called" as const,
    outcome: "unknown" as const,
    attempts: 0,
    needPrior,
    needProbability: needPrior,
    simulated: false,
  };
}

async function alreadyImported(ctx: MutationCtx, callbackNumber: string) {
  const existing = await ctx.db
    .query("households")
    .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", callbackNumber))
    .first();
  return existing !== null;
}

// Rescue map upload. Rows with a phone number already on file are skipped. Riders enter the call queue only once a zone covers them.
export const importCsv = mutation({
  args: { csv: v.string() },
  returns: v.object({ imported: v.number(), skippedLines: v.array(v.number()) }),
  handler: async (ctx, { csv }) => {
    const skippedLines: number[] = [];
    let imported = 0;
    for (const [index, row] of parseRows(csv).entries()) {
      const household = householdFromRow(row);
      if (!household || (await alreadyImported(ctx, household.callbackNumber))) {
        skippedLines.push(index + 2);
        continue;
      }
      const timing = await timingForHome(ctx, household, household.needProbability);
      await ctx.db.insert("households", { ...household, ...timing, inZone: await warningCovers(ctx, household) });
      imported += 1;
    }
    return { imported, skippedLines };
  },
});

async function markZone(ctx: MutationCtx, polygon: Point[]) {
  const households = await ctx.db.query("households").take(5000);
  let covered = 0;
  for (const household of households) {
    const inZone = located(household) && insidePolygon(household, polygon);
    if (inZone) covered += 1;
    if (inZone !== household.inZone) await ctx.db.patch("households", household._id, { inZone });
  }
  return covered;
}

// Whether the warning covers a home added now: the zone drawn last, or with none drawn, the whole
// area once the warning is out (what `coverAreaIfNoZone` gave the homes already on file).
export async function warningCovers(ctx: QueryCtx, place: Point) {
  const zone = await ctx.db.query("zones").order("desc").first();
  if (zone) return insidePolygon(place, zone.polygon);
  return (await ctx.db.query("control").first())?.warningIssuedAt !== undefined;
}

// A warning issued with no zone drawn covers the whole area, as it does for the simulated town.
// Without this, homes that signed up at /ready or came from the rider list would never be called.
export async function coverAreaIfNoZone(ctx: MutationCtx) {
  if (await ctx.db.query("zones").first()) return;
  const households = await ctx.db.query("households").take(5000);
  for (const household of households) if (!household.inZone) await ctx.db.patch("households", household._id, { inZone: true });
}

// Rescue map: the dispatcher draws the warning zone. Returns how many riders it covers.
export const setZone = mutation({
  args: { polygon: v.array(point) },
  returns: v.number(),
  handler: async (ctx, { polygon }) => {
    if (polygon.length < 3) throw new Error("A zone needs at least three points");
    await ctx.db.insert("zones", { polygon, drawnAt: await simNow(ctx) });
    return await markZone(ctx, polygon);
  },
});

export const currentZone = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("zones").order("desc").first(),
});

// "(626) 555-0142", "626-555-0142" and "+1 626 555 0142" all become "+16265550142".
export function dialableNumber(input: string) {
  const digits = input.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  if (input.trim().startsWith("+") && /^\d{8,15}$/.test(digits)) return `+${digits}`;
  throw new ConvexError("That doesn't look like a phone number");
}

// A home's call status came from calls to its old number, so it starts over for the new one.
const freshQueueEntry = { callStatus: "not_called" as const, attempts: 0, lastAttemptAt: undefined, ladder: undefined };

const PLACEHOLDER_PREFIX = "+1626555";
const FIRST_PLACEHOLDER = 9000;

async function homeFreeForNumberChange(ctx: MutationCtx, householdId: Id<"households">) {
  const household = await ctx.db.get("households", householdId);
  if (!household) throw new ConvexError("That home is gone");
  if (household.callStatus === "in_call") throw new ConvexError("Wait for the call on the line to end");
  return household;
}

async function ownerOf(ctx: QueryCtx, callbackNumber: string) {
  return await ctx.db
    .query("households")
    .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", callbackNumber))
    .first();
}

// A fictional number no home has, for a home whose real number comes off with nothing to restore.
async function unusedPlaceholder(ctx: QueryCtx) {
  for (let suffix = FIRST_PLACEHOLDER; suffix <= 9999; suffix++) {
    const number = `${PLACEHOLDER_PREFIX}${suffix}`;
    if (!(await ownerOf(ctx, number))) return number;
  }
  throw new ConvexError("No placeholder numbers are left");
}

// The only way a real number goes on a home. The voice agent dials it, and a simulated home becomes a
// real rider so the stand-in stops playing its calls. The fictional number and name it replaces are
// kept in `standIn`, so taking the real number off puts the home back as it was.
export async function putRealNumber(ctx: MutationCtx, householdId: Id<"households">, phone: string, residentName?: string) {
  const household = await homeFreeForNumberChange(ctx, householdId);
  const callbackNumber = dialableNumber(phone);
  const owner = await ownerOf(ctx, callbackNumber);
  if (owner && owner._id !== householdId) throw new ConvexError(`${owner.address} already has that number`);
  const name = residentName?.trim();
  const keepStandIn = !household.standIn && isFictionalNumber(household.callbackNumber);
  const standIn = { callbackNumber: household.callbackNumber, residentName: household.residentName, simulated: household.simulated };
  await ctx.db.patch("households", householdId, {
    callbackNumber,
    simulated: false,
    ...(name ? { residentName: name } : {}),
    ...(keepStandIn ? { standIn } : {}),
    ...(callbackNumber !== household.callbackNumber ? freshQueueEntry : {}),
  });
  return household;
}

// The only way a real number comes off a home. It gets back the fictional number and name it had;
// a home that was made for this number gets a placeholder and is simulated from then on.
export async function takeRealNumberOff(ctx: MutationCtx, householdId: Id<"households">) {
  const household = await homeFreeForNumberChange(ctx, householdId);
  if (!household.standIn && isFictionalNumber(household.callbackNumber)) return;
  const restored = household.standIn ?? { callbackNumber: await unusedPlaceholder(ctx), residentName: undefined, simulated: true };
  await ctx.db.patch("households", householdId, { ...freshQueueEntry, ...restored, standIn: undefined });
}

// Rescue map: puts a real person's number on a home.
export const setPhone = mutation({
  args: { householdId: v.id("households"), phone: v.string(), residentName: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { householdId, phone, residentName }) => {
    await putRealNumber(ctx, householdId, phone, residentName);
    return null;
  },
});

// Rescue map: takes the real number off a home and puts back what it had.
export const clearPhone = mutation({
  args: { householdId: v.id("households") },
  returns: v.null(),
  handler: async (ctx, { householdId }) => {
    await takeRealNumberOff(ctx, householdId);
    return null;
  },
});
