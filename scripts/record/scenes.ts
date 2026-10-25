// The scenes. Each starts on an empty isolated backend, seeds the census town, drives the night
// through Convex functions and the sim clock, and films one or more pages. Clicks happen only where
// the click is the point of the shot, found by accessible role and name.

import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { Aspect, FrameRecorder, memoryLowForFilming, openPage, Take, webglReady } from "./capture";
import { sleep, Speed, World } from "./world";

export type SceneContext = { world: World; browser: Browser; root: string; outDir: string; appUrl: string; homes: number };
export type Scene = { name: string; about: string; run: (context: SceneContext) => Promise<Take[]> };

// On top of the eight-vehicle demo fleet. 14 vehicles for about a hundred riders in a thousand homes
// is close to the README's 25 vans for 662 riders.
const EXTRA_VANS = 6;

type Shot = { name: string; aspect: Aspect; route: string; map?: boolean; speedUp?: number; everyNth?: number };

const framesDir = (context: SceneContext, name: string) => path.join(context.outDir, ".frames", name);

// Nothing dev-only reaches the frame; the caret and focus rings stay off a screen nobody types on.
const CLEAN_CSS = "nextjs-portal{display:none!important} *{caret-color:transparent!important}";

async function waitForPage(page: Page, map: boolean) {
  await page.waitForLoadState("load");
  await page.addStyleTag({ content: CLEAN_CSS });
  if (map) {
    const until = Date.now() + 45_000;
    while (!(await webglReady(page)) && Date.now() < until) await sleep(500);
    if (!(await webglReady(page))) console.warn("  (no WebGL canvas: the map fell back to the flat view)");
  }
  // Fonts, the baked map and the first Convex results.
  await sleep(map ? 6000 : 3000);
}

async function loadPage(context: SceneContext, shot: Pick<Shot, "aspect" | "route" | "map">): Promise<{ browserContext: BrowserContext; page: Page }> {
  const { context: browserContext, page } = await openPage(context.browser, shot.aspect);
  await page.goto(`${context.appUrl}${shot.route}`);
  await waitForPage(page, shot.map ?? false);
  return { browserContext, page };
}

// Films one page while `action` drives the night, then closes the page.
async function film(context: SceneContext, shot: Shot, action: (page: Page) => Promise<void>): Promise<Take> {
  const { browserContext, page } = await loadPage(context, shot);
  try {
    return await filmPage(context, page, shot, action);
  } finally {
    await browserContext.close();
  }
}

async function filmPage(context: SceneContext, page: Page, shot: Shot, action: (page: Page) => Promise<void>): Promise<Take> {
  const recorder = new FrameRecorder(page, framesDir(context, `${shot.name}-${shot.aspect}`), shot.aspect);
  await recorder.start(shot.everyNth ?? 1);
  const watch = { filming: true };
  // A failed step still keeps what was filmed up to it, and the screencast never outlives the shot.
  const acted = action(page).catch((error) => console.warn(`  (${shot.name}: ${error instanceof Error ? error.message.split("\n")[0] : error})`));
  const memoryRanLow = await Promise.race([acted.then(() => false), memoryWatch(watch)]);
  watch.filming = false;
  const take = await recorder.stop(path.join(context.outDir, `${shot.name}-${shot.aspect}.mp4`), shot.speedUp ?? 1);
  if (memoryRanLow) throw new Error(`Free memory fell under the filming floor during ${shot.name}; stopped everything`);
  return take;
}

// Resolves true if free memory runs low while the shot is filming.
async function memoryWatch(watch: { filming: boolean }) {
  while (watch.filming) {
    if (await memoryLowForFilming()) return true;
    await sleep(3000);
  }
  return false;
}

async function seed(context: SceneContext) {
  const homes = await context.world.seedTown(context.root, context.homes, EXTRA_VANS);
  console.log(`  seeded ${homes} census homes and ${8 + EXTRA_VANS} vehicles`);
}

// Runs the night off camera until `ready` says the scene can start, at `speed`.
async function fastForward(world: World, speed: Speed, label: string, ready: () => Promise<boolean>, timeoutMs = 240_000) {
  await world.setSpeed(speed);
  await world.waitUntil(label, ready, timeoutMs, 1000);
}

