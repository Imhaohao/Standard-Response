// Traffic forecast runner for the agency view (/mesh/agency). Follows the live incident with an
// ensemble of Langevin crowd simulations of the synthetic town, one worker thread per member, and
// every few minutes runs each member an hour ahead and publishes the ranges through
// `mesh:publishTrafficForecast`.
//
//   npm run forecast:traffic                          # every 5 minutes against .env.local's deployment
//   npm run forecast:traffic -- --members 4 --every 2
//   npm run forecast:traffic -- --once
//
// Blocked streets are what the agency knows now: confirmed road closures and streets the phone
// mesh reports blocked. Minute 0 is the warning, on the night's clock (lib/sim-clock.ts) like the
// scenario fire, so a paused or sped-up night is followed. The dispatcher reads each forecast's
// per-direction slowdowns for its drive times (convex/traffic.ts).
// It forecasts a simulation, not measured traffic.

import path from "node:path";
import { Worker } from "node:worker_threads";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { closedEdgesFor, edgeKeysOf } from "../../convex/roadGraph";
import { branchSeed, memberSeed, summarize, TrafficForecast } from "../../lib/crowd/forecast";
import { SIM_MINUTES_PER_SECOND } from "../../lib/ink-map/hazard";
import { SEGMENT_INDEX, SEGMENT_LIST, segmentKeyOf } from "../../lib/mesh/roads";
import { SimClock, simTime } from "../../lib/sim-clock";
import type { MemberAnswer, MemberRequest, MemberSetup } from "./traffic-forecast-member";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (name: string, fallback: number) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? Number(process.argv[index + 1]) : fallback;
};
const MEMBERS = arg("members", 6);
const EVERY_MINUTES = arg("every", 5);
const CELL = arg("cell", 20);
const SEED = arg("seed", 1);
const ONCE = process.argv.includes("--once");
const IDLE_MS = 30_000;

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
if (!url) throw new Error("Set NEXT_PUBLIC_CONVEX_URL or CONVEX_URL (npm run forecast:traffic reads .env.local)");
const client = new ConvexHttpClient(url);

const log = (message: string) => console.log(`${new Date().toLocaleTimeString()} ${message}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function addSegments(into: Set<number>, edgeKeys: string[]) {
  for (const key of edgeKeys) {
    const index = SEGMENT_INDEX.get(segmentKeyOf(key));
    if (index !== undefined) into.add(index);
  }
}

// Segment indices the agency knows are blocked right now.
async function knownBlocked(now: number) {
  const [closures, mesh] = await Promise.all([client.query(api.roads.closures, {}), client.query(api.mesh.roads, { now: Math.floor(now / 60_000) * 60_000 })]);
  const blocked = new Set<number>();
  for (const closure of closures) {
    if (closure.confirmed) addSegments(blocked, closure.edgeKeys ?? edgeKeysOf(closedEdgesFor(closure)));
  }
  for (const street of mesh.segments) {
    const index = SEGMENT_INDEX.get(street.segment);
    if (street.status === "blocked" && index !== undefined) blocked.add(index);
  }
  return blocked;
}

// `now` and `warningIssuedAt` are on the night's clock.
const minuteOf = (warningIssuedAt: number, now: number) => Math.max(0, ((now - warningIssuedAt) / 1000) * SIM_MINUTES_PER_SECOND);
const atMinute = (warningIssuedAt: number, minute: number) => warningIssuedAt + (minute / SIM_MINUTES_PER_SECOND) * 1000;

// A worker thread holding one member; one request at a time.
class Member {
  private readonly worker: Worker;

  constructor(seed: number) {
    const setup: MemberSetup = { root, cell: CELL, seed };
    this.worker = new Worker(new URL("./traffic-forecast-member.ts", import.meta.url), { workerData: setup });
  }

  request(request: MemberRequest) {
    return new Promise<MemberAnswer>((resolve, reject) => {
      const fail = (error: Error) => {
        this.worker.off("message", done);
        reject(error);
      };
      const done = (answer: MemberAnswer) => {
        this.worker.off("error", fail);
        resolve(answer);
      };
      this.worker.once("message", done);
      this.worker.once("error", fail);
      this.worker.postMessage(request);
    });
  }

  stop() {
    void this.worker.terminate();
  }
}

type Incident = { warningIssuedAt: number; members: Member[]; forecasts: number };

function startIncident(warningIssuedAt: number, previous: Incident | null): Incident {
  for (const member of previous?.members ?? []) member.stop();
  log(`warning at ${new Date(warningIssuedAt).toLocaleTimeString()}: ${MEMBERS} simulations of the town, one thread each`);
  return { warningIssuedAt, members: Array.from({ length: MEMBERS }, (_, k) => new Member(memberSeed(SEED, k))), forecasts: 0 };
}

async function publish(incident: Incident, forecast: TrafficForecast, blocked: number, computeSeconds: number) {
  await client.mutation(api.mesh.publishTrafficForecast, {
    ...forecast,
    issuedAt: Date.now(),
    warningIssuedAt: incident.warningIssuedAt,
    baseAt: atMinute(incident.warningIssuedAt, forecast.baseMinute),
    blockedSegments: blocked,
    computeSeconds,
  });
  const next = forecast.windows[0].streets[0];
  const moving = forecast.timeline[forecast.timeline.length - 1].moving.median;
  log(`forecast from minute ${forecast.baseMinute.toFixed(0)} in ${computeSeconds.toFixed(0)} s: ${moving} cars on the road in an hour, slowest next: ${next?.name ?? "none"}`);
}

async function pass(incident: Incident, clock: SimClock | undefined) {
  const started = Date.now();
  // Phones stamp mesh reports on the wall clock, so their lookup stays on it.
  const blocked = [...(await knownBlocked(started))];
  const now = simTime(clock, started);
  const minute = minuteOf(incident.warningIssuedAt, now);
  incident.forecasts += 1;
  const answers = await Promise.all(
    incident.members.map((member, k) => member.request({ minute, blocked, branchSeed: branchSeed(SEED, incident.forecasts, k) })),
  );
  const baseMinute = Math.min(...answers.map((answer) => answer.minute));
  const forecast = summarize(answers.map((answer) => answer.branch), SEGMENT_LIST, baseMinute, answers[0].households);
  await publish(incident, forecast, blocked.length, (Date.now() - started) / 1000);
}

async function main() {
  let incident: Incident | null = null;
  for (;;) {
    const control = await client.query(api.control.get, {});
    const warningIssuedAt = control.warningIssuedAt;
    if (warningIssuedAt === undefined) {
      if (ONCE) return log("no warning issued; nothing to forecast");
      log("no warning issued; waiting");
      await sleep(IDLE_MS);
      continue;
    }
    if (incident?.warningIssuedAt !== warningIssuedAt) incident = startIncident(warningIssuedAt, incident);
    const started = Date.now();
    await pass(incident, control.clock);
    if (ONCE) return process.exit(0);
    await sleep(Math.max(0, EVERY_MINUTES * 60_000 - (Date.now() - started)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
