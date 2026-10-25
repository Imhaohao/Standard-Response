import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AREA } from "../../convex/model";

// Runs the "California evacuation status" Actor on this machine against our backend, with the real
// public sources for west Altadena plus drill mode, so a practice zone or road closure arrives the
// same way a real one would: through the Actor's webhooks into convex/http.ts.
//
//   npm run apify:drill -- zone       a practice warning zone over the calling area: starts Rider Check
//   npm run apify:drill -- closure    also a practice full closure along one block of Lincoln Avenue
//   npm run apify:drill -- clear      no practice records: the closure is reported lifted and reopens
//
// The Actor's sent-state lives in a local storage folder kept per backend, so each run sends only
// what changed for that backend, and a drill sent to one backend is still sent to another.
// It posts to NEXT_PUBLIC_CONVEX_SITE_URL (or CONVEX_SITE_URL) with APIFY_WEBHOOK_SECRET, which must
// match the backend's own APIFY_WEBHOOK_SECRET.

const ACTOR_DIR = "apify/california-evacuation-status";

// Relative to the Actor's folder, where the Actor runs.
const storageFor = (siteUrl: string) => join("storage", `drill-${new URL(siteUrl).host.replace(/[^a-z0-9]+/gi, "-")}`);

// One block of Lincoln Avenue on the road graph, [longitude, latitude].
const LINCOLN_BLOCK: [number, number][] = [
  [-118.15957, 34.16982],
  [-118.15956, 34.16841],
];

const ZONE_RING: [number, number][] = [
  [AREA.west, AREA.south],
  [AREA.east, AREA.south],
  [AREA.east, AREA.north],
  [AREA.west, AREA.north],
];

type Mode = "zone" | "closure" | "clear";

function modeFrom(argv: string[]): Mode {
  const mode = argv[0];
  if (mode === "zone" || mode === "closure" || mode === "clear") return mode;
  throw new Error("Usage: npm run apify:drill -- zone | closure | clear");
}

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is not set. Add it to .env.local.`);
  return value;
}

function inputFor(mode: Mode, siteUrl: string, secret: string) {
  const site = siteUrl.replace(/\/$/, "");
  return {
    counties: ["Los Angeles"],
    boundingBox: { west: AREA.west - 0.02, south: AREA.south - 0.02, east: AREA.east + 0.02, north: AREA.north + 0.02 },
    webhookUrl: `${site}/apify/zone-status`,
    closureWebhookUrl: `${site}/apify/road-closures`,
    webhookSecret: secret,
    drill: mode !== "clear",
    drillPolygon: mode === "clear" ? undefined : ZONE_RING,
    drillZoneName: "West Altadena drill",
    drillClosure: mode === "closure" ? LINCOLN_BLOCK : undefined,
    drillClosureName: "Lincoln Ave drill closure",
  };
}

function main() {
  const mode = modeFrom(process.argv.slice(2));
  const siteUrl = required("NEXT_PUBLIC_CONVEX_SITE_URL", process.env.CONVEX_SITE_URL || process.env.NEXT_PUBLIC_CONVEX_SITE_URL);
  const secret = required("APIFY_WEBHOOK_SECRET", process.env.APIFY_WEBHOOK_SECRET);
  const storage = storageFor(siteUrl);
  const inputDir = join(ACTOR_DIR, storage, "key_value_stores", "default");
  mkdirSync(inputDir, { recursive: true });
  writeFileSync(join(inputDir, "INPUT.json"), JSON.stringify(inputFor(mode, siteUrl, secret), null, 2));
  console.log(`Running the Actor (${mode}) against ${siteUrl}`);
  const env = { ...process.env, CRAWLEE_STORAGE_DIR: storage };
  const run = spawnSync("npx", ["tsx", "src/main.ts"], { cwd: ACTOR_DIR, stdio: "inherit", env });
  const output = JSON.parse(readFileSync(join(inputDir, "OUTPUT.json"), "utf8"));
  console.log(`\nZones webhook: ${JSON.stringify(output.webhook)}\nClosure webhook: ${JSON.stringify(output.closureWebhook)}`);
  process.exitCode = run.status ?? 1;
}

main();
