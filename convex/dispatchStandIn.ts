import { MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { located, metersBetween, Point, vehicleCanServe } from "./model";
import { acceptAssignment, approveAssignment, completeAssignment, liveAssignmentsFor } from "./offers";
import { Proposal, writePlan } from "./plans";
import { transitionRequest } from "./requests";

// Stand-in dispatcher, drivers and vehicle movement. Track C's solver replaces the dispatcher;
// the rules it must keep (compatibility, frozen accepted runs, version-checked accepts) live in
// plans.ts and offers.ts, not here.

const CITY_SPEED_MPS = 7;
const SIMULATED_SPEED_MPS = 60;
const DRIVER_ACCEPTS_AFTER_MS = 6_000;
const ARRIVED_WITHIN_METERS = 40;

type Waiting = Doc<"requests"> & Point;

async function waitingRequests(ctx: MutationCtx): Promise<Waiting[]> {
  const rows = [
    ...(await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", "received")).take(200)),
    ...(await ctx.db.query("requests").withIndex("by_status", (q) => q.eq("status", "reassigning")).take(200)),
  ];
  const waiting: Waiting[] = [];
  for (const request of rows) {
    const household = await ctx.db.get("households", request.householdId);
    if (!household || !located(household)) continue;
    if ((await liveAssignmentsFor(ctx, request._id)).length > 0) continue;
    waiting.push({ ...request, lat: household.lat, lng: household.lng });
  }
  return waiting.sort((a, b) => a.deadlineAt - b.deadlineAt);
}

async function freeVehicles(ctx: MutationCtx) {
  const busy = new Set<Id<"vehicles">>();
  for (const status of ["proposed", "offered", "accepted"] as const) {
    const rows = await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", status)).take(500);
    for (const row of rows) busy.add(row.vehicleId);
  }
  return (await ctx.db.query("vehicles").take(200)).filter((vehicle) => !busy.has(vehicle._id));
}

function nearestCompatible(request: Waiting, vehicles: Doc<"vehicles">[]) {
  const compatible = vehicles.filter((vehicle) => vehicleCanServe(vehicle, request));
  return compatible.sort((a, b) => metersBetween(a, request) - metersBetween(b, request))[0];
}

async function proposeForWaiting(ctx: MutationCtx, autoApprove: boolean) {
  const started = Date.now();
  let free = await freeVehicles(ctx);
  const offers: Proposal["offers"] = [];
  for (const request of await waitingRequests(ctx)) {
    const vehicle = nearestCompatible(request, free);
    if (!vehicle) continue;
    free = free.filter((v) => v._id !== vehicle._id);
    const etaMinutes = Math.ceil(metersBetween(vehicle, request) / CITY_SPEED_MPS / 60);
    offers.push({ requestId: request._id, vehicleId: vehicle._id, etaMinutes, stopOrder: 0 });
  }
  if (offers.length === 0) return;
  await writePlan(ctx, { solver: "stand_in", solveMs: Date.now() - started, offers, replace: [], revoke: [] }, autoApprove);
}

// Simulated drivers accept their offers after a few seconds. The real dispatcher keeps using this.
export async function standInDrivers(ctx: MutationCtx, now: number) {
  const offered = await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", "offered")).take(200);
  for (const assignment of offered) {
    if (now - (assignment.offeredAt ?? now) < DRIVER_ACCEPTS_AFTER_MS) continue;
    const vehicle = await ctx.db.get("vehicles", assignment.vehicleId);
    if (vehicle?.driverIsSimulated) await acceptAssignment(ctx, assignment._id);
  }
}

function stepToward(from: Point, to: Point, meters: number) {
  const distance = metersBetween(from, to);
  if (distance <= meters) return { ...to, arrived: true };
  const fraction = meters / distance;
  return {
    lat: from.lat + (to.lat - from.lat) * fraction,
    lng: from.lng + (to.lng - from.lng) * fraction,
    arrived: distance - meters < ARRIVED_WITHIN_METERS,
  };
}

async function driveAccepted(ctx: MutationCtx, assignment: Doc<"assignments">, stepMeters: number) {
  const vehicle = await ctx.db.get("vehicles", assignment.vehicleId);
  const household = await ctx.db.get("households", assignment.householdId);
  if (!vehicle || !household || !located(household)) return;
  const next = stepToward(vehicle, household, stepMeters);
  await ctx.db.patch("vehicles", vehicle._id, { lat: next.lat, lng: next.lng });
  const request = await ctx.db.get("requests", assignment.requestId);
  if (request?.status === "driver_accepted") await transitionRequest(ctx, request._id, "en_route");
  if (next.arrived) await completeAssignment(ctx, assignment._id);
}

async function moveVehicles(ctx: MutationCtx, tickMs: number) {
  const accepted = await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", "accepted")).take(200);
  const stepMeters = (SIMULATED_SPEED_MPS * tickMs) / 1000;
  for (const assignment of accepted) await driveAccepted(ctx, assignment, stepMeters);
}

// Stand-in for the dispatcher's approval, including offers proposed while approval was manual.
export async function approveLeftovers(ctx: MutationCtx) {
  const proposed = await ctx.db.query("assignments").withIndex("by_status", (q) => q.eq("status", "proposed")).take(200);
  for (const assignment of proposed) await approveAssignment(ctx, assignment._id);
}

export async function standInDispatch(ctx: MutationCtx, control: Doc<"control">, now: number, tickMs: number) {
  await proposeForWaiting(ctx, control.autoApprove);
  if (control.simulateDrivers) await standInDrivers(ctx, now);
  await moveVehicles(ctx, tickMs);
}

const CALLBACK_PLAYS_AFTER_MS = 3_000;

// Stand-in voice for callbacks: the resident picks up and hears the template.
export async function standInCallbacks(ctx: MutationCtx, now: number) {
  const pending = await ctx.db.query("callbacks").withIndex("by_state", (q) => q.eq("state", "pending")).take(50);
  for (const callback of pending) {
    if (now - callback.createdAt < CALLBACK_PLAYS_AFTER_MS) continue;
    const household = await ctx.db.get("households", callback.householdId);
    // Real riders (imported from the CSV) get their callback from the voice server.
    if (household && !household.simulated) continue;
    await ctx.db.patch("callbacks", callback._id, { state: "played", placedAt: callback.createdAt, playedAt: now });
    const told = callback.announces === "driver_accepted" ? "told a driver accepted" : "told their driver can't reach them";
    await ctx.db.insert("events", {
      kind: "dispatch",
      message: `${household?.address ?? "A rider"} called back and ${told}`,
      householdId: callback.householdId,
      at: now,
    });
  }
}
