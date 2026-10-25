import { ConvexError, v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import { Doc, Id } from "./_generated/dataModel";
import { assistanceRequired, canLeave, medicalNeed, mobility } from "./schema";
import { located, outcomeFor } from "./model";
import { openRequestsFor } from "./requests";
import { dialableNumber, putRealNumber, takeRealNumberOff } from "./riders";
import { isFictionalNumber } from "../lib/phone-number";
import { demoProfileFor } from "../lib/demo-profile";
import { pairSmallDemo } from "./demoNeighbors";
import { simNow } from "./clock";
import { fellThrough } from "./pickups";

// The judges' kiosk at `/`. A judge signs in with their own phone number (typed on the big screen,
// or sent from their phone through the QR code at /join), picks a demo house nobody has taken, and
// describes who lives there. A demo house is one with a fictional 555 number: the seeded town and the
// sample rider list. The number goes on the house through riders.ts, the one path for real numbers,
// so the house becomes `simulated: false` and the real voice agent will dial it when a call is due.
// Nothing here places a call. `clearAll` takes every judge's number back off.

const SESSION_TTL_MS = 20 * 60_000;
const SIGN_IN_WINDOW_MS = 10 * 60_000;
const SIGN_INS_PER_WINDOW = 120;
const PHONE_TRIES_PER_SESSION = 6;
const MAX_CLAIMS = 80;
const MAX_CODE_LENGTH = 32;
const MAX_PHONE_LENGTH = 32;
const MAX_NAME_LENGTH = 60;
const MAX_PEOPLE = 12;
const CODE_LENGTH = 10;
// The phone's status link outlives the sign-in, so it gets its own longer key (about 119 bits).
const STATUS_TOKEN_LENGTH = 24;
// No 0, 1, i, l or o, so a code read aloud or typed off the screen can't be misread.
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const KIOSK_LANGUAGES = new Set(["en", "es"]);

const EXPIRED = "This sign-in expired. Scan the new code on the big screen.";

export const claimRecord = v.object({
  residentName: v.string(),
  language: v.string(),
  canLeave,
  peopleCount: v.number(),
  mobility,
  assistanceRequired,
  medical: v.array(medicalNeed),
  pets: v.boolean(),
  hasCar: v.boolean(),
});
type ClaimRecord = typeof claimRecord.type;

function newCode(length = CODE_LENGTH) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

const isExpired = (session: Doc<"kioskSessions">, now: number) => now - session.createdAt > SESSION_TTL_MS;

async function sessionByCode(ctx: QueryCtx, code: string) {
  if (code.length === 0 || code.length > MAX_CODE_LENGTH) return null;
  return await ctx.db
    .query("kioskSessions")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

async function openSession(ctx: QueryCtx, code: string) {
  const session = await sessionByCode(ctx, code);
  if (!session || isExpired(session, Date.now())) throw new ConvexError(EXPIRED);
  if (session.householdId) throw new ConvexError("This sign-in already took a house. Scan the new code on the big screen.");
  return session;
}

async function removeExpiredSessions(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query("kioskSessions")
    .withIndex("by_createdAt", (q) => q.lt("createdAt", now - SESSION_TTL_MS))
    .take(25);
  for (const session of expired) await ctx.db.delete("kioskSessions", session._id);
}

// The big screen opens a sign-in and shows its code as a QR.
export const startKiosk = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const now = Date.now();
    await removeExpiredSessions(ctx, now);
    const recent = await ctx.db
      .query("kioskSessions")
      .withIndex("by_createdAt", (q) => q.gt("createdAt", now - SIGN_IN_WINDOW_MS))
      .take(SIGN_INS_PER_WINDOW + 1);
    if (recent.length > SIGN_INS_PER_WINDOW) throw new ConvexError("Too many sign-ins right now. Try again in a few minutes.");
    const code = newCode();
    await ctx.db.insert("kioskSessions", { code, createdAt: now, phoneSubmissions: 0 });
    return code;
  },
});

// Both screens watch this: the kiosk to move on once a number arrives, the phone to say which house
// its owner took. Only the last four digits ever leave the server.
export const session = query({
  args: { code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      expired: v.boolean(),
      phoneEnding: v.union(v.null(), v.string()),
      claimedAddress: v.union(v.null(), v.string()),
      // Where the phone follows the claimed house once the sign-in is gone (convex/claimStatus.ts).
      statusToken: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx, { code }) => {
    const found = await sessionByCode(ctx, code);
    if (!found) return null;
    const home = found.householdId ? await ctx.db.get("households", found.householdId) : null;
    return {
      expired: isExpired(found, Date.now()),
      phoneEnding: found.phone ? found.phone.slice(-4) : null,
      claimedAddress: home?.address ?? null,
      statusToken: home ? await statusTokenFor(ctx, home._id, found.phone) : null,
    };
  },
});

async function statusTokenFor(ctx: QueryCtx, householdId: Id<"households">, phone: string | undefined) {
  const claim = await ctx.db
    .query("claims")
    .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
    .first();
  return claim && claim.phone === phone ? (claim.statusToken ?? null) : null;
}

