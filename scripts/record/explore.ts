import path from "node:path";
import { readFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { World, sleep } from "./world";
import { launchBrowser, openPage, webglPainted } from "./capture";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const state = JSON.parse(readFileSync(path.join(root, "video/recordings/.stack/state.json"), "utf8"));
const shots = process.env.SHOTS ?? "/tmp";
const app = "http://127.0.0.1:3340";

async function main() {
  const world = new World("http://127.0.0.1:3330", state.adminKey);
  const step = process.argv[2];
  if (step === "seed") {
    const started = Date.now();
    const n = await world.freshTown(root, Number(process.argv[3] ?? 1000), 6);
    console.log("seeded", n, "in", (Date.now() - started) / 1000, "s");
    return;
  }
  if (step === "call") {
    const [, , , mod, fn, args] = process.argv;
    const ref = (api as unknown as Record<string, Record<string, never>>)[mod][fn];
    const kind = process.argv[6] ?? "mutation";
    console.log(JSON.stringify(kind === "query" ? await world.query(ref, JSON.parse(args ?? "{}")) : await world.mutation(ref, JSON.parse(args ?? "{}"))).slice(0, 2000));
    return;
  }
  if (step === "shot") {
    const browser = await launchBrowser();
    try {
      for (const spec of process.argv.slice(3)) {
        const [route, aspect = "wide", wait = "8000"] = spec.split("@");
        const { context, page } = await openPage(browser, aspect as "wide" | "tall");
        await page.goto(`${app}${route}`);
        await sleep(Number(wait));
        console.log(route, "webgl", await webglPainted(page));
        await page.screenshot({ path: path.join(shots, `${route.replace(/\//g, "_") || "root"}-${aspect}.png`) });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
