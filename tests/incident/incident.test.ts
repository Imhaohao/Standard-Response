/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { workflow } from "../../convex/reachLadder";
import type { WorkflowId } from "@convex-dev/workflow";
import { registerHouseholdCounts } from "../workflow/householdCounts";

// Run with: npx vitest run tests/incident --environment edge-runtime

const modules = import.meta.glob("../../convex/**/*.ts");
const HOUR = 3_600_000;
const REAL_PHONE = "+15551230000";
const REAL_NAME = "Dolores Quint";
const REAL_ADDRESS = "17 Real Lane";

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

async function insertHousehold(t: T, simulated: boolean) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address: simulated ? "1 Make Believe Way" : REAL_ADDRESS,
      callbackNumber: simulated ? "+15550000009" : REAL_PHONE,
      residentName: simulated ? "Sim Person" : REAL_NAME,
      medical: ["oxygen"],
      language: "en",
      callStatus: "complete",
      outcome: "needs_ride",
      inZone: true,
      attempts: 1,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: Date.now(),
      callPriority: 1,
      simulated,
    }),
  );
}

// One home's footprint: a call with a transcript line, a text, a request, an activity event, an audit
// row for the request, and a nomination naming the home.
async function leaveFootprint(t: T, householdId: Id<"households">, simulated: boolean) {
  const place = simulated ? "1 Make Believe Way" : REAL_ADDRESS;
  const who = simulated ? "Sim Person" : REAL_NAME;
  const phone = simulated ? "+15550000009" : REAL_PHONE;
  return await t.run(async (ctx) => {
    const callId = await ctx.db.insert("calls", {
      householdId,
      direction: "outbound",
      phase: "ended",
      stage: "close",
      language: "en",
      attempt: 1,
      startedAt: Date.now(),
      simulated,
    });
    await ctx.db.insert("transcriptLines", { callId, speaker: "resident", text: `I am ${who}`, at: Date.now() });
    await ctx.db.insert("texts", { householdId, direction: "inbound", body: phone, at: Date.now() });
    const requestId = await ctx.db.insert("requests", {
      householdId,
      status: "received",
      load: { seats: 1, wheelchairSpaces: 0, stretcherSpaces: 0 },
      crewNeeded: 1,
      needsLift: false,
      boardingMinutes: 3,
      deadlineAt: Date.now(),
      weight: 1,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("events", { kind: "record", message: `${place} recorded`, householdId, at: Date.now() });
    await ctx.db.insert("auditLog", { kind: "plan", message: `Plan for ${place}`, requestId, at: Date.now() });
    await ctx.db.insert("nominations", { fromHouseholdId: householdId, spokenAddress: place, status: "open", at: Date.now() });
    return { callId, requestId };
  });
}

type CountedTable = "households" | "calls" | "transcriptLines" | "texts" | "requests" | "events" | "auditLog" | "nominations";

const count = (t: T, table: CountedTable) => t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

const control = (t: T) => t.run(async (ctx) => ctx.db.query("control").first());

async function scheduledPurges(t: T) {
  return await t.run(async (ctx) => {
    const all = await ctx.db.system.query("_scheduled_functions").collect();
    return all.filter((job) => job.name.includes("incident:purge"));
  });
}

async function pendingPurges(t: T) {
  return (await scheduledPurges(t)).filter((job) => job.state.kind === "pending");
}

async function runScheduled(t: T) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function pretendClosedHoursAgo(t: T, hours: number) {
  await t.run(async (ctx) => {
    const row = await ctx.db.query("control").first();
    await ctx.db.patch("control", row!._id, { incidentClosedAt: Date.now() - hours * HOUR, incidentPurgeId: undefined });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  delete process.env.INCIDENT_RETENTION_HOURS;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("closing the incident", () => {
  test("schedules the purge at the default 72 hour retention time", async () => {
    const t = setup();
    const { closedAt, purgeAt } = await t.mutation(api.incident.close, {});
    expect(purgeAt - closedAt).toBe(72 * HOUR);
    const jobs = await scheduledPurges(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].scheduledTime).toBe(purgeAt);
    expect((await control(t))?.incidentClosedAt).toBe(closedAt);
    const events = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(events.some((event) => event.message.startsWith("Incident closed: rider data will be deleted at"))).toBe(true);
  });

  test("reads the retention window from INCIDENT_RETENTION_HOURS", async () => {
    process.env.INCIDENT_RETENTION_HOURS = "6";
    const t = setup();
    const { closedAt, purgeAt } = await t.mutation(api.incident.close, {});
    expect(purgeAt - closedAt).toBe(6 * HOUR);
  });

  test("closing twice schedules one purge", async () => {
    const t = setup();
    const first = await t.mutation(api.incident.close, {});
    const second = await t.mutation(api.incident.close, {});
    expect(second).toEqual(first);
    expect(await scheduledPurges(t)).toHaveLength(1);
  });

  test("reopening cancels the scheduled purge", async () => {
    const t = setup();
    await t.mutation(api.incident.close, {});
    await t.mutation(api.incident.reopen, {});
    expect((await control(t))?.incidentClosedAt).toBeUndefined();
    expect(await pendingPurges(t)).toHaveLength(0);
    await t.mutation(api.incident.close, {});
    expect(await pendingPurges(t)).toHaveLength(1);
  });
});

describe("the purge", () => {
  test("deletes real riders' personal data and keeps simulated riders", async () => {
    process.env.INCIDENT_RETENTION_HOURS = "0";
    const t = setup();
    const real = await insertHousehold(t, false);
    const simulated = await insertHousehold(t, true);
    await leaveFootprint(t, real, false);
    await leaveFootprint(t, simulated, true);
    await t.mutation(api.incident.close, {});
    await runScheduled(t);

    const homes = await t.run(async (ctx) => ctx.db.query("households").collect());
    expect(homes.map((home) => home._id)).toEqual([simulated]);
    for (const table of ["calls", "transcriptLines", "texts", "requests", "auditLog", "nominations"] as const) {
      expect(await count(t, table), table).toBe(1);
    }
    const events = await t.run(async (ctx) => ctx.db.query("events").collect());
    const everything = JSON.stringify(events);
    expect(everything).not.toContain(REAL_ADDRESS);
    expect(everything).not.toContain(REAL_NAME);
    expect(everything).not.toContain(REAL_PHONE);
    const summary = events.find((event) => event.message.startsWith("Incident rider data deleted"));
    expect(summary?.message).toContain("1 households");
    expect((await control(t))?.incidentPurgedAt).toBeDefined();
  });

  test("scrubs the archived copies of a night", async () => {
    process.env.INCIDENT_RETENTION_HOURS = "0";
    const t = setup();
    const real = await insertHousehold(t, false);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("nightRuns", { startedAt: 1, status: "archived" });
      await ctx.db.insert("nightRunRows", { runId, kind: "end", table: "households", docId: real, createdAt: 1, doc: { residentName: REAL_NAME, simulated: false } });
      await ctx.db.insert("nightRunRows", { runId, kind: "end", table: "households", docId: "sim", createdAt: 1, doc: { residentName: "Sim", simulated: true } });
    });
    await t.mutation(api.incident.close, {});
    await runScheduled(t);
    const rows = await t.run(async (ctx) => ctx.db.query("nightRunRows").collect());
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(REAL_NAME);
  });

  test("cancels the reach ladder workflow of a purged rider", async () => {
    process.env.INCIDENT_RETENTION_HOURS = "0";
    const t = setup();
    const real = await insertHousehold(t, false);
    await t.run(async (ctx) => ctx.db.patch("households", real, { callStatus: "not_called", outcome: "unknown", attempts: 0 }));
    const callId = await t.mutation(api.calls.start, { householdId: real, direction: "outbound" });
    await t.mutation(api.calls.end, { callId, answered: false });
    const home = await t.run(async (ctx) => ctx.db.get("households", real));
    const workflowId = home!.ladder!.workflowId as WorkflowId;
    expect(await t.run(async (ctx) => (await workflow.status(ctx, workflowId)).type)).toBe("inProgress");
    await t.mutation(api.incident.close, {});
    await runScheduled(t);
    expect(await count(t, "households")).toBe(0);
    expect(await t.run(async (ctx) => (await workflow.status(ctx, workflowId)).type)).toBe("canceled");
  });

  test("a reopened incident keeps its data even if a stray purge runs", async () => {
    const t = setup();
    await insertHousehold(t, false);
    await t.mutation(api.incident.close, {});
    await t.mutation(api.incident.reopen, {});
    await t.mutation(internal.incident.purge, {});
    await runScheduled(t);
    expect(await count(t, "households")).toBe(1);
  });

  test("household counts stay consistent with the households that remain", async () => {
    process.env.INCIDENT_RETENTION_HOURS = "0";
    const t = setup();
    await insertHousehold(t, false);
    await insertHousehold(t, false);
    await insertHousehold(t, true);
    await runScheduled(t);
    expect((await t.query(api.households.counts, {})).total).toBe(3);
    await t.mutation(api.incident.close, {});
    await runScheduled(t);
    const counts = await t.query(api.households.counts, {});
    expect(counts.total).toBe(1);
    expect(counts.outcome.needs_ride).toBe(1);
    expect(counts.callStatus.complete).toBe(1);
  });
});

describe("the daily sweep", () => {
  test("starts a purge that was missed", async () => {
    const t = setup();
    await insertHousehold(t, false);
    await t.mutation(api.incident.close, {});
    await pretendClosedHoursAgo(t, 80);
    await t.mutation(internal.incident.sweep, {});
    await runScheduled(t);
    expect(await count(t, "households")).toBe(0);
  });

  test("does nothing with no closed incident or before the window ends", async () => {
    const t = setup();
    await insertHousehold(t, false);
    await t.mutation(internal.incident.sweep, {});
    expect(await scheduledPurges(t)).toHaveLength(0);
    await t.mutation(api.incident.close, {});
    await t.mutation(internal.incident.sweep, {});
    expect(await pendingPurges(t)).toHaveLength(1);
    expect(await count(t, "households")).toBe(1);
  });

  test("does nothing once no real rider data is left", async () => {
    const t = setup();
    await insertHousehold(t, true);
    await t.mutation(api.incident.close, {});
    await pretendClosedHoursAgo(t, 80);
    const before = (await scheduledPurges(t)).length;
    await t.mutation(internal.incident.sweep, {});
    expect((await scheduledPurges(t)).length).toBe(before);
  });
});
