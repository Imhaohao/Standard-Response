/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import workflowTest from "@convex-dev/workflow/test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { completeAssignment } from "../../convex/offers";
import { registerHouseholdCounts } from "./householdCounts";

// Run with: npx vitest run tests/workflow/reimburse.test.ts --environment edge-runtime
// Volunteer mileage through a fake Nessie sandbox: a confirmed volunteer pickup pays once, an agency
// van pays nothing, a repeat or retry never pays twice, and with no key nothing is sent.

const modules = import.meta.glob("../../convex/**/*.ts");
const BASE = "http://nessie.test";
const AGENCY = "agency-account";

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  workflowTest.register(t, "workflow");
  return t;
}

type T = ReturnType<typeof setup>;

// An in-memory Nessie shaped like the live sandbox (checked 2026-10-24): a transfer takes exactly
// amount, transaction_date, status and description (no payee, extra fields are a 400), lists and
// fetches return `id`, amounts are whole dollars, and the payee is paid by a deposit.
function fakeNessie() {
  let next = 0;
  const id = (kind: string) => `${kind}-${++next}`;
  const accounts = new Map<string, string[]>();
  const transfers: { id: string; payer_id: string; amount: number; description: string; status: string }[] = [];
  const deposits: { account: string; amount: number; description: string }[] = [];
  const log: string[] = [];
  const failures: { transfer?: "rejected" | "lost" } = {};
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const created = (objectCreated: object) => json(201, { code: 201, message: "Created", objectCreated });

  const TRANSFER_FIELDS = ["amount", "description", "status", "transaction_date"];
  function postTransfer(path: string, body: Record<string, unknown>) {
    if (failures.transfer === "rejected") return json(500, { code: 500, message: "Internal error" });
    if (Object.keys(body).sort().join() !== TRANSFER_FIELDS.join()) return json(400, `validation errors for TransferCreate: ${Object.keys(body).join()}`);
    const transfer = { id: id("transfer"), payer_id: path.split("/")[2], amount: Math.trunc(Number(body.amount)), description: String(body.description), status: "pending" };
    transfers.push(transfer);
    if (failures.transfer === "lost") throw new TypeError("network connection lost");
    const { id: _id, ...rest } = transfer;
    return created({ _id, ...rest });
  }

  const routes: [string, RegExp, (path: string, body: never) => Response][] = [
    ["POST", /^\/customers$/, () => created({ _id: id("customer") })],
    ["GET", /^\/customers\/[^/]+\/accounts$/, (path) => json(200, (accounts.get(path.split("/")[2]) ?? []).map((_id) => ({ _id, type: "Checking" })))],
    ["POST", /^\/customers\/[^/]+\/accounts$/, (path) => {
      const account = id("account");
      accounts.set(path.split("/")[2], [...(accounts.get(path.split("/")[2]) ?? []), account]);
      return created({ _id: account });
    }],
    ["POST", /^\/accounts\/[^/]+\/transfers$/, postTransfer],
    ["GET", /^\/accounts\/[^/]+\/transfers$/, (path) => json(200, transfers.filter((t) => t.payer_id === path.split("/")[2]))],
    ["POST", /^\/accounts\/[^/]+\/deposits$/, (path, body: { amount: number; description: string }) => {
      deposits.push({ account: path.split("/")[2], amount: Math.trunc(body.amount), description: body.description });
      return created({ _id: id("deposit") });
    }],
    ["GET", /^\/transfers\/[^/]+$/, (path) => {
      const found = transfers.find((t) => t.id === path.split("/")[2]);
      return found ? json(200, found) : json(404, { code: 404, message: "Not found" });
    }],
  ];

  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? "GET";
    log.push(`${method} ${url.pathname}`);
    if (url.searchParams.get("key") !== "test-key") return json(401, { code: 401, message: "Bad key" });
    const route = routes.find(([m, pattern]) => m === method && pattern.test(url.pathname));
    if (!route) return json(404, { code: 404, message: "No route" });
    return route[2](url.pathname, (init?.body ? JSON.parse(String(init.body)) : undefined) as never);
  };
  return { fetch, transfers, deposits, log, failures };
}

let nessie: ReturnType<typeof fakeNessie>;