async function numberAlreadyHasHome(ctx: QueryCtx, phone: string) {
  const owner = await ctx.db
    .query("households")
    .withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", phone))
    .first();
  return owner !== null;
}

// From the judge's phone (/join) or the kiosk's own form. A US number without a country code gets +1.
export const submitPhone = mutation({
  args: { code: v.string(), phone: v.string() },
  returns: v.object({ phoneEnding: v.string() }),
  handler: async (ctx, { code, phone }) => {
    if (phone.length > MAX_PHONE_LENGTH) throw new ConvexError("That doesn't look like a phone number");
    const found = await openSession(ctx, code);
    if (found.phoneSubmissions >= PHONE_TRIES_PER_SESSION) throw new ConvexError("Too many tries on this code. Scan the new code on the big screen.");
    const dialable = dialableNumber(phone);
    if (await numberAlreadyHasHome(ctx, dialable)) throw new ConvexError("That number already has a house on the map. Each phone takes one.");
    await ctx.db.patch("kioskSessions", found._id, { phone: dialable, phoneSubmissions: found.phoneSubmissions + 1 });
    return { phoneEnding: dialable.slice(-4) };
  },
});

type HomeState = "open" | "busy" | "taken";

// A house with a fictional number loses nothing when a judge's number replaces it. One on a call
// right now waits until the call ends.
const isDemoHouse = (home: Doc<"households">) => isFictionalNumber(home.callbackNumber);

function stateOf(home: Doc<"households">, claimed: Set<Id<"households">>): HomeState {
  if (claimed.has(home._id)) return "taken";
  return home.callStatus === "in_call" ? "busy" : "open";
}

async function claimedHouseholdIds(ctx: QueryCtx) {
  const claims = await ctx.db.query("claims").take(MAX_CLAIMS * 2);
  return new Set(claims.map((claim) => claim.householdId));
}

// The kiosk map: every demo house and judge's house, and whether a judge may take it. Houses with
// anyone else's real number are left out, so they never show on a public screen.
export const homes = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("households"),
      lat: v.number(),
      lng: v.number(),
      state: v.union(v.literal("open"), v.literal("busy"), v.literal("taken")),
      address: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx) => {
    const claimed = await claimedHouseholdIds(ctx);
    const households = await ctx.db.query("households").take(2000);
    const shown = households.filter((home) => located(home) && (isDemoHouse(home) || claimed.has(home._id)));
    return shown.filter(located).map((home) => {
      const state = stateOf(home, claimed);
      return { _id: home._id, lat: home.lat, lng: home.lng, state, address: state === "open" ? home.address : null };
    });
  },
});

// Registration order supplies the fictional role. The judge supplies the name
// and can change the language before taking the house.
export const draft = query({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), v.object({ address: v.string(), record: claimRecord, position: v.number() })),
  handler: async (ctx, { householdId }) => {
    const home = await ctx.db.get("households", householdId);
    if (!home || !isDemoHouse(home)) return null;
    const position = (await ctx.db.query("claims").take(MAX_CLAIMS)).length;
    const language = KIOSK_LANGUAGES.has(home.language) ? home.language : "en";
    return { address: home.address, record: { ...demoProfileFor(position), residentName: "", language }, position };
  },
});

function cleanRecord(record: ClaimRecord): ClaimRecord {
  const residentName = record.residentName.trim();
  if (residentName.length === 0) throw new ConvexError("Add the resident's name");
  if (residentName.length > MAX_NAME_LENGTH) throw new ConvexError("That name is too long");
  if (!KIOSK_LANGUAGES.has(record.language)) throw new ConvexError("Pick English or Spanish");
  if (!Number.isInteger(record.peopleCount) || record.peopleCount < 1 || record.peopleCount > MAX_PEOPLE) {
    throw new ConvexError(`People at home must be 1 to ${MAX_PEOPLE}`);
  }
  return { ...record, residentName, medical: [...new Set(record.medical)] };
}

async function takeableHome(ctx: QueryCtx, householdId: Id<"households">) {
  const home = await ctx.db.get("households", householdId);
  if (!home || !isDemoHouse(home) || !located(home)) throw new ConvexError("That house isn't open. Pick another.");
  if (home.callStatus === "in_call") throw new ConvexError("Our agent is on a call with that house. Pick another.");
  const claim = await ctx.db
    .query("claims")
    .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
    .first();
  if (claim) throw new ConvexError("Another judge just took that house. Pick another.");
  if ((await openRequestsFor(ctx, householdId)).length > 0) throw new ConvexError("That house already has a ride request. Pick another.");
  return home;
}

// The fields a claim changes, each named, so one a house didn't have comes back as removed (Convex
// stores a missing field as absent, and a patch only removes the keys it names).
const editableFields = (source: Doc<"claims">["record"] | Doc<"households">): Doc<"claims">["record"] => ({
  language: source.language,
  canLeave: source.canLeave,
  peopleCount: source.peopleCount,
  mobility: source.mobility,
  assistanceRequired: source.assistanceRequired,
  medical: source.medical,
  pets: source.pets,
  hasCar: source.hasCar,
  outcome: source.outcome,
  ready: source.ready,
  helperDeclinedAt: source.helperDeclinedAt,
});