async function holdFor(seconds: number) {
  await sleep(seconds * 1000);
}

// Holds until `done` or `maxSeconds`, whichever comes first, checking every second.
async function holdUntil(world: World, maxSeconds: number, done: () => Promise<boolean>) {
  await world.waitUntil("the shot's end", done, maxSeconds * 1000, 1000);
}

async function openRequestCount(world: World) {
  return (await world.openRequests()).length;
}

const census: Scene = {
  name: "census",
  about: "The Ready check calling every home in west Altadena before any warning: profiles fill in on the rescue map and the call floor",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    const map = await film(context, { name: "census", aspect: "wide", route: "/map", map: true, speedUp: 2 }, async () => {
      await holdFor(2);
      await world.startReadyCheck();
      await world.setSpeed(60);
      const target = Math.round(context.homes * 0.7);
      await holdUntil(world, 100, async () => (await world.readyProfiles()) >= target);
      await holdFor(3);
    });
    await world.setSpeed(0);
    const floor = await film(context, { name: "census-floor", aspect: "wide", route: "/dashboard", map: true }, async () => {
      await world.setSpeed(30);
      await holdFor(30);
    });
    return [map, floor];
  },
};

const warning: Scene = {
  name: "warning",
  about: "The warning goes out: the zone is set, calls fan out across the town, the call floor fills with live calls, transcripts and the reach ladder",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    await world.drawWarningZone();
    const floor = await film(context, { name: "warning", aspect: "wide", route: "/dashboard", map: true }, async (page) => {
      await holdFor(3);
      await page.getByRole("button", { name: /Issue evacuation warning/ }).click();
      await holdFor(6);
      await world.setSpeed(10);
      await holdFor(15);
      await world.setSpeed(30);
      await holdFor(25);
    });
    await world.setSpeed(0);
    return [floor];
  },
};

const warningMap: Scene = {
  name: "warning-map",
  about: "The rescue map as the warning zone is drawn and the calls start: roofs turn red where people need a ride",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    const map = await film(context, { name: "warning-map", aspect: "wide", route: "/map", map: true, speedUp: 1.5 }, async () => {
      await holdFor(2);
      await world.drawWarningZone();
      await holdFor(3);
      await world.issueWarning();
      await holdFor(4);
      await world.setSpeed(30);
      await holdFor(45);
    });
    await world.setSpeed(0);
    return [map];
  },
};

const optimizer: Scene = {
  name: "optimizer",
  about: "The optimizer at work on the rescue map: ride requests in red, plan versions and solve time ticking, a dispatcher approving offers, vans driving the streets",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    await world.setAutoApprove(false);
    await world.drawWarningZone();
    await world.issueWarning();
    await fastForward(world, 30, "a dozen ride requests", async () => (await openRequestCount(world)) >= 12);
    await world.setSpeed(10);
    const map = await film(context, { name: "optimizer", aspect: "wide", route: "/map", map: true }, async (page) => {
      await holdFor(6);
      const approve = page.getByRole("button", { name: /^Approve \d+ vans?$/ });
      await approve.first().click({ timeout: 20_000 }).catch(() => console.warn("  (no offers waiting for approval)"));
      await world.setAutoApprove(true);
      await holdFor(10);
      await world.setSpeed(30);
      await holdFor(30);
    });
    await world.setSpeed(0);
    return [map];
  },
};

// Two phones' worth of page side by side on one 1920x1080 frame: the driver and the call floor.
function compositeHtml(appUrl: string, driverRoute: string, rightRoute: string) {
  return `<!doctype html><html><body style="margin:0;background:#ece6da;display:flex;gap:24px;padding:0;height:100vh;overflow:hidden">
<iframe id="left" src="${appUrl}${driverRoute}" style="border:0;width:540px;height:960px;transform:scale(1.125);transform-origin:0 0;flex:none"></iframe>
<iframe id="right" src="${appUrl}${rightRoute}" style="border:0;flex:1;height:1080px;margin-left:83px"></iframe>
</body></html>`;
}

