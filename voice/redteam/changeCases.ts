import { writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { RecordPatch } from "../../convex/households";
import { statusLine } from "../agent/script";
import { CallSpeech, SpeechEngine } from "../phone/speech";

// The red-team change cases: what happens to a rider when the plan changes underneath a promise.
// Each case drives the real Convex contract (offers, plans, corrections) and checks the request
// status, the callbacks queued, and the exact words the rider would hear next.
//
//   REDTEAM_CONVEX_URL=http://127.0.0.1:3210 npx tsx voice/redteam/changeCases.ts [--with-expiry]
//
// It refuses to run against a cloud deployment: it creates riders and plans, which would land on
// the demo's rescue map.

const url = process.env.REDTEAM_CONVEX_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
  console.error("Set REDTEAM_CONVEX_URL to a local Convex backend (http://127.0.0.1:3210). Never the shared deployment.");
  process.exit(1);
}
const client = new ConvexHttpClient(url);
const withExpiry = process.argv.includes("--with-expiry");

type HouseholdId = Id<"households">;
type Check = { name: string; pass: boolean; detail?: string };
type CaseResult = { id: string; title: string; checks: Check[]; riderHears: string | null; pass: boolean };

let riderCounter = 0;
let stopCounter = 1000;

async function rider(mobility: string, assistance: string) {
  riderCounter += 1;
  const id = `RT-${Date.now()}-${riderCounter}`;
  const phone = `+1999555${String(riderCounter).padStart(4, "0")}`;
  const csv = `rider_id,name,address,lat,lng,phone,language,mobility,assistance\n${id},Red Team ${riderCounter},"${riderCounter} Test St, Altadena",34.19,-118.155,${phone},en,${mobility},${assistance}`;
  await client.mutation(api.riders.importCsv, { csv });
  // Finds the rider just imported by their phone number.
  return await client.mutation(api.households.findOrCreateByPhone, { callbackNumber: phone });
}

async function needsRide(householdId: HouseholdId, patch: RecordPatch) {
  await client.mutation(api.households.update, { householdId, patch: { canLeave: "no", peopleCount: 1, ...patch } });
  const request = await client.query(api.requests.forHousehold, { householdId });
  if (!request) throw new Error("No request was created for the rider");
  return request._id;
}

async function vehicleNamed(driverName: string) {
  const vehicle = (await client.query(api.vehicles.list, {})).find((v) => v.driverName === driverName);
  if (!vehicle) throw new Error(`No vehicle driven by ${driverName}`);
  return vehicle._id;
}

async function offer(requestId: Id<"requests">, vehicleId: Id<"vehicles">, replace: Id<"assignments">[] = []) {
  stopCounter += 1;
  await client.mutation(api.plans.propose, {
    solver: "heuristic",
    solveMs: 1,
    offers: [{ requestId, vehicleId, etaMinutes: 6, stopOrder: stopCounter }],
    replace,
    revoke: [],
  });
  const assignment = (await client.query(api.offers.active, {})).find((a) => a.requestId === requestId && a.status === "proposed");
  if (!assignment) throw new Error("Proposed offer not found");
  await client.mutation(api.offers.approve, { assignmentId: assignment._id });
  return assignment._id;
}

async function observe(householdId: HouseholdId) {
  const ride = await client.query(api.voice.statusFor, { householdId });
  const pending = (await client.query(api.voice.pendingCallbacks, {})).filter((c) => c.householdId === householdId);
  return { status: ride?.status ?? null, callbacks: pending.map((c) => c.announces), riderHears: statusLine(ride, "en"), driver: ride?.driver?.name };
}

const check = (name: string, pass: boolean, detail?: string): Check => ({ name, pass, detail });
const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
const NO_PROMISE = /\d+ minutes?|driver's name/i;

async function driverCancels(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("manual_wheelchair", "two_person_lift");
  const requestId = await needsRide(householdId, { mobility: "manual_wheelchair", assistanceRequired: "two_person_lift" });
  const assignmentId = await offer(requestId, await vehicleNamed("Maria"));
  await client.mutation(api.offers.accept, { assignmentId });
  await client.mutation(api.offers.cancelByDriver, { assignmentId });
  const seen = await observe(householdId);
  return {
    id: "driver_cancels",
    title: "Driver cancels an accepted pickup",
    riderHears: seen.riderHears,
    checks: [
      check("request is reassigning", seen.status === "reassigning", String(seen.status)),
      check("a reassigning callback is queued", seen.callbacks.includes("reassigning"), seen.callbacks.join(",")),
      check("rider hears no ETA or driver name", !NO_PROMISE.test(seen.riderHears ?? ""), seen.riderHears ?? ""),
    ],
  };
}