beforeEach(() => {
  vi.useFakeTimers();
  nessie = fakeNessie();
  vi.stubGlobal("fetch", nessie.fetch);
  vi.stubEnv("NESSIE_API_KEY", "test-key");
  vi.stubEnv("NESSIE_AGENCY_ACCOUNT_ID", AGENCY);
  vi.stubEnv("NESSIE_BASE_URL", BASE);
  vi.stubEnv("REIMBURSE_RATE_PER_MILE", "");
  vi.stubEnv("REIMBURSE_MAX", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// About 50 m apart on one street, the same pair as realPickupFlow.test.ts. The shelter is a few
// blocks south, inside the road graph.
const RESIDENT = { phone: "+15550000001", address: "1210 Palm St", lat: 34.19, lng: -118.155, residentName: "Wen" };
const NEIGHBOR = { phone: "+15550000002", address: "1212 Palm St", lat: 34.19, lng: -118.15445, residentName: "Ana Morales" };
const SHELTER = { name: "Loma Alta Park", lat: 34.18, lng: -118.155, capacity: 200 };

// A neighbor drives the resident; the resident confirms the pickup on the last call.
async function completeVolunteerPickup(t: T) {
  await t.mutation(api.control.reset, {});
  await t.run(async (ctx) => void (await ctx.db.insert("shelters", SHELTER)));
  const profile = { language: "en", care: [] };
  const resident = await t.mutation(api.ready.submit, { ...profile, ...RESIDENT, exitPlan: "needs_ride", hasCar: false });
  await t.mutation(api.ready.submit, { ...profile, ...NEIGHBOR, exitPlan: "own_car", hasCar: true });
  await t.mutation(api.control.issueWarning, {});
  await t.mutation(api.households.update, { householdId: resident, patch: { canLeave: "no" } });
  const [plan] = await t.run(async (ctx) => ctx.db.query("pickupPlans").withIndex("by_householdId", (q) => q.eq("householdId", resident)).collect());
  await t.mutation(api.pickups.startAttempt, { planId: plan._id, role: "helper" });
  await t.mutation(api.pickups.helperAnswered, { planId: plan._id, coming: true, etaMinutes: 10 });
  await t.mutation(api.pickups.residentConfirmation, { planId: plan._id, confirmed: true });
  await t.mutation(api.pickups.residentAnswered, { planId: plan._id, pickedUp: true });
  return { resident, planId: plan._id };
}

const rows = (t: T) => t.run(async (ctx) => ctx.db.query("reimbursements").collect());
const scheduledPays = (t: T) =>
  t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.startsWith("reimburse")));
const pay = (t: T, reimbursementId: Id<"reimbursements">) => t.action(internal.reimburse.pay, { reimbursementId });
const reimbursedEvents = (t: T) => t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((event) => event.message.startsWith("Reimbursed")));

