// One ensemble member of the traffic forecast, in its own worker thread (see traffic-forecast.ts).
// Each request brings the present minute and the streets known blocked; the member catches up to
// the present and answers with its hour ahead.

import { readFileSync } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { Branch, ForecastMember } from "../../lib/crowd/forecast";
import { buildGround } from "../../lib/crowd/grid";
import { Household } from "../../lib/crowd/langevin";

export type MemberSetup = { root: string; cell: number; seed: number };
export type MemberRequest = { minute: number; blocked: number[]; branchSeed: number };
export type MemberAnswer = { minute: number; households: number; branch: Branch };

const { root, cell, seed } = workerData as MemberSetup;
const households = JSON.parse(readFileSync(path.join(root, "data/population.json"), "utf8")) as Household[];
const ground = buildGround(cell, JSON.parse(readFileSync(path.join(root, "data/hazard/scenario.geojson"), "utf8")));
const member = new ForecastMember(ground, households, seed);

function buffersOf(branch: Branch) {
  return branch.windows.flatMap((w) => [w.entries.buffer, w.speedSum.buffer, w.samples.buffer, w.lost.buffer, w.edgeSpeedSum.buffer, w.edgeSamples.buffer]) as ArrayBuffer[];
}

parentPort!.on("message", ({ minute, blocked, branchSeed }: MemberRequest) => {
  member.setBlocked(new Set(blocked));
  member.advanceTo(minute);
  const branch = member.branch(branchSeed);
  const answer: MemberAnswer = { minute: member.sim.minutes, households: households.length, branch };
  parentPort!.postMessage(answer, buffersOf(branch));
});
