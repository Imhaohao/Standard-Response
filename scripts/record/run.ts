// Screen recordings of the app running a night in west Altadena, on an isolated stack.
//
//   npm run record                       every scene
//   npm run record -- warning optimizer  only the scenes named
//   npm run record -- --keep             leave the stack running afterwards (the next run reuses it)
//   npm run record -- --skip-build       reuse the last production build of the app
//   npm run record -- --homes 1000       how many census households to seed
//   npm run record -- --stop             stop a stack left running by --keep, and exit
//
// Output: video/recordings/<scene>-<wide|tall>.mp4, a contact sheet PNG per clip, and index.md.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startStack, stopStack } from "./stack";
import { World } from "./world";
import { launchBrowser } from "./capture";
import { SCENES, SceneResult } from "./scenes";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const outDir = path.join(root, "video", "recordings");

function parseArgs(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const valueOf = (name: string, fallback: number) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? Number(argv[at + 1]) : fallback;
  };
  const values = new Set(["--homes", "--fps"].flatMap((name) => [argv.indexOf(name) + 1]));
  const names = argv.filter((arg, i) => !arg.startsWith("--") && !values.has(i));
  return { keep: flag("keep"), build: !flag("skip-build"), stop: flag("stop"), homes: valueOf("homes", 1000), fps: valueOf("fps", 60), names };
}

function writeIndex(results: SceneResult[]) {
  const rows = results.flatMap((result) =>
    result.clips.map((clip) => `| \`${path.basename(clip.file)}\` | ${clip.seconds.toFixed(1)} s | ${clip.capturedFps.toFixed(0)} fps captured | ${result.about} |`),
  );
  const body = ["# Recordings", "", `Recorded ${new Date().toISOString()}.`, "", "| Clip | Length | Capture | What it shows |", "| --- | --- | --- | --- |", ...rows, ""];
  writeFileSync(path.join(outDir, "index.md"), body.join("\n"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.stop) return stopStack(root);
  const chosen = options.names.length > 0 ? SCENES.filter((scene) => options.names.includes(scene.name)) : SCENES;
  if (chosen.length === 0) throw new Error(`No scene named ${options.names.join(", ")}. Known: ${SCENES.map((s) => s.name).join(", ")}`);
  mkdirSync(outDir, { recursive: true });
  const stack = await startStack(root, { build: options.build });
  const world = new World(stack.convexUrl, stack.adminKey);
  const results: SceneResult[] = [];
  try {
    for (const scene of chosen) {
      console.log(`\n▶ ${scene.name}: ${scene.about}`);
      const browser = await launchBrowser();
      try {
        const result = await scene.run({ world, browser, root, outDir, appUrl: stack.appUrl, homes: options.homes, fps: options.fps });
        results.push(result);
        for (const clip of result.clips) console.log(`  ${path.relative(root, clip.file)}  ${clip.seconds.toFixed(1)} s, ${clip.capturedFps.toFixed(0)} fps captured`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await world.setSpeed(0).catch(() => undefined);
    if (!options.keep) stopStack(root);
  }
  writeIndex(results);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