describe("volunteer mileage through Nessie", () => {
  test("a confirmed volunteer pickup schedules one payment and pays it once", async () => {
    const t = setup();
    await completeVolunteerPickup(t);
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "pending", volunteerFirstName: "Ana", ratePerMile: 0.14, distanceSource: "road" });
    expect(row.miles).toBeGreaterThan(0);
    expect(row.amountCents).toBe(Math.max(1, Math.ceil(row.miles * 0.14)) * 100);
    expect((await scheduledPays(t)).map((job) => job.name)).toEqual(["reimburse:pay"]);

    await pay(t, row._id);
    await pay(t, row._id);
    const [paid] = await rows(t);
    expect(paid).toMatchObject({ status: "paid", nessieTransferId: nessie.transfers[0].id, attempts: 1 });
    expect(nessie.transfers).toHaveLength(1);
    expect(nessie.transfers[0]).toMatchObject({ payer_id: AGENCY, amount: row.amountCents / 100 });
    expect(nessie.deposits).toHaveLength(1);
    expect(nessie.deposits[0].amount).toBe(row.amountCents / 100);
    expect(nessie.log.filter((line) => line === "POST /customers")).toHaveLength(1);
    const [event] = await reimbursedEvents(t);
    expect(event.message).toBe(`Reimbursed Ana $${(row.amountCents / 100).toFixed(2)} for ${row.miles.toFixed(1)} miles`);

    const [listed] = await t.query(api.reimburse.list, {});
    expect(listed).toMatchObject({ status: "paid", volunteerFirstName: "Ana", amountCents: row.amountCents });
    expect(listed).not.toHaveProperty("volunteerKey");
  });

  test("an agency van's completed ride pays nothing", async () => {
    const t = setup();
    await t.mutation(api.control.reset, {});
    const householdId = await t.mutation(api.ready.submit, { language: "en", care: [], ...RESIDENT, exitPlan: "needs_ride", hasCar: false });
    await t.run(async (ctx) => {
      const load = { seats: 1, wheelchairSpaces: 0, stretcherSpaces: 0 };
      const requestId = await ctx.db.insert("requests", {
        householdId, status: "driver_accepted", load, crewNeeded: 1, needsLift: false, boardingMinutes: 2, deadlineAt: 0, weight: 1, updatedAt: 0,
      });
      const vehicleId = await ctx.db.insert("vehicles", {
        label: "Van 1", type: "paratransit", driverName: "Luis", lat: 34.19, lng: -118.155, seats: 6, wheelchairSpaces: 1,
        stretcherSpaces: 0, crewSize: 1, liftCapable: true, shiftEndsAt: 0, driverIsSimulated: false,
      });
      const assignmentId = await ctx.db.insert("assignments", {
        requestId, householdId, vehicleId, planVersion: 1, status: "accepted", etaMinutes: 5, stopOrder: 0, proposedAt: 0,
      });
      await completeAssignment(ctx as never, assignmentId);
    });
    expect(await rows(t)).toHaveLength(0);
    expect(await scheduledPays(t)).toHaveLength(0);
    expect(nessie.log).toHaveLength(0);
  });

  test("a second completion of the same ride pays nothing more", async () => {
    const t = setup();
    const { planId } = await completeVolunteerPickup(t);
    await t.mutation(api.pickups.residentAnswered, { planId, pickedUp: true });
    await t.run(async (ctx) => {
      const { scheduleReimbursement } = await import("../../convex/reimburse");
      await scheduleReimbursement(ctx as never, (await ctx.db.get("pickupPlans", planId))!);
    });
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(await scheduledPays(t)).toHaveLength(1);
    await pay(t, all[0]._id);
    await pay(t, all[0]._id);
    expect(nessie.transfers).toHaveLength(1);
    expect(await reimbursedEvents(t)).toHaveLength(1);
  });

  test("a Nessie failure leaves the payment failed, and a retry pays once", async () => {
    const t = setup();
    await completeVolunteerPickup(t);
    const [row] = await rows(t);
    nessie.failures.transfer = "rejected";
    await pay(t, row._id);
    expect((await rows(t))[0]).toMatchObject({ status: "failed" });
    expect((await rows(t))[0].error).toContain("500");
    expect(nessie.transfers).toHaveLength(0);
    expect(await reimbursedEvents(t)).toHaveLength(0);

    nessie.failures.transfer = undefined;
    expect(await t.mutation(internal.reimburse.retry, { reimbursementId: row._id })).toBe(true);
    await pay(t, row._id);
    await pay(t, row._id);
    expect((await rows(t))[0]).toMatchObject({ status: "paid", attempts: 2 });
    expect(nessie.transfers).toHaveLength(1);
    expect(nessie.log.filter((line) => line === "POST /customers")).toHaveLength(1);
    expect(await t.mutation(internal.reimburse.retry, { reimbursementId: row._id })).toBe(false);
  });

  test("a transfer that reached Nessie but whose answer was lost is found on retry, not sent again", async () => {
    const t = setup();
    await completeVolunteerPickup(t);
    const [row] = await rows(t);
    nessie.failures.transfer = "lost";
    await pay(t, row._id);
    expect((await rows(t))[0].status).toBe("failed");
    expect(nessie.transfers).toHaveLength(1);

    nessie.failures.transfer = undefined;
    await t.mutation(internal.reimburse.retry, { reimbursementId: row._id });
    await pay(t, row._id);
    expect((await rows(t))[0]).toMatchObject({ status: "paid", nessieTransferId: nessie.transfers[0].id });
    expect(nessie.transfers).toHaveLength(1);
    expect(nessie.log.filter((line) => line.startsWith("POST /accounts/"))).toHaveLength(1);
  });

  test("with no key the payment is recorded as not configured and nothing is sent", async () => {
    vi.stubEnv("NESSIE_API_KEY", "");
    const t = setup();
    await completeVolunteerPickup(t);
    const [row] = await rows(t);
    await pay(t, row._id);
    expect((await rows(t))[0]).toMatchObject({ status: "not_configured", attempts: 0 });
    expect(nessie.log).toHaveLength(0);
    expect(await reimbursedEvents(t)).toHaveLength(0);
  });

  test("the payment is capped by REIMBURSE_MAX", async () => {
    vi.stubEnv("REIMBURSE_RATE_PER_MILE", "100");
    vi.stubEnv("REIMBURSE_MAX", "3.5");
    const t = setup();
    await completeVolunteerPickup(t);
    const [row] = await rows(t);
    // Nessie keeps whole dollars, so a $3.50 cap pays $3.
    expect(row).toMatchObject({ ratePerMile: 100, amountCents: 300 });
  });
});
