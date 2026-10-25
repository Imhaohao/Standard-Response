// City scenes: /lab/scenes stepped frame by frame through window.__scene, so the motion is the same
// on every run and doesn't depend on how fast this machine draws. For each output frame the
// scenario minute and the animation clock are set, the page confirms the canvas has drawn them,
// and one screenshot is taken. One fresh Chrome per clip, with the memory watchdog on throughout.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import { Aspect, ASPECTS, Clip, closeBrowser, encode, Frame, launchBrowser, openPage, requireFreeMemory, webglReady } from "./capture";
import { watchdog } from "./watchdog";

export const CITY_FPS = 30;
const MIN_FREE_FOR_CITY = 30;

// A stretch of the scenario played over `seconds` of finished footage.
type Segment = { from: number; to: number; seconds: number };

export type CityClip = {
  name: string;
  city: string;
  about: string;
  // The framing per aspect; an aspect left out isn't filmed.
  frames: Partial<Record<Aspect, string>>;
  segments: Segment[];
  replay: boolean;
};

// The reels: one vertical clip of the moment that matters in each hazard.
const REELS: CityClip[] = [
  {
    name: "tsunami-hilo",
    city: "hilo",
    about: "Hilo, 1960: the bore comes into the frame and runs up over the bayfront, slowly",
    frames: { tall: "event" },
    segments: [{ from: 266, to: 280, seconds: 14 }],
    replay: true,
  },
  {
    name: "flood-lower-ninth",
    city: "lower-ninth",
    about: "Lower Ninth Ward, Katrina: the breach, the water spreading across the ward, roofs left as islands",
    frames: { tall: "event" },
    segments: [{ from: 1045, to: 1400, seconds: 14 }],
    replay: true,
  },
  {
    name: "snowstorm-buffalo",
    city: "buffalo",
    about: "Buffalo East Side by MLK Park: the town whitening through the storm's peak, red homes and vans, past the 15:00 cutoff",
    frames: { tall: "mlk-park" },
    segments: [{ from: 120, to: 700, seconds: 14 }],
    replay: true,
  },
  {
    // The fronts reach this framing's north edge at minute 330, its east at 420 and its south at 480.
    name: "fire-eaton",
    city: "altadena",
    about: "West Altadena, the Eaton Fire: the fire runs down into the neighbourhoods while the replay's red roofs clear and vans run",
    frames: { tall: "west" },
    segments: [{ from: 300, to: 560, seconds: 15 }],
    replay: true,
  },
];

export const CITY_CLIPS: CityClip[] = [
  ...REELS,
  {
    name: "city-lower-ninth",
    city: "lower-ninth",
    about: "Lower Ninth Ward, Katrina: the Industrial Canal breach, water spreading through the ward, roofs left as islands and red roofs going out",
    frames: { wide: "event", tall: "event" },
    segments: [{ from: 1040, to: 1600, seconds: 18 }],
    replay: true,
  },
  {
    name: "city-hilo",
    city: "hilo",
    about: "Hilo, 1960 tsunami: the sea draws down off the bayfront, then the bore comes in, played slowly",
    frames: { wide: "event", tall: "event" },
    segments: [
      { from: 255, to: 267, seconds: 6 },
      { from: 267, to: 274, seconds: 14 },
    ],
    replay: true,
  },
  {
    name: "city-fort-myers-beach",
    city: "fort-myers-beach",
    about: "Fort Myers Beach, Hurricane Ian: Estero Island dry, then the storm surge rising over it and red roofs going out",
    frames: { wide: "event", tall: "event" },
    segments: [{ from: 1500, to: 1932, seconds: 18 }],
    replay: true,
  },
  {
    name: "city-buffalo-mlk",
    city: "buffalo",
    about: "Buffalo East Side blizzard around MLK Park: the town whitening under the storm, red homes and the vans",
    frames: { wide: "mlk-park", tall: "mlk-park" },
    segments: [{ from: 0, to: 700, seconds: 16 }],
    replay: true,
  },
  {
    name: "city-buffalo-overview",
    city: "buffalo",
    about: "Buffalo East Side from above: the town buried and the streets closing through the blizzard",
    frames: { wide: "overview", tall: "broadway-fillmore" },
    segments: [{ from: 330, to: 2730, seconds: 18 }],
    replay: true,
  },
  {
    name: "city-paradise",
    city: "paradise",
    about: "Paradise, the Camp Fire: the fire's fronts crossing the town from the first report to the last",
    frames: { wide: "overview", tall: "downtown" },
    segments: [{ from: 0, to: 554, seconds: 18 }],
    replay: false,
  },
  {
    name: "city-altadena",
    city: "altadena",
    about: "Altadena, the Eaton Fire night (about ten hours) at high speed with its replay: homes clearing and vans running as the fire comes down the foothills",
    frames: { wide: "overview", tall: "west" },
    segments: [{ from: 0, to: 780, seconds: 20 }],
    replay: true,
  },
];

