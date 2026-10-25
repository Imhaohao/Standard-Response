/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/nightRuns.test.ts --environment edge-runtime
// A rewind keeps the night in `nightRuns` and puts the homes back as the run started; a reset keeps
// the night and then clears everything.

const modules = import.meta.glob("../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

const RESIDENT = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, residentName: "Wen" };
const NEIGHBOR = { phone: "+15550000002", address: "1212 Palm St", lat: 34.19, lng: -118.15445, residentName: "Ana" };
const HELPER = { name: NEIGHBOR.residentName, phone: NEIGHBOR.phone, relation: "neighbor" };

async function signUp(t: T) {
  await t.mutation(api.control.reset, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const profile = { language: "en", care: [] };
  const neighbor = await t.mutation(api.ready.submit, { ...profile, ...NEIGHBOR, exitPlan: "own_car", hasCar: true });
  const resident = await t.mutation(api.ready.submit, { ...profile, ...RESIDENT, exitPlan: "helper", hasCar: false, helper: HELPER });
  return { resident, neighbor };
}

const home = (t: T, id: Id<"households">) => t.run(async (ctx) => ctx.db.get("households", id));
const count = (t: T, table: "calls" | "events" | "pickupPlans" | "households") => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
const runs = (t: T) => t.query(api.nightRuns.list, {});
const saved = async (t: T, runId: Id<"nightRuns">, table: string, kind: "start" | "end" = "end") =>
  (await t.query(api.nightRuns.rows, { runId, table, kind, paginationOpts: { numItems: 100, cursor: null } })).page;

async function rewind(t: T) {
  await t.mutation(api.control.rewind, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

// The Ready check, then the warning, a call that says the resident can't leave, and a pickup call.
async function runTheNight(t: T, resident: Id<"households">) {
  await t.mutation(api.ready.start, {});
  await t.mutation(api.ready.saveFromCall, { householdId: resident, exitPlan: "needs_ride", care: [], peopleCount: 3 });
  await t.mutation(api.control.issueWarning, {});
  await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no", mobility: "walker" } });
  const [plan] = await t.run(async (ctx) => ctx.db.query("pickupPlans").collect());
  const callId = await t.mutation(api.calls.startFlow, { householdId: resident, flow: { kind: "pickup", planId: plan._id, role: "helper", purpose: "ask" } });
  await t.mutation(api.calls.end, { callId, answered: true });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("night runs", () => {
  test("a rewind keeps the night and puts every home and arranged pickup back as the run started", async () => {
    const t = setup();
    const { resident, neighbor } = await signUp(t);
    const before = await home(t, resident);
    await runTheNight(t, resident);
    expect((await home(t, resident))?.canLeave).toBe("no");

    await rewind(t);

    const control = await t.run(async (ctx) => ctx.db.query("control").first());
    expect(control).toMatchObject({ dialerRunning: false, readyCheckRunning: false });
    expect([control?.warningIssuedAt, control?.archivingRunId]).toEqual([undefined, undefined]);

    expect(await home(t, resident)).toEqual(before);
    expect((await home(t, neighbor))?.ready?.exitPlan).toBe("own_car");

    const plans = await t.run(async (ctx) => ctx.db.query("pickupPlans").collect());
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ householdId: resident, helperHouseholdId: neighbor, helperName: "Ana", status: "arranged" });
    expect(await count(t, "calls")).toBe(0);
    expect(await count(t, "events")).toBe(0);

    const [run] = await runs(t);
    expect(run).toMatchObject({ status: "archived", endedBy: "rewind" });
    expect(run.warningIssuedAt).toBeDefined();
    expect(await saved(t, run._id, "calls")).toHaveLength(1);
    const savedHomes = await saved(t, run._id, "households");
    expect(savedHomes.find((row) => row.docId === resident)?.doc).toMatchObject({ canLeave: "no", mobility: "walker", peopleCount: 3 });
    // His Ready call said he now needs a ride, so the night asked a neighbor; the rewind put Ana back.
    expect((await saved(t, run._id, "pickupPlans"))[0].doc).toMatchObject({ status: "checking", recruited: true });
    expect(run.savedRows).toBeGreaterThan(0);
  });

  test("the night can be run again after a rewind, and each night is kept on its own", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    await runTheNight(t, resident);
    await rewind(t);
    await runTheNight(t, resident);
    await rewind(t);
    const kept = await runs(t);
    expect(kept.map((run) => run.status)).toEqual(["archived", "archived"]);
    expect(kept.map((run) => run.endedBy)).toEqual(["rewind", "rewind"]);
    expect((await home(t, resident))?.ready?.exitPlan).toBe("helper");
  });

  test("a night that began before runs were kept clears what calls learned from the homes they reached", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    await t.mutation(api.riders.importCsv, { csv: "rider_id,name,address,lat,lng,phone,language,mobility,assistance\nR-1,Quiet,3 Quiet Ln,34.191,-118.151,+15550000003,en,walker,none" });
    const quiet = (await t.run(async (ctx) => ctx.db.query("households").withIndex("by_callbackNumber", (q) => q.eq("callbackNumber", "+15550000003")).first()))!._id;
    // As if the warning went out before this deployment kept runs: no run was started for it.
    await t.run(async (ctx) => {
      const control = await ctx.db.query("control").first();
      await ctx.db.patch("control", control!._id, { warningIssuedAt: 1, dialerRunning: true });
    });
    const callId = await t.mutation(api.calls.start, { householdId: resident, direction: "outbound" });
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    await t.mutation(api.calls.end, { callId, answered: true });

    await rewind(t);

    const cleared = (await home(t, resident))!;
    expect(cleared).toMatchObject({ outcome: "unknown", callStatus: "not_called", attempts: 0, residentName: "Wen", address: RESIDENT.address });
    expect([cleared.canLeave, cleared.ready]).toEqual([undefined, undefined]);
    expect((await home(t, quiet))?.mobility).toBe("walker");
    const [run] = await runs(t);
    expect(run).toMatchObject({ status: "archived", endedBy: "rewind", warningIssuedAt: 1 });
  });

  test("a reset keeps the night, homes included, and then clears them", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    await runTheNight(t, resident);
    await t.mutation(api.control.reset, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await count(t, "households")).toBe(0);
    const [run] = await runs(t);
    expect(run).toMatchObject({ status: "archived", endedBy: "reset" });
    expect((await saved(t, run._id, "households")).map((row) => row.docId).sort()).toHaveLength(2);
  });

  test("a rewind to the warning keeps the Ready check's results and pairing, and can still go back to before the Ready check", async () => {
    const t = setup();
    const { resident, neighbor } = await signUp(t);
    const beforeReadyCheck = await home(t, resident);
    await t.mutation(api.ready.start, {});
    await t.mutation(api.ready.saveFromCall, { householdId: resident, exitPlan: "needs_ride", care: [], peopleCount: 3, mobility: "walker" });
    const afterReadyCheck = await home(t, resident);
    const [pairing] = await t.run(async (ctx) => ctx.db.query("pickupPlans").collect());
    expect(pairing).toMatchObject({ householdId: resident, helperHouseholdId: neighbor, status: "arranged", recruited: true });
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    expect((await t.run(async (ctx) => ctx.db.get("pickupPlans", pairing._id)))?.status).toBe("checking");

    await t.mutation(api.control.rewind, { to: "warning" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await home(t, resident)).toEqual(afterReadyCheck);
    const plans = await t.run(async (ctx) => ctx.db.query("pickupPlans").collect());
    expect(plans.map((plan) => ({ helper: plan.helperHouseholdId, status: plan.status }))).toEqual([{ helper: neighbor, status: "arranged" }]);
    const control = await t.run(async (ctx) => ctx.db.query("control").first());
    expect(control?.warningIssuedAt).toBeUndefined();
    expect(control?.readyCheckStartedAt).toBeDefined();
    const [current, archived] = await runs(t);
    expect([current.status, archived.status]).toEqual(["current", "archived"]);

    // The night runs again from the warning, and a rewind to the start still finds the homes before the Ready check.
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    await rewind(t);
    expect(await home(t, resident)).toEqual(beforeReadyCheck);
  });

  test("a rewind to the warning on a night with no warning checkpoint keeps each home's Ready check profile", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    await t.mutation(api.ready.saveFromCall, { householdId: resident, exitPlan: "needs_ride", care: [], peopleCount: 3 });
    // As if the warning went out before warning checkpoints were saved.
    await t.run(async (ctx) => {
      const control = await ctx.db.query("control").first();
      await ctx.db.patch("control", control!._id, { warningIssuedAt: 1, dialerRunning: true });
    });
    const callId = await t.mutation(api.calls.start, { householdId: resident, direction: "outbound" });
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
    await t.mutation(api.calls.end, { callId, answered: true });

    await t.mutation(api.control.rewind, { to: "warning" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const back = (await home(t, resident))!;
    expect(back).toMatchObject({ peopleCount: 3, outcome: "unknown", callStatus: "not_called", attempts: 0, ready: { exitPlan: "needs_ride", via: "call" } });
    expect(back.canLeave).toBeUndefined();
  });

  test("a profile fixed after a rewind to the warning is what the next rewind to the warning restores", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    await t.mutation(api.ready.start, {});
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.control.rewind, { to: "warning" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await t.mutation(api.ready.saveFromCall, { householdId: resident, exitPlan: "needs_ride", care: [], mobility: "walker", peopleCount: 2 });
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no", peopleCount: 4 } });
    await t.mutation(api.control.rewind, { to: "warning" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await home(t, resident)).toMatchObject({ peopleCount: 2, mobility: "walker", ready: { exitPlan: "needs_ride" } });
  });

  test("a home that called in before the warning still gets the warning call", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    const callId = await t.mutation(api.calls.start, { householdId: resident, direction: "inbound" });
    await t.mutation(api.calls.end, { callId, answered: true });
    expect((await home(t, resident))?.callStatus).toBe("complete");
    await t.mutation(api.control.issueWarning, {});
    const queued = await t.query(api.voice.dialQueue, { limit: 10 });
    expect(queued.map((row) => row._id)).toContain(resident);
  });

  test("a rewind waits for a real call to finish", async () => {
    const t = setup();
    const { resident } = await signUp(t);
    await t.mutation(api.control.issueWarning, {});
    await t.mutation(api.calls.start, { householdId: resident, direction: "outbound" });
    await expect(t.mutation(api.control.rewind, {})).rejects.toThrow(/still live/);
  });
});
