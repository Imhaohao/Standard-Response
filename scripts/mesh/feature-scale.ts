// Recomputes FEATURE_CENTER and FEATURE_SCALE in lib/mesh/federated.ts: the mean and spread of each
// model feature over every street, every 15 minutes from the warning to five hours after it, from
// public inputs only (the road graph and the fire scenario).
//
//   npx tsx scripts/mesh/feature-scale.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { rawFeaturesOf } from "../../lib/mesh/federated";
import { NEVER_BURNS } from "../../lib/ink-map/fire-field";
import { nearbyBlockedShare, SEGMENT_LIST } from "../../lib/mesh/roads";
import { segmentFireMinutes } from "../../lib/mesh/street-features";
import { BlockageWorld } from "../../lib/flow/blockage";
import { buildGround } from "../../lib/crowd/grid";
import { seededRandom } from "../../lib/mesh/random";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const scenario = JSON.parse(readFileSync(path.join(root, "data/hazard/scenario.geojson"), "utf8"));
const fire = segmentFireMinutes(scenario);
// The nearby-blocked share needs some blockage pattern; the simulated one stands in for it.
const blockage = new BlockageWorld(buildGround(20, scenario), seededRandom(1));

const rows: number[][] = [];
for (let minutes = 0; minutes <= 300; minutes += 15) {
  const blocked = blockage.blockedAt(minutes);
  SEGMENT_LIST.forEach((segment, i) => {
    rows.push(
      rawFeaturesOf({
        minutesToFire: fire[i] >= NEVER_BURNS ? NEVER_BURNS : fire[i] - minutes,
        kph: segment.kph,
        lanes: segment.lanes,
        minutesSinceWarning: minutes,
        nearbyBlockedShare: nearbyBlockedShare(i, (j) => blocked.has(j)),
      }),
    );
  });
}
const dims = rows[0].length;
const mean = Array.from({ length: dims }, (_, d) => rows.reduce((sum, row) => sum + row[d], 0) / rows.length);
const spread = Array.from({ length: dims }, (_, d) => Math.sqrt(rows.reduce((sum, row) => sum + (row[d] - mean[d]) ** 2, 0) / rows.length));
const fmt = (values: number[], first: number) => `[${values.map((v, d) => (d === 0 ? first : Number(v.toFixed(3)))).join(", ")}]`;
console.log(`export const FEATURE_CENTER = ${fmt(mean, 0)};`);
console.log(`export const FEATURE_SCALE = ${fmt(spread, 1)};`);