// The scenario minute for each output frame, segment after segment.
export function minuteSchedule(segments: Segment[], fps = CITY_FPS) {
  const minutes: number[] = [];
  for (const { from, to, seconds } of segments) {
    const count = Math.round(seconds * fps);
    for (let i = 0; i < count; i++) minutes.push(from + ((to - from) * i) / count);
  }
  const last = segments[segments.length - 1];
  if (last) minutes.push(last.to);
  return minutes;
}

function sceneUrl(appUrl: string, clip: CityClip, aspect: Aspect) {
  const query = new URLSearchParams({ city: clip.city, frame: clip.frames[aspect] ?? "overview", chrome: "0", tally: "0", t: String(clip.segments[0].from) });
  if (clip.replay) query.set("replay", "1");
  return `${appUrl}/lab/scenes?${query}`;
}

async function sceneReady(page: Page) {
  await page.waitForFunction(() => window.__scene !== undefined, null, { timeout: 60_000 });
  await page.evaluate(() => Promise.race([window.__scene!.ready, new Promise((resolve) => setTimeout(resolve, 55_000))]));
  if (!(await webglReady(page))) throw new Error("The scene has no WebGL canvas; not filming the flat fallback");
}

async function stepFrames(page: Page, clip: CityClip, aspect: Aspect, dir: string) {
  const session = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  const minutes = minuteSchedule(clip.segments);
  try {
    for (const [i, minute] of minutes.entries()) {
      watchdog.assertHealthy();
      const seconds = i / CITY_FPS;
      await page.evaluate(async ([m, s]) => {
        await window.__scene!.setMinutes(m);
        await window.__scene!.setSeconds(s);
      }, [minute, seconds] as const);
      const { data } = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
      const file = path.join(dir, `${String(i).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(data, "base64"));
      frames.push({ file, at: seconds });
    }
  } finally {
    await session.detach().catch(() => undefined);
  }
  return frames;
}

async function filmCityClip(appUrl: string, outDir: string, clip: CityClip, aspect: Aspect): Promise<Clip> {
  console.log(`  ${await requireFreeMemory(MIN_FREE_FOR_CITY)}% of memory free`);
  const dir = path.join(outDir, ".frames", `${clip.name}-${aspect}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await launchBrowser();
  let frames: Frame[];
  try {
    const { page } = await openPage(browser, aspect);
    // The scene lab rewrites its own URL as it hydrates, which can abort the load event; the scene's
    // own readiness (sceneReady) is what counts.
    await page.goto(sceneUrl(appUrl, clip, aspect), { waitUntil: "commit" });
    await sceneReady(page);
    frames = await stepFrames(page, clip, aspect, dir);
  } finally {
    await closeBrowser(browser);
  }
  watchdog.assertHealthy();
  const file = path.join(outDir, `${clip.name}-${aspect}.mp4`);
  const endAt = frames[frames.length - 1].at + 1 / CITY_FPS;
  return await encode({ frames, endAt, file, aspect, speedUp: 1 }, CITY_FPS);
}

export async function filmCityClips(appUrl: string, outDir: string, clips: CityClip[]) {
  const results: { clip: CityClip; clips: Clip[] }[] = [];
  for (const clip of clips) {
    console.log(`\n▶ city ${clip.name}: ${clip.about}`);
    const filmed: Clip[] = [];
    for (const aspect of (Object.keys(ASPECTS) as Aspect[]).filter((aspect) => clip.frames[aspect])) {
      const result = await filmCityClip(appUrl, outDir, clip, aspect);
      console.log(`  ${path.basename(result.file)}  ${result.seconds.toFixed(1)} s, ${result.frames} frames`);
      filmed.push(result);
    }
    results.push({ clip, clips: filmed });
  }
  return results;
}
