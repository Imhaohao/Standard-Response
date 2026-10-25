import type { TestConvex } from "convex-test";
import type schema from "../../convex/schema";

// The warning rings only the numbers switched on in Real phones (convex/demoNumbers.ts). Tests that put
// the team's phones on houses directly switch them on here first, as the call floor would.
export const TEAM_PHONES = ["+14252468208", "+16502234376", "+16507099911", "+16506567040"];

export async function switchOn(t: TestConvex<typeof schema>, phones: readonly string[] = TEAM_PHONES) {
  await t.run(async (ctx) => {
    for (const phone of phones) await ctx.db.insert("demoNumbers", { name: phone, phone });
  });
}