async function roadClosesAfterAccept(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("manual_wheelchair", "two_person_lift");
  const requestId = await needsRide(householdId, { mobility: "manual_wheelchair", assistanceRequired: "two_person_lift" });
  const first = await offer(requestId, await vehicleNamed("Maria"));
  await client.mutation(api.offers.accept, { assignmentId: first });
  await client.mutation(api.roads.addClosures, {
    closures: [{ path: [{ lat: 34.19, lng: -118.156 }, { lat: 34.1905, lng: -118.156 }], source: "manual" }],
  });
  await client.mutation(api.plans.propose, { solver: "heuristic", solveMs: 1, offers: [], replace: [], revoke: [first] });
  const revoked = await observe(householdId);
  const second = await offer(requestId, await vehicleNamed("Luis"));
  await client.mutation(api.offers.accept, { assignmentId: second });
  const reassigned = await observe(householdId);
  return {
    id: "road_closes_after_accept",
    title: "A road closes after acceptance; a new driver accepts",
    riderHears: reassigned.riderHears,
    checks: [
      check("revocation moves the request to reassigning", revoked.status === "reassigning", String(revoked.status)),
      check("rider is told right away (reassigning callback)", revoked.callbacks.includes("reassigning"), revoked.callbacks.join(",")),
      check("the reassigning words carry no ETA", !NO_PROMISE.test(revoked.riderHears ?? ""), revoked.riderHears ?? ""),
      check("the new acceptance returns to driver_accepted", reassigned.status === "driver_accepted", String(reassigned.status)),
      check("the new callback names the new driver", reassigned.riderHears?.includes("Luis") ?? false, reassigned.riderHears ?? ""),
    ],
  };
}

async function staleAccept(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("walker", "none");
  const requestId = await needsRide(householdId, { mobility: "walker" });
  const old = await offer(requestId, await vehicleNamed("Maria"));
  const replacement = await offer(requestId, await vehicleNamed("Luis"), [old]);
  const result = await client.mutation(api.offers.accept, { assignmentId: old });
  const seen = await observe(householdId);
  await client.mutation(api.offers.accept, { assignmentId: replacement });
  const after = await observe(householdId);
  return {
    id: "stale_acceptance",
    title: "A driver accepts an offer the plan already replaced",
    riderHears: after.riderHears,
    checks: [
      check("the stale accept returns changed", result === "changed", result),
      check("no callback fires for the stale accept", seen.callbacks.length === 0, seen.callbacks.join(",")),
      check("the rider still hears 'no driver yet'", /No driver has accepted yet/.test(seen.riderHears ?? ""), seen.riderHears ?? ""),
      check("the current offer's accept names its driver", after.driver === "Luis", String(after.driver)),
    ],
  };
}

async function duplicateAccept(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("walker", "none");
  const requestId = await needsRide(householdId, { mobility: "walker" });
  const assignmentId = await offer(requestId, await vehicleNamed("Maria"));
  const first = await client.mutation(api.offers.accept, { assignmentId });
  const second = await client.mutation(api.offers.accept, { assignmentId });
  const seen = await observe(householdId);
  return {
    id: "duplicate_accept",
    title: "The same acceptance arrives twice",
    riderHears: seen.riderHears,
    checks: [
      check("first accept succeeds", first === "accepted", first),
      check("second accept is rejected", second === "changed", second),
      check("exactly one driver_accepted callback", sameList(seen.callbacks, ["driver_accepted"]), seen.callbacks.join(",")),
    ],
  };
}

async function duplicateCancel(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("walker", "none");
  const requestId = await needsRide(householdId, { mobility: "walker" });
  const assignmentId = await offer(requestId, await vehicleNamed("Maria"));
  await client.mutation(api.offers.accept, { assignmentId });
  await client.mutation(api.offers.cancelByDriver, { assignmentId });
  await client.mutation(api.offers.cancelByDriver, { assignmentId });
  const seen = await observe(householdId);
  const reassigning = seen.callbacks.filter((c) => c === "reassigning");
  return {
    id: "duplicate_cancel",
    title: "The driver's cancel arrives twice",
    riderHears: seen.riderHears,
    checks: [
      check("exactly one reassigning callback", reassigning.length === 1, seen.callbacks.join(",")),
      check("request stays reassigning", seen.status === "reassigning", String(seen.status)),
    ],
  };
}

async function declineIsSilent(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("walker", "none");
  const requestId = await needsRide(householdId, { mobility: "walker" });
  const assignmentId = await offer(requestId, await vehicleNamed("Maria"));
  await client.mutation(api.offers.decline, { assignmentId });
  const seen = await observe(householdId);
  return {
    id: "decline_is_silent",
    title: "A driver declines before accepting",
    riderHears: seen.riderHears,
    checks: [
      check("request returns to received", seen.status === "received", String(seen.status)),
      check("no callback (the rider never heard of that driver)", seen.callbacks.length === 0, seen.callbacks.join(",")),
    ],
  };
}

async function expiryIsSilent(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("walker", "none");
  const requestId = await needsRide(householdId, { mobility: "walker" });
  await offer(requestId, await vehicleNamed("Maria"));
  await new Promise((resolve) => setTimeout(resolve, 2 * 60_000 + 5_000));
  const seen = await observe(householdId);
  return {
    id: "expiry_is_silent",
    title: "An offer expires after 2 minutes",
    riderHears: seen.riderHears,
    checks: [
      check("request returns to received", seen.status === "received", String(seen.status)),
      check("no callback", seen.callbacks.length === 0, seen.callbacks.join(",")),
    ],
  };
}

