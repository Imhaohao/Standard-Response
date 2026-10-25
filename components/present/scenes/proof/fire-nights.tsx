"use client";

import { useEffect, useRef } from "react";

export const NIGHTS = { columns: 10, tile: 68, gap: 12 } as const;
export const NIGHTS_SIZE = NIGHTS.columns * NIGHTS.tile + (NIGHTS.columns - 1) * NIGHTS.gap;

const COUNT = NIGHTS.columns * NIGHTS.columns;
const CELLS = 17;
const CELL = NIGHTS.tile / CELLS;
const CYCLE_SECONDS = 7;
const SPREAD_SECONDS = 4.6;

// Colours a cell passes through after the front reaches it: white heat, ember, flame, embers dying, char.
const BANDS: { until: number; color: string }[] = [
  { until: 0.2, color: "oklch(0.96 0.06 85)" },
  { until: 0.6, color: "oklch(0.78 0.17 60)" },
  { until: 1.2, color: "oklch(0.63 0.21 35)" },
  { until: 2.2, color: "oklch(0.4 0.12 27)" },
  { until: Infinity, color: "oklch(0.12 0.01 40)" },
];
const UNBURNT = "oklch(0.24 0.008 60)";

function seeded(seed: number) {
  let state = seed * 2654435761;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// Each night gets its own ignition point, wind and pace. A cell's arrival time is its distance from
// the ignition, shortened downwind and roughened with noise, scaled so the last cell burns at SPREAD_SECONDS.
function buildNight(index: number) {
  const random = seeded(index + 11);
  const [ix, iy] = [random() * CELLS, random() * CELLS];
  const wind = random() * Math.PI * 2;
  const arrivals = new Float32Array(CELLS * CELLS);
  let latest = 0;
  for (let cell = 0; cell < arrivals.length; cell++) {
    const [dx, dy] = [(cell % CELLS) + 0.5 - ix, Math.floor(cell / CELLS) + 0.5 - iy];
    const along = Math.cos(Math.atan2(dy, dx) - wind);
    arrivals[cell] = Math.hypot(dx, dy) * (1 - 0.55 * along) * (0.8 + random() * 0.4);
    latest = Math.max(latest, arrivals[cell]);
  }
  for (let cell = 0; cell < arrivals.length; cell++) arrivals[cell] = (arrivals[cell] / latest) * SPREAD_SECONDS;
  return { arrivals, offset: random() * CYCLE_SECONDS, left: (index % NIGHTS.columns) * (NIGHTS.tile + NIGHTS.gap), top: Math.floor(index / NIGHTS.columns) * (NIGHTS.tile + NIGHTS.gap) };
}

type Night = ReturnType<typeof buildNight>;

function bandFor(age: number) {
  if (age < 0) return -1;
  return BANDS.findIndex((band) => age < band.until);
}

// One path per colour band across all hundred nights keeps a frame to a handful of fills.
function drawFrame(ctx: CanvasRenderingContext2D, nights: Night[], seconds: number) {
  ctx.clearRect(0, 0, NIGHTS_SIZE, NIGHTS_SIZE);
  ctx.fillStyle = UNBURNT;
  ctx.beginPath();
  for (const night of nights) ctx.roundRect(night.left, night.top, NIGHTS.tile, NIGHTS.tile, 10);
  ctx.fill();
  const paths = BANDS.map(() => new Path2D());
  for (const night of nights) {
    const local = (seconds + night.offset) % CYCLE_SECONDS;
    for (let cell = 0; cell < night.arrivals.length; cell++) {
      const band = bandFor(local - night.arrivals[cell]);
      if (band < 0) continue;
      paths[band].rect(night.left + (cell % CELLS) * CELL, night.top + Math.floor(cell / CELLS) * CELL, CELL + 0.3, CELL + 0.3);
    }
  }
  ctx.save();
  ctx.beginPath();
  for (const night of nights) ctx.roundRect(night.left, night.top, NIGHTS.tile, NIGHTS.tile, 10);
  ctx.clip();
  for (const [band, path] of paths.entries()) {
    ctx.fillStyle = BANDS[band].color;
    ctx.fill(path);
  }
  ctx.restore();
}

function prepare(canvas: HTMLCanvasElement) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = NIGHTS_SIZE * ratio;
  canvas.height = NIGHTS_SIZE * ratio;
  const ctx = canvas.getContext("2d");
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

// A hundred simulated nights, each a small square of town with its own fire running across it. The
// blurred copy on top is the glow.
export function FireNights({ running }: { running: boolean }) {
  const sharpRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const [sharp, glow] = [sharpRef.current, glowRef.current];
    if (!sharp || !glow || !running) return;
    const [ctx, glowCtx] = [prepare(sharp), glow.getContext("2d")];
    if (!ctx || !glowCtx) return;
    glow.width = sharp.width;
    glow.height = sharp.height;
    const nights = Array.from({ length: COUNT }, (_, i) => buildNight(i));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      drawFrame(ctx, nights, still ? CYCLE_SECONDS / 2 : (now - began) / 1000);
      glowCtx.clearRect(0, 0, glow.width, glow.height);
      glowCtx.drawImage(sharp, 0, 0);
      if (!still) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  return (
    <div className="relative" style={{ width: NIGHTS_SIZE, height: NIGHTS_SIZE }} aria-hidden>
      <canvas ref={sharpRef} className="absolute inset-0 size-full" />
      <canvas ref={glowRef} className="absolute inset-0 size-full opacity-70 blur-[10px] mix-blend-screen" />
    </div>
  );
}
