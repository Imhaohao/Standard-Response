// Screen recordings of the app running a night in west Altadena, on an isolated stack.
//
//   npm run record                       every scene
//   npm run record -- warning optimizer  only the scenes named
//   npm run record -- --skip-build       reuse the last production build of the app
//   npm run record -- --homes 1000       how many census households to seed (1000 is the most the app handles)
//   npm run record -- --stop             stop a stack a crashed run left behind, and exit
//
// Scenes run strictly one after another. Each gets a fresh local Convex backend, the solver and the
// app; after it is filmed the browser and the whole stack stop before ffmpeg encodes, so at most one
// of each is ever alive. Output: video/recordings/<clip>-<wide|tall>.mp4, a contact sheet PNG per
// clip, and video/recordings/index.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildApp, startStack, stopStack } from "./stack";
import { World } from "./world";
import { Clip, encode, launchBrowser, requireFreeMemory, Take } from "./capture";
import { Scene, SCENES } from "./scenes";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const outDir = path.join(root, "video", "recordings");
const FPS = 60;

function parseArgs(argv: string[]) {
  const homesAt = argv.indexOf("--homes");
  const names = argv.filter((arg, i) => !arg.startsWith("--") && (homesAt < 0 || i !== homesAt + 1));
  return { build: !argv.includes("--skip-build"), stop: argv.includes("--stop"), homes: homesAt >= 0 ? Number(argv[homesAt + 1]) : 1000, names };
}

// One row per clip; a run of some scenes replaces only their rows.
function updateIndex(scene: Scene, clips: Clip[]) {
  const file = path.join(outDir, "index.md");
  const header = ["# Recordings", "", "| Clip | Length | Captured at | Scene | What it shows |", "| --- | --- | --- | --- | --- |"];
  const old = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.startsWith("| `")) : [];
  const fresh = clips.map((clip) => `| \`${path.basename(clip.file)}\` | ${clip.seconds.toFixed(1)} s | ${clip.capturedFps.toFixed(0)} fps | ${scene.name} | ${scene.about} |`);
  const names = new Set(clips.map((clip) => path.basename(clip.file)));
  const kept = old.filter((line) => !names.has(line.slice(3, line.indexOf("`", 3))));
  writeFileSync(file, [...header, ...[...kept, ...fresh].sort(), ""].join("\n"));
}

async function film(scene: Scene, homes: number): Promise<Take[]> {
  console.log(`  ${await requireFreeMemory()}% of memory free`);
  const stack = await startStack(root, { fresh: true });
  const world = new World(stack.convexUrl, stack.adminKey);
  const browser = await launchBrowser();
  try {
    return await scene.run({ world, browser, root, outDir, appUrl: stack.appUrl, homes });
  } finally {
    await browser.close().catch(() => undefined);
    await world.setSpeed(0).catch(() => undefined);
    stopStack(root);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.stop) return stopStack(root);
  const chosen = options.names.length > 0 ? SCENES.filter((scene) => options.names.includes(scene.name)) : SCENES;
  if (chosen.length === 0) throw new Error(`No scene named ${options.names.join(", ")}. Known: ${SCENES.map((s) => s.name).join(", ")}`);
  mkdirSync(outDir, { recursive: true });
  stopStack(root);
  await requireFreeMemory();
  if (options.build) await buildApp(root);
  for (const scene of chosen) {
    console.log(`\n▶ ${scene.name}: ${scene.about}`);
    const takes = await film(scene, options.homes);
    const clips: Clip[] = [];
    for (const take of takes) {
      const clip = await encode(take, FPS);
      clips.push(clip);
      console.log(`  ${path.relative(root, clip.file)}  ${clip.seconds.toFixed(1)} s, captured at ${clip.capturedFps.toFixed(0)} fps`);
    }
    updateIndex(scene, clips);
  }
}

main().catch((error) => {
  console.error(error);
  stopStack(root);
  process.exitCode = 1;
});
