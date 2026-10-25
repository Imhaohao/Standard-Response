import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAKED_FILE, bakedSource } from "./bake-scenarios";

test("convex/scenarioFronts.ts matches data/hazard", () => {
  assert.equal(readFileSync(BAKED_FILE, "utf8"), bakedSource(), "Rerun `npx tsx scripts/hazard/bake-scenarios.ts`");
});