async function untilMariaHasAnOffer(world: World) {
  const maria = await world.vehicleOf("Maria");
  const hasOffer = async () => {
    const board = await world.offersFor(maria);
    return JSON.stringify(board).includes('"offered"');
  };
  return { maria, hasOffer };
}

const driver: Scene = {
  name: "driver",
  about: "A driver accepts: Maria's phone gets a ride offer, she taps Accept, the run appears; the call floor logs the resident's callback",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    await world.drawWarningZone();
    await world.issueWarning();
    const { maria, hasOffer } = await untilMariaHasAnOffer(world);
    await fastForward(world, 30, "an offer on Maria's van", hasOffer, 300_000);
    await world.setSpeed(1);
    const takes: Take[] = [];
    const accept = async (page: Pick<Page, "getByRole">) => {
      await holdFor(4);
      await page.getByRole("button", { name: /^Accept/ }).first().click({ timeout: 30_000 });
      await holdFor(4);
      await world.setSpeed(10);
      await holdFor(12);
    };
    takes.push(
      await film(context, { name: "driver", aspect: "tall", route: "/driver", map: true }, async (page) => {
        await page.getByLabel("Driving as").selectOption(maria);
        await accept(page);
      }),
    );
    await world.setSpeed(30);
    await world.waitUntil("another offer on Maria's van", hasOffer, 240_000, 1000);
    await world.setSpeed(1);
    const { context: browserContext, page } = await openPage(context.browser, "wide");
    try {
      await page.setContent(compositeHtml(context.appUrl, "/driver", "/dashboard"));
      await waitForPage(page, true);
      await page.frameLocator("#left").getByLabel("Driving as").selectOption(maria);
      await page.frameLocator("#right").getByRole("tab", { name: /Activity/ }).click().catch(() => undefined);
      await holdFor(2);
      takes.push(await filmPage(context, page, { name: "driver-floor", aspect: "wide", route: "" }, async () => accept(page.frameLocator("#left"))));
    } finally {
      await browserContext.close();
    }
    await world.setSpeed(0);
    return takes;
  },
};

const NIGHT_SPEED_UP = 4;

const night: Scene = {
  name: "night",
  about: "The whole night at 60x then sped up 4x: the fire advances over west Altadena while homes clear and vans run, ending on the count",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    await world.drawWarningZone();
    const map = await film(context, { name: "night", aspect: "wide", route: "/map", map: true, speedUp: NIGHT_SPEED_UP, everyNth: 2 }, async () => {
      await holdFor(3);
      await world.issueWarning();
      await world.setSpeed(60);
      // The scenario's last front is 270 minutes after the warning: 4.5 minutes of wall clock at 60x.
      await holdFor(285);
      await world.setSpeed(0);
      await holdFor(8);
    });
    const deck = await film(context, { name: "outcome", aspect: "wide", route: "/present?slide=7&beat=1" }, async (page) => {
      await holdFor(4);
      await page.keyboard.press("ArrowRight");
      await holdFor(6);
      await page.keyboard.press("ArrowRight");
      await holdFor(8);
    });
    return [map, deck];
  },
};

const underTheHood: Scene = {
  name: "system",
  about: "Under the hood during a busy night: re-plans with request and vehicle counts, solve times, callback timing and the audit trail",
  run: async (context) => {
    const { world } = context;
    await seed(context);
    await world.drawWarningZone();
    await world.issueWarning();
    await fastForward(world, 30, "twenty ride requests", async () => (await openRequestCount(world)) >= 20);
    const system = await film(context, { name: "system", aspect: "wide", route: "/system" }, async () => {
      await holdFor(40);
    });
    const phone = await film(context, { name: "phone", aspect: "tall", route: "/phone" }, async () => {
      await holdFor(25);
    });
    await world.setSpeed(0);
    return [system, phone];
  },
};

const flow: Scene = {
  name: "flow",
  about: "The crowd flow lab: the town's evacuation traffic on the streets",
  run: async (context) => [await film(context, { name: "flow", aspect: "wide", route: "/flow", map: true }, async () => holdFor(30))],
};

export const SCENES: Scene[] = [census, warning, warningMap, optimizer, driver, night, underTheHood, flow];
