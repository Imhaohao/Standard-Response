// Frame capture for the recordings. A headed, GPU-backed Chrome renders the app (headless Chrome
// draws WebGL on the CPU, which is slow and can take gigabytes); the DevTools screencast streams
// every composited frame to disk with its timestamp; ffmpeg turns that variable-rate stream into
// constant-rate H.264 after the browser and the stack are down.

import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Browser, BrowserContext, CDPSession, chromium, Page } from "playwright-core";

const run = promisify(execFile);

export type Aspect = "wide" | "tall";

// Wide is 1920x1080 at 1x. Tall lays the page out at phone width and renders at 2x for 1080x1920.
export const ASPECTS: Record<Aspect, { viewport: { width: number; height: number }; scale: number; out: { width: number; height: number } }> = {
  wide: { viewport: { width: 1920, height: 1080 }, scale: 1, out: { width: 1920, height: 1080 } },
  tall: { viewport: { width: 540, height: 960 }, scale: 2, out: { width: 1080, height: 1920 } },
};

export type Clip = { file: string; sheet: string; seconds: number; frames: number; capturedFps: number };

// A finished capture waiting to be encoded: frames on disk, the moment it stopped, and how much
// faster than real time it should play.
export type Take = { frames: Frame[]; endAt: number; file: string; aspect: Aspect; speedUp: number };

type Frame = { file: string; at: number };

// Chrome stops painting a window macOS thinks is hidden; these keep it painting while it records.
const CHROME_ARGS = [
  "--use-angle=metal",
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-features=CalculateNativeWinOcclusion",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  "--window-position=0,0",
];

// The team shares one 16 GB laptop, and GPU memory comes out of the same RAM. Below this much free
// memory nothing starts; below the second line a shot in progress ends early.
const MIN_FREE_TO_START = 25;
const MIN_FREE_WHILE_FILMING = 15;

export async function freeMemoryPercent() {
  const { stdout } = await run("memory_pressure", []);
  const match = stdout.match(/free percentage:\s*(\d+)%/);
  if (!match) throw new Error("Couldn't read memory_pressure; not recording blind");
  return Number(match[1]);
}

export async function requireFreeMemory(minimum = MIN_FREE_TO_START) {
  const free = await freeMemoryPercent();
  if (free < minimum) throw new Error(`Only ${free}% of memory is free (need ${minimum}%). Close something and run again.`);
  return free;
}

export const memoryLowForFilming = async () => (await freeMemoryPercent()) < MIN_FREE_WHILE_FILMING;

// A Chrome that fell back to software WebGL draws the map on the CPU and can take the machine down.
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i;

async function gpuRenderer(browser: Browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return "no WebGL";
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return renderer;
    });
  } finally {
    await page.close();
  }
}

// Headed Chrome on the Metal GPU, or nothing: the browser is closed and the run stops otherwise.
export async function launchBrowser(): Promise<Browser> {
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: CHROME_ARGS });
  const renderer = await gpuRenderer(browser).catch((error) => `unreadable (${error})`);
  if (renderer === "no WebGL" || SOFTWARE_RENDERER.test(renderer) || renderer.startsWith("unreadable")) {
    await browser.close();
    throw new Error(`Chrome isn't drawing on the GPU (WebGL renderer: ${renderer}). Not recording.`);
  }
  console.log(`  Chrome on ${renderer}`);
  return browser;
}

export async function openPage(browser: Browser, aspect: Aspect): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport, scale } = ASPECTS[aspect];
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: "light" });
  const page = await context.newPage();
  return { context, page };
}

// The renderer of the first live WebGL canvas in the page or its frames, or null while there is none.
// Throws if the map is drawing in software, since that is the case that froze the laptop.
export async function webglReady(page: Page) {
  for (const frame of page.frames()) {
    const renderer = await frame
      .evaluate(() => {
        for (const canvas of document.querySelectorAll("canvas")) {
          const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
          if (!gl || gl.isContextLost() || gl.drawingBufferWidth === 0) continue;
          const info = gl.getExtension("WEBGL_debug_renderer_info");
          return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        }
        return null;
      })
      .catch(() => null);
    if (renderer && SOFTWARE_RENDERER.test(renderer)) throw new Error(`The map is drawing in software (${renderer}). Not recording.`);
    if (renderer) return renderer;
  }
  return null;
}

export class FrameRecorder {
  private frames: Frame[] = [];
  private session: CDPSession | null = null;

  constructor(private page: Page, private dir: string, private aspect: Aspect) {}

  // `everyNth` drops frames at the source, for long takes that will be sped up anyway.
  async start(everyNth = 1) {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    const session = await this.page.context().newCDPSession(this.page);
    this.session = session;
    session.on("Page.screencastFrame", ({ data, sessionId, metadata }) => {
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
      this.frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
      writeFileSync(file, Buffer.from(data, "base64"));
      session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    });
    const { out } = ASPECTS[this.aspect];
    await session.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: out.width, maxHeight: out.height, everyNthFrame: everyNth });
  }

  async stop(file: string, speedUp = 1): Promise<Take> {
    const stoppedAt = Date.now() / 1000;
    if (this.session) {
      await this.session.send("Page.stopScreencast").catch(() => undefined);
      await this.session.detach().catch(() => undefined);
      this.session = null;
    }
    const last = this.frames[this.frames.length - 1]?.at ?? stoppedAt;
    // Frame timestamps are wall-clock seconds; if they ever aren't, hold the last frame briefly.
    const endAt = Math.abs(stoppedAt - last) < 120 ? Math.max(stoppedAt, last + 0.02) : last + 0.5;
    return { frames: this.frames, endAt, file, aspect: this.aspect, speedUp };
  }
}

// The concat demuxer holds each frame until the next one arrives, so a still screen costs nothing
// and the output keeps real time (divided by the take's speed-up).
function concatList(take: Take) {
  const { frames, endAt, speedUp } = take;
  const lines = frames.map((frame, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].at : endAt;
    return `file '${frame.file}'\nduration ${Math.max(0.0005, (next - frame.at) / speedUp).toFixed(5)}`;
  });
  return `${lines.join("\n")}\nfile '${frames[frames.length - 1].file}'\n`;
}

export async function encode(take: Take, fps: number): Promise<Clip> {
  const { frames, aspect, file } = take;
  if (frames.length < 2) throw new Error(`Only ${frames.length} frames captured for ${file}`);
  const { out } = ASPECTS[aspect];
  const dir = path.dirname(frames[0].file);
  const list = path.join(dir, "frames.txt");
  writeFileSync(list, concatList(take));
  const filter = `fps=${fps},scale=${out.width}:${out.height}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${out.width}:${out.height}:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p`;
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", filter, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    file,
  ]);
  const realSeconds = take.endAt - frames[0].at;
  const seconds = realSeconds / take.speedUp;
  const sheet = file.replace(/\.mp4$/, ".png");
  await contactSheet(file, sheet, seconds, aspect);
  rmSync(dir, { recursive: true, force: true });
  return { file, sheet, seconds, frames: frames.length, capturedFps: frames.length / realSeconds };
}

// Sixteen evenly spaced frames, tiled, for checking a clip at a glance.
async function contactSheet(video: string, sheet: string, seconds: number, aspect: Aspect) {
  const [columns, rows, width] = aspect === "wide" ? [4, 4, 480] : [8, 2, 270];
  const every = Math.max(seconds / (columns * rows), 0.05);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", `fps=1/${every.toFixed(3)},scale=${width}:-1,tile=${columns}x${rows}:padding=4:color=white`, "-frames:v", "1", sheet]);
}
