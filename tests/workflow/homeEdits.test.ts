/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { Doc } from "../../convex/_generated/dataModel";
import { registerHouseholdCounts } from "./householdCounts";

const modules = import.meta.glob("../../convex/**/*.ts");
const SEEDED_NUMBER = "+16265551001";

function setup() {
  const t = convexTest(schema, modules);
  registerHouseholdCounts(t);
  return t;
}

type T = ReturnType<typeof setup>;

async function seededHome(t: T, overrides: Partial<Doc<"households">> = {}) {
  return await t.run(async (ctx) =>
    ctx.db.insert("households", {
      address: "12 Oak St",
      callbackNumber: SEEDED_NUMBER,
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
      simulated: true,
      ...overrides,
    }),
  );
}

const homeAt = (t: T, id: Awaited<ReturnType<typeof seededHome>>) => t.run(async (ctx) => ctx.db.get("households", id));

describe("dispatcher edits on the house card", () => {
  test("a language change is saved and logged, but is not a caller's correction", async () => {
    const t = setup();
    const householdId = await seededHome(t);
    await t.mutation(api.homeEdits.save, { householdId, language: "es" });
    const home = await homeAt(t, householdId);
    expect(home?.language).toBe("es");
    expect(home?.corrections).toBeUndefined();
    const events = await t.run(async (ctx) => ctx.db.query("events").collect());
    expect(events.map((event) => event.message)).toContain("Dispatcher set 12 Oak St to Spanish");
  });

  test("only languages the call pipeline handles are accepted", async () => {
    const t = setup();
    const householdId = await seededHome(t);
    await t.mutation(api.homeEdits.save, { householdId, language: "hy" });
    expect((await homeAt(t, householdId))?.language).toBe("hy");
    await expect(t.mutation(api.homeEdits.save, { householdId, language: "de" })).rejects.toThrow("Pick a language from the list");
  });

  test("a number goes on through putRealNumber and comes back off with the stand-in restored", async () => {
    const t = setup();
    const householdId = await seededHome(t);
    expect(await t.query(api.homeEdits.numberState, { householdId })).toEqual({ keeper: null, canTakeOff: false });

    await t.mutation(api.homeEdits.save, { householdId, phone: "415-555-0195", residentName: "Jerry", language: "es" });
    expect(await homeAt(t, householdId)).toMatchObject({ callbackNumber: "+14155550195", residentName: "Jerry", language: "es", simulated: false, callStatus: "not_called", attempts: 0 });
    expect((await t.query(api.homeEdits.numberState, { householdId }))?.canTakeOff).toBe(true);

    await t.mutation(api.homeEdits.save, { householdId, phone: null, residentName: "Ignored" });
    const restored = await homeAt(t, householdId);
    expect(restored).toMatchObject({ callbackNumber: SEEDED_NUMBER, residentName: "Sim Person", simulated: true });
    expect(restored?.standIn).toBeUndefined();
  });

  test("a refused number leaves the language unsaved too", async () => {
    const t = setup();
    const householdId = await seededHome(t, { callStatus: "in_call" });
    await expect(t.mutation(api.homeEdits.save, { householdId, phone: "4155550195", language: "es" })).rejects.toThrow("Wait for the call on the line to end");
    expect(await homeAt(t, householdId)).toMatchObject({ callbackNumber: SEEDED_NUMBER, language: "en" });
  });

  test("a team phone stays with Real phones, on its house and as a new number", async () => {
    const t = setup();
    const householdId = await seededHome(t);
    const other = await seededHome(t, { address: "14 Oak St", callbackNumber: "+16265551002" });
    const numberId = await t.mutation(api.demoNumbers.add, { name: "Boris", phone: "4152230142" });

    await expect(t.mutation(api.homeEdits.save, { householdId, phone: "4152230142" })).rejects.toThrow("That's Boris's phone in Real phones");

    await t.mutation(api.demoNumbers.putOn, { numberId, householdId: other });
    expect(await t.query(api.homeEdits.numberState, { householdId: other })).toMatchObject({ keeper: { kind: "team", name: "Boris" } });
    await expect(t.mutation(api.homeEdits.save, { householdId: other, phone: null })).rejects.toThrow("This is Boris's phone from Real phones");
    await t.mutation(api.homeEdits.save, { householdId: other, language: "ko" });
    expect(await homeAt(t, other)).toMatchObject({ callbackNumber: "+14152230142", language: "ko" });
  });

  test("a judge's house keeps its number, but its language can change", async () => {
    const t = setup();
    const householdId = await seededHome(t, { callbackNumber: "+14152230199", simulated: false });
    await t.run(async (ctx) =>
      ctx.db.insert("claims", { householdId, phone: "+14152230199", claimedAt: Date.now(), record: { language: "en", outcome: "unknown" } }),
    );
    expect(await t.query(api.homeEdits.numberState, { householdId })).toMatchObject({ keeper: { kind: "judge" } });
    await expect(t.mutation(api.homeEdits.save, { householdId, phone: "4155550195" })).rejects.toThrow("A judge holds this house");
    await t.mutation(api.homeEdits.save, { householdId, language: "es" });
    expect(await homeAt(t, householdId)).toMatchObject({ callbackNumber: "+14152230199", language: "es" });
  });
});
