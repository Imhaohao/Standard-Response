import { v } from "convex/values";
import { query, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requestStatus, vehicleType } from "./schema";
import { nextToCall } from "./households";
import { openRequestFor } from "./requests";
import { dialableNow } from "./reachLadder";
import { DEFAULT_HAZARD, hazard as hazardKind } from "./hazards";
import { hazardReaches } from "./fireArrival";
import { escapeRoute } from "./escapeRoute";
import { readClosures } from "./roads";
import { onWarningCallList } from "../lib/warning-call-list";

// What the real voice server reads. Only real riders (simulated: false) appear here;
// the stand-in keeps handling the simulated households.

const assignedDriver = v.object({
  name: v.string(),
  vehicleType,
  crewSize: v.number(),
  wheelchairSpaces: v.number(),
  stretcherSpaces: v.number(),
  etaMinutes: v.number(),
  shelterName: v.optional(v.string()),
});

export type AssignedDriver = typeof assignedDriver.type;

async function driverFor(ctx: QueryCtx, assignment: Doc<"assignments">): Promise<AssignedDriver | null> {
  const vehicle = await ctx.db.get("vehicles", assignment.vehicleId);
  if (!vehicle) return null;
  const shelter = assignment.shelterId ? await ctx.db.get("shelters", assignment.shelterId) : null;
  return {
    name: vehicle.driverName,
    vehicleType: vehicle.type,
    crewSize: vehicle.crewSize,
    wheelchairSpaces: vehicle.wheelchairSpaces,
    stretcherSpaces: vehicle.stretcherSpaces,
    etaMinutes: assignment.etaMinutes,
    shelterName: shelter?.name,
  };
}

// By status, so the driver is still found after many re-plans of this request.
async function acceptedAssignmentFor(ctx: QueryCtx, requestId: Id<"requests">) {
  for (const status of ["accepted", "completed"] as const) {
    const row = await ctx.db
      .query("assignments")
      .withIndex("by_requestId_and_status", (q) => q.eq("requestId", requestId).eq("status", status))
      .first();
    if (row) return row;
  }
  return null;
}

const statusShape = v.union(
  v.null(),
  v.object({
    requestId: v.id("requests"),
    status: requestStatus,
    driver: v.union(v.null(), assignedDriver),
  }),
);

// Subscribed for the length of every live call. A change interrupts the agent at the next sentence.
export const statusFor = query({
  args: { householdId: v.id("households") },
  returns: statusShape,
  handler: async (ctx, { householdId }) => {
    const request = await openRequestFor(ctx, householdId);
    if (!request) return null;
    const assignment = await acceptedAssignmentFor(ctx, request._id);
    const driver = assignment ? await driverFor(ctx, assignment) : null;
    return { requestId: request._id, status: request.status, driver };
  },
});

// Real riders the dialer may call now, highest priority first. The reach ladder workflow decides
// when a missed rider is due again (convex/reachLadder.ts); until then it stays out of this list.
// Only the team's phones are listed (lib/warning-call-list.ts), so other real numbers on houses
// never fill the queue ahead of them.
export const dialQueue = query({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("households"),
      callbackNumber: v.string(),
      language: v.string(),
      address: v.string(),
      residentName: v.optional(v.string()),
      attempts: v.number(),
      lastAttemptAt: v.optional(v.number()),
      callStatus: v.union(v.literal("not_called"), v.literal("no_answer")),
    }),
  ),
  handler: async (ctx, { limit }) => {
    const households = await nextToCall(ctx, limit * 4);
    return households
      .filter((h) => !h.simulated && onWarningCallList(h.callbackNumber) && dialableNow(h))
      .slice(0, limit)
      .map((h) => ({
        _id: h._id,
        callbackNumber: h.callbackNumber,
        language: h.language,
        address: h.address,
        residentName: h.residentName,
        attempts: h.attempts,
        lastAttemptAt: h.lastAttemptAt,
        callStatus: h.callStatus as "not_called" | "no_answer",
      }));
  },
});

