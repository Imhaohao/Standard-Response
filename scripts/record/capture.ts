// Frame capture for the recordings. A headed, GPU-backed Chrome renders the app (the map is WebGL,
// and headless software rendering drops it); the DevTools screencast streams every composited frame
// to disk with its timestamp; ffmpeg turns that variable-rate stream into constant-rate H.264.

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

export async function launchBrowser(): Promise<Browser> {
  return await chromium.launch({ channel: "chrome", headless: false, args: CHROME_ARGS });
}

export async function openPage(browser: Browser, aspect: Aspect): Promise<{ context: BrowserContext; page: Page }> {
  const { viewport, scale } = ASPECTS[aspect];
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: "light", reducedMotion: "no-preference" });
  const page = await context.newPage();
  return { context, page };
}

// True once the page has a WebGL canvas that has drawn something other than one flat colour.
export async function webglPainted(page: Page) {
  return await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("canvas")];
    return canvases.some((canvas) => {
      const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
      return gl !== null && canvas.width > 0 && canvas.height > 0;
    });
  });
}

type Frame = { file: string; at: number };

export class FrameRecorder {
  private frames: Frame[] = [];
  private session: CDPSession | null = null;
  private handler: ((frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => void) | null = null;

  constructor(private page: Page, private dir: string, private aspect: Aspect) {}

  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.session = await this.page.context().newCDPSession(this.page);
    const session = this.session;
    this.handler = ({ data, sessionId, metadata }) => {
      const file = path.join(this.dir, `${String(this.frames.length).padStart(6, "0")}.jpg`);
      this.frames.push({ file, at: metadata.timestamp ?? Date.now() / 1000 });
      writeFileSync(file, Buffer.from(data, "base64"));
      session.send("Page.screencastFrameAck", { sessionId }).catch(() => undefined);
    };
    session.on("Page.screencastFrame", this.handler);
    const { out } = ASPECTS[this.aspect];
    await session.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: out.width, maxHeight: out.height, everyNthFrame: 1 });
  }

  async stop() {
    if (!this.session) return [];
    await this.session.send("Page.stopScreencast").catch(() => undefined);
    if (this.handler) this.session.off("Page.screencastFrame", this.handler);
    await this.session.detach().catch(() => undefined);
    this.session = null;
    return this.frames;
  }
}

// The concat demuxer holds each frame until the next one arrives, so a still screen costs nothing
// and the output keeps real time.
function concatList(frames: Frame[], endAt: number) {
  const lines = frames.map((frame, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].at : endAt;
    return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.at).toFixed(4)}`;
  });
  return `${lines.join("\n")}\nfile '${frames[frames.length - 1].file}'\n`;
}

export async function encode(frames: Frame[], endAt: number, outFile: string, aspect: Aspect, fps: number): Promise<Clip> {
  if (frames.length < 2) throw new Error(`Only ${frames.length} frames captured for ${outFile}`);
  const { out } = ASPECTS[aspect];
  const list = path.join(path.dirname(frames[0].file), "frames.txt");
  writeFileSync(list, concatList(frames, endAt));
  const filter = `fps=${fps},scale=${out.width}:${out.height}:flags=lanczos:force_original_aspect_ratio=decrease,pad=${out.width}:${out.height}:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p`;
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", filter, "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    outFile,
  ]);
  const seconds = endAt - frames[0].at;
  const sheet = outFile.replace(/\.mp4$/, ".png");
  await contactSheet(outFile, sheet, seconds, aspect);
  return { file: outFile, sheet, seconds, frames: frames.length, capturedFps: frames.length / seconds };
}

// Sixteen evenly spaced frames, tiled, for checking a clip at a glance.
async function contactSheet(video: string, sheet: string, seconds: number, aspect: Aspect) {
  const [columns, rows, width] = aspect === "wide" ? [4, 4, 480] : [8, 2, 270];
  const every = Math.max(seconds / (columns * rows), 0.05);
  await run("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", `fps=1/${every.toFixed(3)},scale=${width}:-1,tile=${columns}x${rows}:padding=4:color=white`, "-frames:v", "1", sheet]);
}
