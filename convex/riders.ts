import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { assistanceRequired, mobility, point } from "./schema";
import { callPriorityFor, insidePolygon, located, Point } from "./model";

// The agency's rider list. Columns, in any order:
// rider_id, name, address, lat, lng, phone, language, mobility, assistance
export const CSV_COLUMNS = ["rider_id", "name", "address", "lat", "lng", "phone", "language", "mobility", "assistance"] as const;

type Column = (typeof CSV_COLUMNS)[number];
type Row = Record<Column, string>;

const MOBILITY_VALUES = new Set<string>(mobility.members.map((m) => m.value));
const ASSISTANCE_VALUES = new Set<string>(assistanceRequired.members.map((m) => m.value));
const KNOWN_NEED_PRIOR = 0.9;
const UNKNOWN_NEED_PRIOR = 0.5;
const DEFAULT_ARRIVAL_MINUTES = 90;

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

function householdFromRow(row: Row, now: number) {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!isComplete(row, lat, lng)) return null;
  const knownMobility = mobilityOf(row);
  const needPrior = priorFor(knownMobility);
  const fireArrivalAt = now + DEFAULT_ARRIVAL_MINUTES * 60_000;
  return {
    address: row.address,
    lat,
    lng,
    callbackNumber: row.phone,
    language: row.language === "es" ? "es" : "en",
    riderId: blankToUndefined(row.rider_id),
    residentName: blankToUndefined(row.name),
    mobility: knownMobility,
    assistanceRequired: assistanceOf(row),
    callStatus: "not_called" as const,
    outcome: "unknown" as const,
    inZone: false,
    attempts: 0,
    needPrior,
    needProbability: needPrior,
    fireArrivalAt,
    callPriority: callPriorityFor(needPrior, fireArrivalAt, now),
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
    const now = Date.now();
    const skippedLines: number[] = [];
    let imported = 0;
    for (const [index, row] of parseRows(csv).entries()) {
      const household = householdFromRow(row, now);
      if (!household || (await alreadyImported(ctx, household.callbackNumber))) {
        skippedLines.push(index + 2);
        continue;
      }
      await ctx.db.insert("households", household);
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

// Rescue map: the dispatcher draws the warning zone. Returns how many riders it covers.
export const setZone = mutation({
  args: { polygon: v.array(point) },
  returns: v.number(),
  handler: async (ctx, { polygon }) => {
    if (polygon.length < 3) throw new Error("A zone needs at least three points");
    await ctx.db.insert("zones", { polygon, drawnAt: Date.now() });
    return await markZone(ctx, polygon);
  },
});

export const currentZone = query({
  args: {},
  handler: async (ctx) => await ctx.db.query("zones").order("desc").first(),
});
