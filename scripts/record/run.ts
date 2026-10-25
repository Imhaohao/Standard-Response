// Screen recordings of the app, on an isolated stack.
//
//   npm run record                       every live-app scene (the Eaton Fire night in west Altadena)
//   npm run record -- warning optimizer  only the scenes named
//   npm run record -- --city             every city scene from /lab/scenes, stepped frame by frame
//   npm run record -- --city hilo paradise  only those city clips
//   npm run record -- --skip-build       reuse the last production build of the app
//   npm run record -- --homes 1000       census households to seed (1000 is the most the app handles)
//   npm run record -- --stop             stop a stack a crashed run left behind, and exit
//
// Scenes run strictly one after another. Each live-app scene gets a fresh local Convex backend, the
// solver and the app; city scenes need only the app. Every clip gets its own Chrome, watched by the
// memory watchdog from launch to close, and the browser and stack stop before ffmpeg encodes.
// Output: video/recordings/<clip>-<wide|tall>.mp4, a contact sheet PNG per clip, and index.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildApp, startApp, startStack, stopStack } from "./stack";
import { World } from "./world";
import { Clip, closeBrowser, encode, launchBrowser, requireFreeMemory, Take } from "./capture";
import { Scene, SCENES } from "./scenes";
import { CITY_CLIPS, filmCityClips } from "./city";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const outDir = path.join(root, "video", "recordings");
const FPS = 60;

function parseArgs(argv: string[]) {
  const homesAt = argv.indexOf("--homes");
  const names = argv.filter((arg, i) => !arg.startsWith("--") && (homesAt < 0 || i !== homesAt + 1));
  return {
    build: !argv.includes("--skip-build"),
    stop: argv.includes("--stop"),
    city: argv.includes("--city"),
    homes: homesAt >= 0 ? Number(argv[homesAt + 1]) : 1000,
    names,
  };
}

// One row per clip; a run of some scenes replaces only their rows.
function updateIndex(name: string, about: string, clips: Clip[]) {
  const file = path.join(outDir, "index.md");
  const header = ["# Recordings", "", "| Clip | Length | Captured at | Scene | What it shows |", "| --- | --- | --- | --- | --- |"];
  const old = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line.startsWith("| `")) : [];
  const fresh = clips.map((clip) => `| \`${path.basename(clip.file)}\` | ${clip.seconds.toFixed(1)} s | ${clip.capturedFps.toFixed(0)} fps | ${name} | ${about} |`);
  const names = new Set(clips.map((clip) => path.basename(clip.file)));
  const kept = old.filter((line) => !names.has(line.slice(3, line.indexOf("`", 3))));
  writeFileSync(file, [...header, ...[...kept, ...fresh].sort(), ""].join("\n"));
}

// Films one live-app scene. Whatever was filmed before a failure is still returned for encoding.
async function film(scene: Scene, homes: number): Promise<{ takes: Take[]; error: unknown }> {
  console.log(`  ${await requireFreeMemory()}% of memory free`);
  const filmed: Take[] = [];
  let error: unknown = null;
  const stack = await startStack(root, { fresh: true });
  const world = new World(stack.convexUrl, stack.adminKey);
  try {
    const browser = await launchBrowser();
    try {
      await scene.run({ world, browser, root, outDir, appUrl: stack.appUrl, homes, filmed });
    } finally {
      await closeBrowser(browser);
    }
  } catch (caught) {
    error = caught;
  } finally {
    await world.setSpeed(0).catch(() => undefined);
    stopStack(root);
  }
  return { takes: filmed, error };
}

async function recordScenes(chosen: Scene[], homes: number) {
  for (const scene of chosen) {
    console.log(`\n▶ ${scene.name}: ${scene.about}`);
    const { takes, error } = await film(scene, homes);
    const clips: Clip[] = [];
    for (const take of takes.filter((take) => take.frames.length > 1)) {
      const clip = await encode(take, FPS);
      clips.push(clip);
      console.log(`  ${path.relative(root, clip.file)}  ${clip.seconds.toFixed(1)} s, captured at ${clip.capturedFps.toFixed(0)} fps`);
    }
    updateIndex(scene.name, scene.about, clips);
    if (error) throw error;
  }
}

async function recordCities(names: string[]) {
  const chosen = names.length > 0 ? CITY_CLIPS.filter((clip) => names.includes(clip.name)) : CITY_CLIPS;
  if (chosen.length === 0) throw new Error(`No city clip named ${names.join(", ")}. Known: ${CITY_CLIPS.map((c) => c.name).join(", ")}`);
  const appUrl = await startApp(root);
  try {
    for (const clip of chosen) {
      const [result] = await filmCityClips(appUrl, outDir, [clip]);
      updateIndex(`city ${clip.name}`, clip.about, result.clips);
    }
  } finally {
    stopStack(root);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.stop) return stopStack(root);
  const scenes = options.names.length > 0 ? SCENES.filter((scene) => options.names.includes(scene.name)) : SCENES;
  if (!options.city && scenes.length === 0) throw new Error(`No scene named ${options.names.join(", ")}. Known: ${SCENES.map((s) => s.name).join(", ")}`);
  mkdirSync(outDir, { recursive: true });
  stopStack(root);
  await requireFreeMemory();
  if (options.build) await buildApp(root);
  if (options.city) await recordCities(options.names);
  else await recordScenes(scenes, options.homes);
}

// A browser the watchdog killed can leave Playwright's pipe open, so a failed run exits outright
// instead of waiting on it.
main().catch((error) => {
  console.error(error);
  stopStack(root);
  process.exit(1);
});