// The judge takes the house. Convex runs every check and write here in one transaction, so two
// judges picking the same house at once can't both get it: the second one is told to pick another.
export const claim = mutation({
  args: { code: v.string(), householdId: v.id("households"), record: claimRecord, position: v.optional(v.number()) },
  returns: v.object({ address: v.string() }),
  handler: async (ctx, { code, householdId, record, position: expectedPosition }) => {
    const cleaned = cleanRecord(record);
    const found = await openSession(ctx, code);
    if (!found.phone) throw new ConvexError("Add your phone number first");
    const position = (await ctx.db.query("claims").take(MAX_CLAIMS)).length;
    if (position >= MAX_CLAIMS) throw new ConvexError("Every demo house is taken for now.");
    if (expectedPosition !== undefined && expectedPosition !== position) throw new ConvexError("Another person registered. Review the updated demo role and try again.");
    const answers = { ...cleaned, ...demoProfileFor(position) };
    const home = await takeableHome(ctx, householdId);
    await putRealNumber(ctx, householdId, found.phone, answers.residentName);
    const { residentName, ...fields } = answers;
    const outcome = outcomeFor({ ...fields, callStatus: "not_called", away: undefined });
    // The judge's resident is home: an earlier "nobody's home" belonged to the demo resident.
    await ctx.db.patch("households", householdId, {
      residentName, ...fields, outcome, away: undefined, helperDeclinedAt: undefined,
      ready: {
        at: await simNow(ctx), via: "form", verified: false, care: [],
        exitPlan: answers.hasCar ? "own_car" : "needs_ride",
        note: answers.hasCar ? "Demo profile: has a van and can help a neighbor." : "Demo profile: bedridden and needs a helper.",
      },
    });
    const now = Date.now();
    await ctx.db.insert("claims", { householdId, phone: found.phone, claimedAt: now, statusToken: newCode(STATUS_TOKEN_LENGTH), record: editableFields(home) });
    await ctx.db.patch("kioskSessions", found._id, { householdId, claimedAt: now });
    await pairSmallDemo(ctx);
    return { address: home.address };
  },
});

async function releaseClaim(ctx: MutationCtx, claim: Doc<"claims">) {
  const home = await ctx.db.get("households", claim.householdId);
  const stillTheJudges = home !== null && home.callbackNumber === claim.phone;
  if (stillTheJudges && home.callStatus === "in_call") return false;
  if (stillTheJudges) {
    await takeRealNumberOff(ctx, home._id);
    await ctx.db.patch("households", home._id, editableFields(claim.record));
  }
  await ctx.db.delete("claims", claim._id);
  await releasePairings(ctx, claim.householdId);
  await pairSmallDemo(ctx);
  return true;
}

async function releasePairings(ctx: MutationCtx, householdId: Id<"households">) {
  for (const status of ["arranged", "checking", "coming"] as const) {
    const plans = await ctx.db.query("pickupPlans").withIndex("by_status", (q) => q.eq("status", status)).take(500);
    for (const plan of plans) {
      if (!plan.recruited || (plan.householdId !== householdId && plan.helperHouseholdId !== householdId)) continue;
      if (plan.status === "arranged") await ctx.db.delete("pickupPlans", plan._id);
      else await fellThrough(ctx, plan, plan.householdId === householdId ? "not_needed" : "helper_declined");
    }
  }
}

// After the event, or between demo rounds: every judge's number comes off its house, the house goes
// back to the demo resident it had, and the kiosk sign-ins holding numbers are deleted. A house on a
// live call is skipped; run it again once the call ends.
export const clearAll = mutation({
  args: {},
  returns: v.object({ cleared: v.number(), skippedOnCall: v.number() }),
  handler: async (ctx) => {
    let cleared = 0;
    let skippedOnCall = 0;
    for (const claim of await ctx.db.query("claims").take(MAX_CLAIMS * 2)) {
      if (await releaseClaim(ctx, claim)) cleared += 1;
      else skippedOnCall += 1;
    }
    for (const kiosk of await ctx.db.query("kioskSessions").take(500)) await ctx.db.delete("kioskSessions", kiosk._id);
    return { cleared, skippedOnCall };
  },
});

// One judge's house back, without touching anyone else's (clearAll gives back every house):
// `npx convex run claims:releaseHouse '{"householdId": "..."}'`. A house on a live call is skipped.
export const releaseHouse = internalMutation({
  args: { householdId: v.id("households") },
  returns: v.object({ released: v.boolean() }),
  handler: async (ctx, { householdId }) => {
    const claim = await ctx.db
      .query("claims")
      .withIndex("by_householdId", (q) => q.eq("householdId", householdId))
      .first();
    if (!claim || !(await releaseClaim(ctx, claim))) return { released: false };
    for (const kiosk of await ctx.db.query("kioskSessions").take(500)) {
      if (kiosk.householdId === householdId) await ctx.db.delete("kioskSessions", kiosk._id);
    }
    return { released: true };
  },
});