// Names of the other residents on file, and nothing else about them, so the agent can tell a
// caller that the neighbor they named ("Boris is bedridden") is found without needing an address.
export const neighborNames = query({
  args: { householdId: v.id("households") },
  returns: v.array(v.string()),
  handler: async (ctx, { householdId }) =>
    (await ctx.db.query("households").take(5000)).flatMap((h) => (h.residentName && h._id !== householdId ? [h.residentName] : [])),
});

// The household as the agent should know it before the call: what the agency already has on file.
export const household = query({
  args: { householdId: v.id("households") },
  handler: async (ctx, { householdId }) => await ctx.db.get("households", householdId),
});

// Callbacks for real riders, each with what the template needs.
export const pendingCallbacks = query({
  args: {},
  handler: async (ctx) => {
    const pending = await ctx.db.query("callbacks").withIndex("by_state", (q) => q.eq("state", "pending")).take(50);
    const rows = [];
    for (const callback of pending) {
      const household = await ctx.db.get("households", callback.householdId);
      if (!household || household.simulated) continue;
      const assignment = await ctx.db.get("assignments", callback.assignmentId);
      const driver = assignment ? await driverFor(ctx, assignment) : null;
      rows.push({
        ...callback,
        callbackNumber: household.callbackNumber,
        language: household.language,
        residentName: household.residentName,
        driver,
      });
    }
    return rows;
  },
});

// Real riders on the text step of the reach ladder, with the thread so far.
export const textFollowUps = query({
  args: {},
  handler: async (ctx) => {
    const texted = await ctx.db
      .query("households")
      .withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "texted"))
      .take(100);
    const rows = [];
    for (const household of texted) {
      if (household.simulated) continue;
      const texts = await ctx.db
        .query("texts")
        .withIndex("by_householdId", (q) => q.eq("householdId", household._id))
        .take(50);
      rows.push({ householdId: household._id, language: household.language, lastAttemptAt: household.lastAttemptAt, texts });
    }
    return rows;
  },
});

const situationShape = v.object({
  hazard: hazardKind,
  warningIssuedAt: v.union(v.number(), v.null()),
  fireArrivalAt: v.union(v.number(), v.null()),
  hazardReaches: v.boolean(),
  route: v.union(v.null(), v.object({ streets: v.array(v.string()), minutes: v.number(), destination: v.string() })),
  fireUnits: v.number(),
  homesWaitingForCrew: v.number(),
  onCrewList: v.boolean(),
});

export type Situation = typeof situationShape.type;

// What a 911 call-taker's screen shows about this home, for the voice agent's brief. The minutes
// left and where the fire edge is now depend on the night clock, so the voice server works those
// out each turn from fireArrivalAt and the scenario fronts; this holds what changes with data.
export const situation = query({
  args: { householdId: v.id("households") },
  returns: v.union(v.null(), situationShape),
  handler: async (ctx, { householdId }) => {
    const home = await ctx.db.get("households", householdId);
    if (!home) return null;
    const control = await ctx.db.query("control").first();
    const hazard = control?.hazard ?? DEFAULT_HAZARD;
    const point = home.lat !== undefined && home.lng !== undefined ? { lat: home.lat, lng: home.lng } : null;
    const [shelters, closures, waiting, vehicles] = await Promise.all([
      ctx.db.query("shelters").take(50),
      readClosures(ctx),
      ctx.db.query("households").withIndex("by_callStatus_and_callPriority", (q) => q.eq("callStatus", "door_check")).take(1000),
      ctx.db.query("vehicles").take(500),
    ]);
    return {
      hazard,
      warningIssuedAt: control?.warningIssuedAt ?? null,
      fireArrivalAt: home.fireArrivalAt ?? null,
      hazardReaches: point ? hazardReaches(point, hazard) : true,
      route: point ? escapeRoute(point, shelters, closures) : null,
      fireUnits: vehicles.filter((vehicle) => vehicle.type === "fire_unit").length,
      homesWaitingForCrew: waiting.length,
      onCrewList: home.callStatus === "door_check",
    };
  },
});