async function correctionDropsOpenOffer(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("walker", "none");
  const requestId = await needsRide(householdId, { mobility: "walker" });
  const assignmentId = await offer(requestId, await vehicleNamed("Rosa"));
  await client.mutation(api.households.update, { householdId, patch: { mobility: "manual_wheelchair" } });
  const live = (await client.query(api.offers.active, {})).find((a) => a._id === assignmentId);
  const seen = await observe(householdId);
  return {
    id: "correction_drops_open_offer",
    title: "A mid-call correction makes an open offer's vehicle unable to serve",
    riderHears: seen.riderHears,
    checks: [
      check("the incompatible offer is no longer live", live === undefined, live?.status),
      check("request is back to received", seen.status === "received", String(seen.status)),
      check("no callback (it was never accepted)", seen.callbacks.length === 0, seen.callbacks.join(",")),
    ],
  };
}

async function correctionRevokesAccepted(): Promise<Omit<CaseResult, "pass">> {
  const householdId = await rider("manual_wheelchair", "one_person_assist");
  const requestId = await needsRide(householdId, { mobility: "manual_wheelchair", assistanceRequired: "one_person_assist" });
  const assignmentId = await offer(requestId, await vehicleNamed("Maria"));
  await client.mutation(api.offers.accept, { assignmentId });
  await client.mutation(api.households.update, { householdId, patch: { mobility: "bedbound", assistanceRequired: "two_person_lift" } });
  const seen = await observe(householdId);
  return {
    id: "correction_revokes_accepted",
    title: "A correction after acceptance needs a stretcher the van doesn't have",
    riderHears: seen.riderHears,
    checks: [
      check("request is reassigning", seen.status === "reassigning", String(seen.status)),
      check("a reassigning callback is queued", seen.callbacks.includes("reassigning"), seen.callbacks.join(",")),
    ],
  };
}

// A status change while the agent is mid-sentence: the sentence playing finishes, the queued ones
// are dropped, and the template plays next. Uses a fake text-to-speech engine, no network.
async function midSentenceStatusChange(): Promise<Omit<CaseResult, "pass">> {
  const played: string[] = [];
  let contexts = 0;
  const engine: SpeechEngine = {
    speak: async (text: string, _language: string, onAudio: (audio: string) => void) => {
      contexts += 1;
      const contextId = `ctx${contexts}`;
      const done = new Promise<void>((resolve) =>
        setTimeout(() => {
          played.push(text);
          onAudio("AA==");
          resolve();
        }, 30),
      );
      return { contextId, done };
    },
    cancel: () => {},
    close: () => {},
  };
  const sink = { send: () => {}, readyState: 1, OPEN: 1 } as const;
  const speech = new CallSpeech(sink as never, "MZtest", engine);
  speech.say(["Let me read that back.", "Two people, a wheelchair, two to lift.", "Is that right?"], "en");
  await new Promise((resolve) => setTimeout(resolve, 10));
  const template = statusLine({ status: "reassigning", driver: null }, "en")!;
  speech.cutIn([template, "Is that right?"], "en");
  await new Promise((resolve) => setTimeout(resolve, 300));
  return {
    id: "status_change_mid_sentence",
    title: "The status changes while the agent is mid-sentence",
    riderHears: played.join(" | "),
    checks: [
      check("the sentence in progress finishes", played[0] === "Let me read that back.", played[0]),
      check("the template plays next", played[1] === template, played[1]),
      check("the stale queued sentences are dropped", !played.includes("Two people, a wheelchair, two to lift."), played.join(" | ")),
    ],
  };
}

const CASES = [
  driverCancels,
  roadClosesAfterAccept,
  staleAccept,
  duplicateAccept,
  duplicateCancel,
  declineIsSilent,
  correctionDropsOpenOffer,
  correctionRevokesAccepted,
  midSentenceStatusChange,
  ...(withExpiry ? [expiryIsSilent] : []),
];

async function main() {
  await client.mutation(api.control.setStandIns, {
    simulateVoice: false,
    simulateDispatch: false,
    simulateDrivers: false,
    simulateNeedModel: false,
    autoApprove: false,
  });
  await client.mutation(api.control.issueWarning, {});
  const results: CaseResult[] = [];
  for (const run of CASES) {
    try {
      const result = await run();
      results.push({ ...result, pass: result.checks.every((c) => c.pass) });
    } catch (error) {
      results.push({ id: run.name, title: run.name, riderHears: null, checks: [check("ran", false, (error as Error).message)], pass: false });
    }
  }
  for (const result of results) {
    console.log(`${result.pass ? "PASS" : "FAIL"}  ${result.title}`);
    for (const c of result.checks.filter((item) => !item.pass)) console.log(`      ✗ ${c.name}: ${c.detail ?? ""}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} change cases pass${withExpiry ? "" : " (expiry case skipped; add --with-expiry, +2 min)"}`);
  writeFileSync(
    "data/redteam-change-cases.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), passed, total: results.length, results }, null, 1),
  );
}

void main();
