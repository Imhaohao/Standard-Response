import { v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { callStatus } from "./schema";
import { openRequestFor } from "./requests";
import { hazardReaches } from "./fireArrival";
import { DEFAULT_HAZARD } from "./hazards";
import { firstName, HouseFacts, HouseOut, RideState } from "../lib/claim-stage";

// The judge's phone at /you/<token> follows the house they took on the kiosk (convex/claims.ts) for
// the rest of the night. The token is the only key: whoever holds it sees this one house's address,
// the resident the judge described, where the night stands for them, and a driver's first name. Never
// a phone number, never another home. lib/claim-stage.ts turns these facts into what the phone shows.

const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 64;
const MAX_REQUESTS = 20;

const houseOut = v.object({
  how: v.union(v.literal("ride"), v.literal("neighbor"), v.literal("self")),
  at: v.number(),
  byFirstName: v.union(v.null(), v.string()),
});

const rideState = v.union(
  v.object({ state: v.literal("none") }),
  v.object({ state: v.literal("requested") }),
  v.object({
    state: v.literal("coming"),
    by: v.union(v.literal("driver"), v.literal("neighbor")),
    byFirstName: v.union(v.null(), v.string()),
    etaAt: v.union(v.null(), v.number()),
  }),
);

const houseFacts = v.object({
  address: v.string(),
  residentName: v.union(v.null(), v.string()),
  warningIssued: v.boolean(),
  inZone: v.boolean(),
  callStatus,
  away: v.boolean(),
  fireArrivalAt: v.number(),
  fireReaches: v.boolean(),
  out: v.union(v.null(), houseOut),
  ride: rideState,
});

const simClock = v.object({ speed: v.number(), realAt: v.number(), simAt: v.number(), ranMs: v.number() });

async function claimByToken(ctx: QueryCtx, token: string) {
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  return await ctx.db
    .query("claims")
    .withIndex("by_statusToken", (q) => q.eq("statusToken", token))
    .unique();
}

// The house is still this judge's only while their number is on it: clearAll, a reset, or the number
// coming off for any other reason hands it back.
async function claimedHome(ctx: QueryCtx, token: string) {
  const claim = await claimByToken(ctx, token);
  if (!claim) return null;
  const home = await ctx.db.get("households", claim.householdId);
  return home && home.callbackNumber === claim.phone ? { home, claimedAt: claim.claimedAt } : null;
}

// Rides, neighbors and calls from before the claim belong to the demo resident the house had, not to
// the judge's. Creation times and claimedAt are both wall clock.
type Since = { claimedAt: number };
const sinceClaim = ({ claimedAt }: Since) => (row: { _creationTime: number }) => row._creationTime >= claimedAt;

async function completedAssignment(ctx: QueryCtx, request: Doc<"requests">) {
  return await ctx.db
    .query("assignments")
    .withIndex("by_requestId_and_status", (q) => q.eq("requestId", request._id).eq("status", "completed"))
    .first();
}

const STILL_WAITING = new Set<Doc<"requests">["status"]>(["received", "approved", "driver_accepted", "en_route", "reassigning"]);

// Out by van once every party that boarded has boarded and none is still waiting, at the last boarding.
async function boardedVan(ctx: QueryCtx, home: Doc<"households">, since: Since): Promise<HouseOut | null> {
  const requests = (
    await ctx.db
      .query("requests")
      .withIndex("by_householdId", (q) => q.eq("householdId", home._id))
      .order("desc")
      .take(MAX_REQUESTS)
  ).filter(sinceClaim(since));
  if (requests.some((request) => STILL_WAITING.has(request.status))) return null;
  let out: HouseOut | null = null;
  for (const request of requests) {
    const assignment = await completedAssignment(ctx, request);
    if (!assignment) continue;
    const at = assignment.completedAt ?? request.updatedAt;
    if (out && out.at >= at) continue;
    const vehicle = await ctx.db.get("vehicles", assignment.vehicleId);
    out = { how: "ride", at, byFirstName: firstName(vehicle?.driverName) };
  }
  return out;
}

async function pickupPlansFor(ctx: QueryCtx, home: Doc<"households">, since: Since) {
  const plans = await ctx.db
    .query("pickupPlans")
    .withIndex("by_householdId", (q) => q.eq("householdId", home._id))
    .take(10);
  return plans.filter(sinceClaim(since));
}

async function leftWithNeighbor(ctx: QueryCtx, home: Doc<"households">, since: Since): Promise<HouseOut | null> {
  const done = (await pickupPlansFor(ctx, home, since)).find((plan) => plan.status === "done");
  return done ? { how: "neighbor", at: done.updatedAt, byFirstName: firstName(done.helperName) } : null;
}

// The household said on its warning call that it is driving out. The call's end is when we knew.
async function droveOut(ctx: QueryCtx, home: Doc<"households">, since: Since, warningIssuedAt: number): Promise<HouseOut | null> {
  if (home.callStatus !== "complete" || home.outcome !== "leaving") return null;
  const calls = await ctx.db
    .query("calls")
    .withIndex("by_householdId", (q) => q.eq("householdId", home._id))
    .order("desc")
    .take(10);
  const warningCall = calls.filter(sinceClaim(since)).find((call) => !call.flow && call.phase === "ended" && call.endedAt !== undefined);
  return { how: "self", at: warningCall?.endedAt ?? home.lastAttemptAt ?? warningIssuedAt, byFirstName: null };
}

async function howOut(ctx: QueryCtx, home: Doc<"households">, since: Since, warningIssuedAt: number) {
  return (await boardedVan(ctx, home, since)) ?? (await leftWithNeighbor(ctx, home, since)) ?? (await droveOut(ctx, home, since, warningIssuedAt));
}

async function driverComing(ctx: QueryCtx, request: Doc<"requests">): Promise<RideState> {
  const assignment = await ctx.db
    .query("assignments")
    .withIndex("by_requestId_and_status", (q) => q.eq("requestId", request._id).eq("status", "accepted"))
    .first();
  const vehicle = assignment ? await ctx.db.get("vehicles", assignment.vehicleId) : null;
  const etaFrom = assignment ? (assignment.etaUpdatedAt ?? assignment.respondedAt ?? assignment.proposedAt) : null;
  const etaAt = assignment && etaFrom !== null ? etaFrom + assignment.etaMinutes * 60_000 : null;
  return { state: "coming", by: "driver", byFirstName: firstName(vehicle?.driverName), etaAt };
}

const DRIVER_ON_THE_WAY = new Set<Doc<"requests">["status"]>(["driver_accepted", "en_route"]);

async function rideFor(ctx: QueryCtx, home: Doc<"households">, since: Since): Promise<RideState> {
  const request = await openRequestFor(ctx, home._id);
  if (request && DRIVER_ON_THE_WAY.has(request.status)) return await driverComing(ctx, request);
  if (request && request.status !== "arrived") return { state: "requested" };
  const coming = (await pickupPlansFor(ctx, home, since)).find((plan) => plan.status === "coming");
  if (coming) return { state: "coming", by: "neighbor", byFirstName: firstName(coming.helperName), etaAt: coming.helperEtaAt ?? null };
  return { state: "none" };
}

async function factsFor(ctx: QueryCtx, home: Doc<"households"> & { lat: number; lng: number }, since: Since, control: Doc<"control"> | null): Promise<HouseFacts> {
  const warningIssuedAt = control?.warningIssuedAt;
  const base = {
    address: home.address,
    residentName: home.residentName ?? null,
    warningIssued: warningIssuedAt !== undefined,
    inZone: home.inZone,
    callStatus: home.callStatus,
    away: home.away === true,
    fireArrivalAt: home.fireArrivalAt,
    fireReaches: hazardReaches(home, control?.hazard ?? DEFAULT_HAZARD),
  };
  if (warningIssuedAt === undefined) return { ...base, out: null, ride: { state: "none" } };
  const out = await howOut(ctx, home, since, warningIssuedAt);
  return { ...base, out, ride: out ? { state: "none" } : await rideFor(ctx, home, since) };
}

// The phone's one query. Null means the house was given back. The night's clock comes along so the
// phone can tell when the fire reaches the home without asking again.
export const forToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), v.object({ facts: houseFacts, clock: v.union(v.null(), simClock) })),
  handler: async (ctx, { token }) => {
    const claimed = await claimedHome(ctx, token);
    const home = claimed?.home;
    if (!claimed || !home || home.lat === undefined || home.lng === undefined) return null;
    const control = await ctx.db.query("control").first();
    const facts = await factsFor(ctx, { ...home, lat: home.lat, lng: home.lng }, claimed, control);
    return { facts, clock: control?.clock ?? null };
  },
});
