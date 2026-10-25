/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/atlassianDoorChecks.test.ts --environment edge-runtime
// The Atlassian Forge app's route: a wrong secret is refused, the answer never carries a phone number
// or a name, and the order is the order of doorChecks:queue.

const modules = import.meta.glob("../../convex/**/*.ts");
const SECRET = "test-atlassian-secret";
const PHONE = "+16265550142";

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}
type T = ReturnType<typeof setup>;

const post = (t: T, body?: unknown, secret: string | null = SECRET) =>
  t.fetch("/agent/door-checks", {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const baseHome = {
  callbackNumber: PHONE,
  language: "es",
  callStatus: "door_check" as const,
  outcome: "unreachable" as const,
  inZone: true,
  attempts: 3,
  needPrior: 0.5,
  needProbability: 0.7,
  fireArrivalAt: 1,
  callPriority: 1,
  simulated: false,
};

const addHome = (t: T, fields: Record<string, unknown>) =>
  t.run(async (ctx) => ctx.db.insert("households", { ...baseHome, address: "1 Test St", ...fields } as never));

beforeEach(() => {
  vi.stubEnv("ATLASSIAN_APP_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /agent/door-checks", () => {
  test("a wrong or missing secret gets 401, and so does an unset secret", async () => {
    const t = setup();
    await addHome(t, {});
    expect((await post(t, {}, "wrong")).status).toBe(401);
    expect((await post(t, {}, null)).status).toBe(401);
    vi.stubEnv("ATLASSIAN_APP_SECRET", "");
    expect((await post(t, {}, "")).status).toBe(401);
  });

  test("the answer carries no phone number and no resident name", async () => {
    const t = setup();
    await addHome(t, { residentName: "Carmen Ortiz", mobility: "walker", assistanceRequired: "one_person_assist", lat: 34.19, lng: -118.15 });
    const text = await (await post(t, {})).text();
    expect(text).not.toContain("5550142");
    expect(text).not.toContain("Carmen");
    expect(text).not.toContain("callbackNumber");
    const { queue } = JSON.parse(text);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      rank: 1,
      address: "1 Test St",
      lat: 34.19,
      lng: -118.15,
      language: "es",
      needLevel: "high",
      needSummary: "uses a walker; needs one person to help",
    });
    expect(queue[0].reason).toContain("3 call attempts");
  });

  test("the order matches doorChecks:queue", async () => {
    const t = setup();
    await addHome(t, { address: "low", needProbability: 0.2 });
    await addHome(t, { address: "scored", needProbability: 0.1, doorPriority: 0.95 });
    await addHome(t, { address: "mid", needProbability: 0.5 });
    await addHome(t, { address: "reached", callStatus: "complete", needProbability: 0.99 });
    const expected = (await t.query(api.doorChecks.queue, { limit: 10 })).map((home) => home.address);
    const { queue } = await (await post(t, {})).json();
    expect(queue.map((item: { address: string }) => item.address)).toEqual(expected);
    expect(expected).toEqual(["scored", "mid", "low"]);
    expect(queue.map((item: { rank: number }) => item.rank)).toEqual([1, 2, 3]);
  });

  test("limit cuts the queue and reportOn names homes that left it", async () => {
    const t = setup();
    await addHome(t, { address: "a", needProbability: 0.9 });
    await addHome(t, { address: "b", needProbability: 0.8 });
    const reached = await addHome(t, { address: "c", callStatus: "complete", outcome: "leaving" });
    const answer = await (await post(t, { limit: 1, reportOn: [reached, "not-an-id"] })).json();
    expect(answer.queue).toHaveLength(1);
    expect(answer.resolved).toEqual([
      { householdId: reached, status: "now complete, outcome leaving" },
      { householdId: "not-an-id", status: "removed from the system" },
    ]);
  });

  test("a closed incident sends no homes and tells the app to delete its issues", async () => {
    const t = setup();
    await addHome(t, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("control", { dialerRunning: false, maxConcurrentCalls: 6, simulateVoice: true, simulateNeedModel: true, simulateDispatch: true, simulateDrivers: true, autoApprove: false, tickGeneration: 0, incidentClosedAt: 1 } as never);
    });
    const answer = await (await post(t, {})).json();
    expect(answer).toEqual({ queue: [], resolved: [], incidentClosed: true });
  });

  test("a malformed body gets 400", async () => {
    const t = setup();
    expect((await post(t, { limit: "ten" })).status).toBe(400);
    expect((await post(t, [1, 2])).status).toBe(400);
  });
});
