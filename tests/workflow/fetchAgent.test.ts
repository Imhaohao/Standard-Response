/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/fetchAgent.test.ts --environment edge-runtime
// The Fetch.ai agent's two routes: a wrong secret is refused, a sign-up makes one household, and the
// status answer never carries anything about a person.

const modules = import.meta.glob("../../convex/**/*.ts");
const SECRET = "test-agent-secret";
const SIGN_UP = {
  phone: "(626) 555-0199",
  address: "486 W Mariposa St, Altadena",
  lat: 34.1952,
  lng: -118.158,
  language: "en",
  exitPlan: "needs_ride",
  mobility: "walker",
  residentName: "Carmen Ortiz",
};

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

const post = (t: ReturnType<typeof setup>, path: string, body: unknown, secret: string | null = SECRET) =>
  t.fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify(body),
  });

const households = (t: ReturnType<typeof setup>) => t.run(async (ctx) => await ctx.db.query("households").collect());

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FETCH_AGENT_SECRET", SECRET);
  vi.stubEnv("EVACUATION_LINE_NUMBER", "+16265550100");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Fetch.ai agent routes", () => {
  test("a wrong or missing secret gets 401 and writes nothing", async () => {
    const t = setup();
    for (const path of ["/agent/ready-signup", "/agent/status"]) {
      expect((await post(t, path, SIGN_UP, "wrong")).status).toBe(401);
      expect((await post(t, path, SIGN_UP, null)).status).toBe(401);
    }
    expect(await households(t)).toHaveLength(0);
  });

  test("with no secret configured every request is refused", async () => {
    vi.stubEnv("FETCH_AGENT_SECRET", "");
    const t = setup();
    expect((await post(t, "/agent/ready-signup", SIGN_UP, "")).status).toBe(401);
  });

  test("a sign-up creates one unverified household and returns only its own confirmation", async () => {
    const t = setup();
    const response = await post(t, "/agent/ready-signup", SIGN_UP);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "received", address: SIGN_UP.address, verified: false });
    const rows = await households(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].callbackNumber).toBe("+16265550199");
    expect(rows[0].ready?.via).toBe("form");
    expect(rows[0].ready?.verified).toBe(false);
  });

  test("a repeat sign-up for the same phone changes nothing and answers the same", async () => {
    const t = setup();
    await post(t, "/agent/ready-signup", SIGN_UP);
    const again = await post(t, "/agent/ready-signup", { ...SIGN_UP, address: "1 Other St", mobility: "bedbound" });
    expect(again.status).toBe(200);
    const rows = await households(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(SIGN_UP.address);
    expect(rows[0].mobility).toBe("walker");
  });

  test("a sign-up missing the phone or the coordinates is a 400", async () => {
    const t = setup();
    expect((await post(t, "/agent/ready-signup", { ...SIGN_UP, phone: "abc" })).status).toBe(400);
    expect((await post(t, "/agent/ready-signup", { ...SIGN_UP, lat: undefined })).status).toBe(400);
    expect(await households(t)).toHaveLength(0);
  });

  test("status says no warning before one is issued, and names nobody", async () => {
    const t = setup();
    await post(t, "/agent/ready-signup", SIGN_UP);
    const response = await post(t, "/agent/status", { lat: SIGN_UP.lat, lng: SIGN_UP.lng });
    const body = await response.json();
    expect(body.warningActive).toBe(false);
    expect(body.coversPlace).toBeNull();
    expect(body.evacuationLine).toBe("+16265550100");
    const text = JSON.stringify(body);
    for (const secretThing of ["Carmen", "0199", "Mariposa", "walker"]) expect(text).not.toContain(secretThing);
  });

  test("status says a warning is active and whether the point is covered, with no personal data", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await post(t, "/agent/ready-signup", SIGN_UP);
    await t.mutation(api.control.issueWarning, {});
    const body = await (await post(t, "/agent/status", { lat: SIGN_UP.lat, lng: SIGN_UP.lng })).json();
    expect(body.warningActive).toBe(true);
    expect(body.coversPlace).toBe(true);
    expect(body.guidance).toContain("leave now");
    expect(Object.keys(body).sort()).toEqual(["coversPlace", "evacuationLine", "guidance", "warningActive"]);
  });

  test("status with bad coordinates is a 400", async () => {
    const t = setup();
    expect((await post(t, "/agent/status", { lat: 200, lng: 0 })).status).toBe(400);
  });
});
