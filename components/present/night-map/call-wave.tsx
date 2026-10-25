"use client";

import { useEffect, useRef } from "react";
import type { Point } from "@/lib/ink-map/data";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";
import { STAGE, stageCanvasRatio } from "../stage";

// How long the wave takes to cross town, and how long each home's ring lasts.
const WAVE_MS = 2600;
const RING_MS = 900;
const START_DELAY_MS = 600;

type Placed = { x: number; y: number; at: number };

// Spreads each home's start time by how far east it sits, with a little scatter, so the calls read
// as going out together rather than one by one.
function placeHomes(renderer: InkMapRenderer, homes: Point[]): Placed[] {
  const placed: Placed[] = [];
  for (const [i, home] of homes.entries()) {
    const p = renderer.project(home);
    if (!p.visible) continue;
    const scatter = ((i * 2654435761) % 1000) / 1000;
    placed.push({ x: p.x, y: p.y, at: START_DELAY_MS + (p.x / STAGE.width) * WAVE_MS + scatter * 400 });
  }
  return placed;
}

function drawHome(ctx: CanvasRenderingContext2D, home: Placed, elapsed: number) {
  const t = elapsed - home.at;
  if (t < 0) {
    ctx.fillStyle = "oklch(0.72 0.01 70 / 0.35)";
    ctx.fillRect(home.x - 1.5, home.y - 1.5, 3, 3);
    return;
  }
  ctx.fillStyle = "oklch(0.95 0.006 85 / 0.7)";
  ctx.fillRect(home.x - 1.5, home.y - 1.5, 3, 3);
  if (t > RING_MS) return;
  const k = t / RING_MS;
  ctx.strokeStyle = `oklch(0.95 0.006 85 / ${0.7 * (1 - k)})`;
  ctx.beginPath();
  ctx.arc(home.x, home.y, 3 + k * 14, 0, Math.PI * 2);
  ctx.stroke();
}

// Every home in town gets its call at once: a light on each roof and a ring going out from it.
export function CallWave({ renderer, homes, running }: { renderer: InkMapRenderer | null; homes: Point[]; running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !renderer || !running) return;
    const ratio = stageCanvasRatio();
    canvas.width = STAGE.width * ratio;
    canvas.height = STAGE.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 1.2;
    const placed = placeHomes(renderer, homes);
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      ctx.clearRect(0, 0, STAGE.width, STAGE.height);
      for (const home of placed) drawHome(ctx, home, now - began);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      ctx.clearRect(0, 0, STAGE.width, STAGE.height);
    };
  }, [renderer, homes, running]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />;
}
