/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "./householdCounts";

const modules = import.meta.glob("../../convex/**/*.ts");
const SEEDED_NUMBER = "+16265551001";

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  return t;
}

type T = ReturnType<typeof setup>;

async function seededHome(t: T, address: string, callbackNumber = SEEDED_NUMBER, simulated = true) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address,
      callbackNumber,
      residentName: "Sim Person",
      language: "en",
      callStatus: "complete",
      outcome: "unknown",
      inZone: true,
      attempts: 2,
      needPrior: 0.5,
      needProbability: 0.5,
      fireArrivalAt: Date.now(),
      callPriority: 1,
      simulated,
    }),
  );
}

describe("demo numbers", () => {
  test("a number put on a seeded house makes it real, and taking it off makes it simulated again", async () => {
    const t = setup();
    const householdId = await seededHome(t, "12 Oak St");
    const numberId = await t.mutation(api.demoNumbers.add, { name: "Boris", phone: "(415) 223-0142" });

    await t.mutation(api.demoNumbers.putOn, { numberId, householdId });
    const real = await t.run(async (ctx) => ctx.db.get("households", householdId));
    expect(real).toMatchObject({ callbackNumber: "+14152230142", residentName: "Boris", simulated: false, callStatus: "not_called", attempts: 0 });
    expect((await t.query(api.demoNumbers.list, {})).numbers[0]).toMatchObject({ home: { householdId, address: "12 Oak St" }, rememberedAddress: "12 Oak St" });

    await t.mutation(api.demoNumbers.setOn, { numberId, on: false });
    const simulated = await t.run(async (ctx) => ctx.db.get("households", householdId));
    expect(simulated).toMatchObject({ callbackNumber: SEEDED_NUMBER, residentName: "Sim Person", simulated: true });
    expect(simulated?.standIn).toBeUndefined();
  });

  test("moving a number frees the house it was on, and a real house is never overwritten", async () => {
    const t = setup();
    const first = await seededHome(t, "12 Oak St");
    const second = await seededHome(t, "14 Oak St", "+16265551002");
    const boris = await t.mutation(api.demoNumbers.add, { name: "Boris", phone: "4152230142" });
    const david = await t.mutation(api.demoNumbers.add, { name: "David", phone: "4152230143" });

    await t.mutation(api.demoNumbers.putOn, { numberId: boris, householdId: first });
    await t.mutation(api.demoNumbers.putOn, { numberId: boris, householdId: second });
    expect((await t.run(async (ctx) => ctx.db.get("households", first)))?.simulated).toBe(true);
    await expect(t.mutation(api.demoNumbers.putOn, { numberId: david, householdId: second })).rejects.toThrow();
  });

  test("a rider-list house with a fictional number goes back to a real rider with that number", async () => {
    const t = setup();
    const householdId = await seededHome(t, "12 Oak St", SEEDED_NUMBER, false);
    const numberId = await t.mutation(api.demoNumbers.add, { name: "Boris", phone: "4152230142" });
    await t.mutation(api.demoNumbers.putOn, { numberId, householdId });
    await t.mutation(api.demoNumbers.setOn, { numberId, on: false });
    expect(await t.run(async (ctx) => ctx.db.get("households", householdId))).toMatchObject({ callbackNumber: SEEDED_NUMBER, simulated: false });
  });

  test("a house made for one person joins the list, and taking its number off leaves a placeholder", async () => {
    const t = setup();
    const householdId = await seededHome(t, "3092 Olive Ave", "+16502230000", false);
    expect((await t.query(api.demoNumbers.list, {})).unlistedOnHouses).toBe(1);
    expect(await t.mutation(api.demoNumbers.addNumbersOnHouses, {})).toBe(1);
    const { numbers, unlistedOnHouses } = await t.query(api.demoNumbers.list, {});
    expect(unlistedOnHouses).toBe(0);
    expect(numbers[0]).toMatchObject({ phone: "+16502230000", home: { householdId } });

    await t.mutation(api.demoNumbers.setOn, { numberId: numbers[0]._id, on: false });
    const freed = await t.run(async (ctx) => ctx.db.get("households", householdId));
    expect(freed).toMatchObject({ callbackNumber: "+16265559000", simulated: true });
    expect(freed?.residentName).toBeUndefined();
  });

  test("switching a number off remembers its house, and on puts it back there", async () => {
    const t = setup();
    const householdId = await seededHome(t, "12 Oak St");
    const numberId = await t.mutation(api.demoNumbers.add, { name: "Boris", phone: "4152230142" });
    await t.mutation(api.demoNumbers.putOn, { numberId, householdId });

    await t.mutation(api.demoNumbers.setOn, { numberId, on: false });
    expect((await t.query(api.demoNumbers.list, {})).numbers[0]).toMatchObject({ on: false, home: null, rememberedAddress: "12 Oak St" });
    expect(await t.mutation(api.demoNumbers.putBack, {})).toBe(0);

    await t.mutation(api.demoNumbers.setOn, { numberId, on: true });
    expect((await t.query(api.demoNumbers.list, {})).numbers[0]).toMatchObject({ on: true, home: { householdId } });
  });

  test("a judge's number on a house stays out of the list", async () => {
    const t = setup();
    const householdId = await seededHome(t, "3092 Olive Ave", "+16502230000", false);
    await t.run(async (ctx) =>
      ctx.db.insert("claims", { householdId, phone: "+16502230000", claimedAt: Date.now(), record: { language: "en", outcome: "unknown" } }),
    );
    expect((await t.query(api.demoNumbers.list, {})).unlistedOnHouses).toBe(0);
    expect(await t.mutation(api.demoNumbers.addNumbersOnHouses, {})).toBe(0);
  });

  test("after a reset, put back finds each number's house by address", async () => {
    const t = setup();
    const householdId = await seededHome(t, "12 Oak St");
    const numberId = await t.mutation(api.demoNumbers.add, { name: "Boris", phone: "4152230142" });
    await t.mutation(api.demoNumbers.putOn, { numberId, householdId });

    await t.run(async (ctx) => ctx.db.delete("households", householdId));
    const reseeded = await seededHome(t, "12 Oak St");
    expect(await t.mutation(api.demoNumbers.putBack, {})).toBe(1);
    expect(await t.run(async (ctx) => ctx.db.get("households", reseeded))).toMatchObject({ callbackNumber: "+14152230142", simulated: false });
    expect(await t.mutation(api.demoNumbers.putBack, {})).toBe(0);
  });
});
