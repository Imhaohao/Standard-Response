"use client";

import { useEffect, useRef } from "react";
import type { Point } from "@/lib/ink-map/data";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";
import { STAGE, stageCanvasRatio } from "../stage";
import { readPalette } from "./painters";

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

const DOT = 3;
// Rings are drawn in this many alpha steps, one path each, instead of one stroke per home.
const RING_STEPS = 10;

type Colors = { waiting: string; called: string };

function readColors(): Colors {
  const palette = readPalette();
  return { waiting: palette.muted, called: palette.ink };
}

// Every home starts as a faint dot, drawn once.
function drawWaiting(ctx: CanvasRenderingContext2D, placed: Placed[], colors: Colors) {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = colors.waiting;
  ctx.beginPath();
  for (const home of placed) ctx.rect(home.x - DOT / 2, home.y - DOT / 2, DOT, DOT);
  ctx.fill();
}

// Homes whose call has just gone out turn bright. Only the new ones are drawn each frame.
function drawCalled(ctx: CanvasRenderingContext2D, placed: Placed[], from: number, to: number, colors: Colors) {
  if (from >= to) return;
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = colors.called;
  ctx.beginPath();
  for (let i = from; i < to; i++) {
    const home = placed[i];
    ctx.clearRect(home.x - DOT / 2, home.y - DOT / 2, DOT, DOT);
    ctx.rect(home.x - DOT / 2, home.y - DOT / 2, DOT, DOT);
  }
  ctx.fill();
}

const RING_MAX_RADIUS = 3 + 14;
const RING_LINE = 1.2;
const RING_SPRITE = Math.ceil(2 * (RING_MAX_RADIUS + RING_LINE));

// Each ring step is drawn once into a small sprite, so a frame stamps images instead of tracing arcs.
function ringSprites(color: string, ratio: number) {
  return Array.from({ length: RING_STEPS }, (_, step) => {
    const k = (step + 0.5) / RING_STEPS;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = Math.ceil(RING_SPRITE * ratio);
    const ctx = sprite.getContext("2d");
    if (!ctx) return sprite;
    ctx.scale(ratio, ratio);
    ctx.strokeStyle = color;
    ctx.lineWidth = RING_LINE;
    ctx.globalAlpha = 0.7 * (1 - k);
    ctx.beginPath();
    ctx.arc(RING_SPRITE / 2, RING_SPRITE / 2, 3 + k * 14, 0, Math.PI * 2);
    ctx.stroke();
    return sprite;
  });
}

// The rings still spreading, each stamped from the sprite for how far along it is.
function drawRings(ctx: CanvasRenderingContext2D, placed: Placed[], from: number, to: number, elapsed: number, sprites: HTMLCanvasElement[]) {
  ctx.clearRect(0, 0, STAGE.width, STAGE.height);
  for (let i = from; i < to; i++) {
    const home = placed[i];
    const step = Math.min(Math.floor(((elapsed - home.at) / RING_MS) * RING_STEPS), RING_STEPS - 1);
    ctx.drawImage(sprites[Math.max(0, step)], home.x - RING_SPRITE / 2, home.y - RING_SPRITE / 2, RING_SPRITE, RING_SPRITE);
  }
}

function prepare(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const ratio = stageCanvasRatio();
  canvas.width = STAGE.width * ratio;
  canvas.height = STAGE.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

// Runs the wave once: dots light up as their call goes out, rings spread and fade, and the loop
// stops once the last ring is gone. Homes are sorted by start time, so each frame touches only
// the homes whose ring is still spreading.
function runWave(dots: CanvasRenderingContext2D, rings: CanvasRenderingContext2D, placed: Placed[]) {
  const colors = readColors();
  const sprites = ringSprites(colors.called, stageCanvasRatio());
  drawWaiting(dots, placed, colors);
  const began = performance.now();
  let [fading, called, frame] = [0, 0, 0];
  const tick = (now: number) => {
    const elapsed = now - began;
    const nextCalled = firstAfter(placed, elapsed, called);
    drawCalled(dots, placed, called, nextCalled, colors);
    called = nextCalled;
    fading = firstAfter(placed, elapsed - RING_MS, fading);
    drawRings(rings, placed, fading, called, elapsed, sprites);
    if (fading < placed.length) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

// The first home, from `start` on, whose call goes out after `time`.
function firstAfter(placed: Placed[], time: number, start: number) {
  let i = start;
  while (i < placed.length && placed[i].at <= time) i++;
  return i;
}

// Every home in town gets its call at once: a light on each roof and a ring going out from it.
export function CallWave({ renderer, homes, running }: { renderer: InkMapRenderer | null; homes: Point[]; running: boolean }) {
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const ringsRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const [dotsCanvas, ringsCanvas] = [dotsRef.current, ringsRef.current];
    if (!dotsCanvas || !ringsCanvas || !renderer || !running) return;
    const [dots, rings] = [prepare(dotsCanvas), prepare(ringsCanvas)];
    if (!dots || !rings) return;
    const placed = placeHomes(renderer, homes).sort((a, b) => a.at - b.at);
    const stop = runWave(dots, rings, placed);
    return () => {
      stop();
      dots.clearRect(0, 0, STAGE.width, STAGE.height);
      rings.clearRect(0, 0, STAGE.width, STAGE.height);
    };
  }, [renderer, homes, running]);

  return (
    <>
      <canvas ref={dotsRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
      <canvas ref={ringsRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
    </>
  );
}
