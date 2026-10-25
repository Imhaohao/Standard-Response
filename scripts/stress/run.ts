// Convex stress test: conflicting writes from many clients at once against the real contract.
//
//   npm run stress:convex                      every scenario on a throwaway local backend
//   npm run stress:convex -- double-accept     only the scenarios named
//   npm run stress:convex -- --keep            leave the backend's temp directory for its log
//
// It starts its own Convex backend (the binary `npx convex dev --local` downloads) on free ports
// with an empty database and deploys convex/ to it, so the team's deployment is never written to.
// The stand-in loops stay off: nothing here places a call, sends a text or reaches a solver.

import path from "node:path";
import { api, internal } from "../../convex/_generated/api";
import { startBackend } from "./backend";
import { asPublic, Lab } from "./lab";
import { SCENARIOS } from "./scenarios";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.filter((a) => !a.startsWith("--"));
const chosen = only.length > 0 ? SCENARIOS.filter((s) => only.includes(s.name)) : SCENARIOS;

async function prepare(lab: Lab) {
  // An empty database: create the control row with every stand-in off, then the fleet.
  await lab.must(api.control.setStandIns, { simulateVoice: false, simulateNeedModel: false, simulateDispatch: false, simulateDrivers: false, autoApprove: true });
  await lab.must(api.vehicles.ensureFleet, {});
  await lab.must(asPublic(internal.householdCounts.backfill), {});
  return { vehicles: await lab.query(api.vehicles.list, {}) };
}

async function main() {
  if (chosen.length === 0) throw new Error(`No scenario named ${only.join(", ")}. Known: ${SCENARIOS.map((s) => s.name).join(", ")}`);
  console.log("Starting a throwaway Convex backend and deploying convex/ …");
  const backend = await startBackend(root);
  let failed = 0;
  try {
    const lab = new Lab(backend.url, backend.adminKey);
    const world = await prepare(lab);
    console.log(`Backend at ${backend.url}, ${world.vehicles.length} vehicles\n`);
    for (const scenario of chosen) {
      lab.scenario = scenario.name;
      const before = { checks: lab.checks.length, calls: lab.calls.total };
      const started = Date.now();
      try {
        await scenario.run(lab, world);
      } catch (error) {
        lab.expect(false, `scenario ran to the end (${error instanceof Error ? error.message : error})`);
      }
      const checks = lab.checks.slice(before.checks);
      const broken = checks.filter((c) => !c.ok);
      failed += broken.length;
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`${broken.length === 0 ? "PASS" : "FAIL"}  ${scenario.name}  (${checks.length} checks, ${lab.calls.total - before.calls} calls, ${seconds}s)`);
      console.log(`      ${scenario.about}`);
      const conflicts = lab.conflicts[scenario.name];
      if (conflicts) console.log(`      writes that gave up on a conflict, by table: ${JSON.stringify(conflicts)}`);
      for (const check of broken.slice(0, 8)) console.log(`      ✗ ${check.message}`);
      if (broken.length > 8) console.log(`      … and ${broken.length - 8} more`);
    }
    console.log(`\n${lab.checks.length - failed} of ${lab.checks.length} checks held across ${lab.calls.total} calls (${lab.setupRetries} setup writes retried after a conflict).`);
  } finally {
    backend.stop(keep);
    if (keep) console.log(`Backend files kept in ${backend.dir}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
