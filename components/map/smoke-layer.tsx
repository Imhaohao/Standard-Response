"use client";

import { useEffect, useMemo, useRef } from "react";
import { Point } from "@/lib/ink-map/data";
import type { FireField } from "@/lib/ink-map/fire-field";
import { Project, useMapStage } from "./map-stage";

// Smoke drawn the manga way: round puffs with an ink outline and a halftone shadow, rising from all
// over the ground the fire has reached and leaning downwind. Ground burning now (the last quarter
// hour behind the front) smokes hardest; ground it crossed earlier smoulders, fainter the longer
// ago. Sources come from the same arrival field the map shades, spaced evenly over the burn, so the
// smoke covers the fire wherever the map shows it burning. Each puff's path is a real line in the
// air, from the burning ground to a point downwind and high above it, projected through the camera,
// so the plume keeps its heading at any zoom. It is painted on its own canvas above the map's
// markers: animating SVG puffs made the browser repaint every marker on the map for every frame.

const LIFE_SECONDS = 9;
// Sources sit at least this far apart, and further on a big burn so there are never more than
// MOST_SOURCES of them.
const SOURCE_SPACING_METERS = 250;
const MOST_SOURCES = 48;
const MOST_BURNING_SOURCES = 32;
// Ground behind the front burns at full heat for this long, then smoulders down toward nothing.
const BURNING_MINUTES = 15;
const SMOULDER_HEAT = 0.55;
const SMOULDER_MINUTES = 70;
const FAINTEST_HEAT = 0.12;
// The scenario's wind carries smoke toward the west-southwest.
const DOWNWIND: Point = [-0.92, -0.38];
const DRIFT_METERS = 1000;
const RISE_METERS = 650;
const PUFF_METERS = 60;
const MAX_PUFF_PIXELS = 280;
// Smoke drifts over seconds, so 15 frames a second is plenty, and soft puffs gain nothing from retina
// pixels: the two full-screen canvases stay at 1x, a quarter of the memory and fill work.
const FRAME_MS = 66;
const SMOKE_SCALE = 1;
const OUTLINE_PX = 1.5;
const SHADOW_OPACITY = 0.5;
const SMOKE_OPACITY = 0.55;

type Source = { point: Point; strength: number };

// How hard ground smokes `since` minutes after the fire reached it.
function heatAfter(since: number) {
  if (since < 0) return 0;
  if (since <= BURNING_MINUTES) return 1;
  return SMOULDER_HEAT * Math.exp(-(since - BURNING_MINUTES) / SMOULDER_MINUTES);
}

// How many cells apart sources sit: the spacing, widened until the burn holds at most MOST_SOURCES.
function strideFor(field: FireField, minutes: number) {
  const cellMeters = (field.region.x1 - field.region.x0) / field.width;
  let smoking = 0;
  for (let i = 0; i < field.minutes.length; i++) if (heatAfter(minutes - field.minutes[i]) >= FAINTEST_HEAT) smoking++;
  const spacing = Math.max(SOURCE_SPACING_METERS, Math.sqrt((smoking * cellMeters * cellMeters) / MOST_SOURCES));
  return Math.max(1, Math.round(spacing / cellMeters));
}

// One source per stride of the grid wherever the ground is smoking as `wanted` asks, nudged off the
// grid so the plumes don't stand in rows.
function sourcesOnGrid(field: FireField, minutes: number, stride: number, wanted: (heat: number) => boolean): Source[] {
  const cellX = (field.region.x1 - field.region.x0) / field.width;
  const cellY = (field.region.y1 - field.region.y0) / field.height;
  const sources: Source[] = [];
  for (let row = Math.floor(stride / 2); row < field.height; row += stride) {
    for (let col = Math.floor(stride / 2); col < field.width; col += stride) {
      const heat = heatAfter(minutes - field.minutes[row * field.width + col]);
      if (heat < FAINTEST_HEAT || !wanted(heat)) continue;
      const nudge = (hash(row * 91.3 + col * 7.1) - 0.5) * stride;
      const lift = (hash(row * 13.7 + col * 53.9) - 0.5) * stride;
      sources.push({ point: [field.region.x0 + (col + 0.5 + nudge) * cellX, field.region.y0 + (row + 0.5 + lift) * cellY], strength: heat });
    }
  }
  return sources;
}

const everyNth = <T,>(items: T[], most: number) => (items.length <= most ? items : items.filter((_, i) => i % Math.ceil(items.length / most) === 0));

// The smouldering burn at the even spacing, and the band burning now, which is only a few hundred
// metres deep, on a grid three times finer so the front always sends up its own plumes.
function smokeSources(field: FireField, minutes: number): Source[] {
  const stride = strideFor(field, minutes);
  const burning = sourcesOnGrid(field, minutes, Math.max(1, Math.round(stride / 3)), (heat) => heat === 1);
  return [...sourcesOnGrid(field, minutes, stride, (heat) => heat < 1), ...everyNth(burning, MOST_BURNING_SOURCES)];
}

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

type Puff = { x: number; y: number; r: number; dx: number; dy: number; phase: number; strength: number };

const offset = ([x, y]: Point, east: number, north: number): Point => [x + east, y + north];

function puffFrom(project: Project, source: Source, sourceIndex: number, puffIndex: number): Puff | null {
  const jitter = hash(sourceIndex * 31.7 + puffIndex * 7.3) * 2 - 1;
  const ground = offset(source.point, jitter * 50, jitter * -20);
  const base = project(ground);
  if (!base.visible) return null;
  const drift = DRIFT_METERS * (1 + jitter * 0.12);
  const top = project(offset(ground, DOWNWIND[0] * drift, DOWNWIND[1] * drift), RISE_METERS * (0.8 + 0.4 * source.strength));
  const edge = project(offset(ground, PUFF_METERS, 0));
  const pixelsPerPuff = Math.hypot(edge.x - base.x, edge.y - base.y);
  return {
    x: base.x,
    y: base.y,
    r: Math.min(MAX_PUFF_PIXELS, pixelsPerPuff * (1 + 0.6 * source.strength) * (1 + jitter * 0.25)),
    dx: top.x - base.x,
    dy: top.y - base.y,
    phase: hash(sourceIndex * 3.1 + puffIndex * 5.7),
    strength: source.strength,
  };
}

// Where a puff is in its life: it swells as it rises and drifts, fades in quickly and out at the end.
function puffAt(puff: Puff, seconds: number) {
  const t = (seconds / LIFE_SECONDS + puff.phase) % 1;
  const opacity = Math.min(1, t / 0.08, (1 - t) / 0.14) * (0.45 + 0.55 * puff.strength);
  return { x: puff.x + puff.dx * t, y: puff.y + puff.dy * t, r: puff.r * (0.35 + 2.05 * t), opacity };
}

type PuffFrame = ReturnType<typeof puffAt>;

function dotPattern(context: CanvasRenderingContext2D, ink: string, scale: number) {
  const tile = document.createElement("canvas");
  tile.width = tile.height = Math.round(4 * scale);
  const dot = tile.getContext("2d")!;
  dot.fillStyle = ink;
  dot.beginPath();
  dot.arc(2 * scale, 2 * scale, 0.95 * scale, 0, Math.PI * 2);
  dot.fill();
  const pattern = context.createPattern(tile, "repeat")!;
  pattern.setTransform(new DOMMatrix().rotate(45));
  return pattern;
}

type Paint = { ink: string; smoke: string; pattern: CanvasPattern; shadow: CanvasRenderingContext2D };

function circles(context: CanvasRenderingContext2D, frames: PuffFrame[], fill: string, grow = 0) {
  context.fillStyle = fill;
  for (const frame of frames) {
    context.globalAlpha = frame.opacity;
    context.beginPath();
    context.arc(frame.x, frame.y, frame.r + grow, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

// The halftone shadow: each puff's disc less a bright patch at its upper left, filled with one dot
// screen so overlapping puffs share it instead of stacking.
function shadowLayer(paint: Paint, frames: PuffFrame[], transform: DOMMatrix) {
  const shadow = paint.shadow;
  shadow.globalCompositeOperation = "source-over";
  shadow.resetTransform();
  shadow.clearRect(0, 0, shadow.canvas.width, shadow.canvas.height);
  shadow.setTransform(transform);
  circles(shadow, frames, "white");
  shadow.globalCompositeOperation = "destination-out";
  for (const frame of frames) {
    shadow.beginPath();
    shadow.arc(frame.x - frame.r * 0.3, frame.y - frame.r * 0.34, frame.r * 0.5, 0, Math.PI * 2);
    shadow.fill();
  }
  shadow.globalCompositeOperation = "source-in";
  shadow.resetTransform();
  shadow.fillStyle = paint.pattern;
  shadow.fillRect(0, 0, shadow.canvas.width, shadow.canvas.height);
  return shadow.canvas;
}

// A fat ink outline under a paper fill hides every outline inside the cloud and leaves one scalloped
// silhouette; the halftone shadow goes on last.
function paintSmoke(context: CanvasRenderingContext2D, paint: Paint, puffs: Puff[], seconds: number) {
  const frames = puffs.map((puff) => puffAt(puff, seconds));
  circles(context, frames, paint.ink, OUTLINE_PX);
  circles(context, frames, paint.smoke);
  const shadow = shadowLayer(paint, frames, context.getTransform());
  context.save();
  context.resetTransform();
  context.globalAlpha = SHADOW_OPACITY;
  context.drawImage(shadow, 0, 0);
  context.restore();
}

function setUpCanvas(canvas: HTMLCanvasElement, width: number, height: number): Paint | null {
  const scale = SMOKE_SCALE;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = canvas.width;
  shadowCanvas.height = canvas.height;
  const shadow = shadowCanvas.getContext("2d");
  if (!context || !shadow) return null;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const styles = getComputedStyle(canvas);
  const ink = styles.getPropertyValue("--map-ink").trim();
  return { ink, smoke: styles.getPropertyValue("--smoke").trim(), pattern: dotPattern(context, ink, scale), shadow };
}

// Every painted frame projects the puffs through the live camera, so the smoke stays on the fire
// mid-pan without React re-rendering anything.
// Hot ground sends up three puffs at a time, smouldering ground one.
function puffsOnScreen(project: Project, sources: Source[]) {
  const list: Puff[] = [];
  sources.forEach((source, s) => {
    for (let i = 0; i < 1 + Math.round(source.strength * 2); i++) {
      const puff = puffFrom(project, source, s, i);
      if (puff) list.push(puff);
    }
  });
  return list;
}

// Paints at most every FRAME_MS while the puffs drift, and at once whenever the camera moves, so
// the smoke stays on the fire mid-pan.
function useSmokePainter(canvasRef: React.RefObject<HTMLCanvasElement | null>, sources: Source[], width: number, height: number) {
  const { project, subscribe } = useMapStage();
  const latest = useRef({ sources, project });
  useEffect(() => {
    latest.current = { sources, project };
  }, [sources, project]);
  const hasSmoke = sources.length > 0;
  useEffect(() => {
    const canvas = canvasRef.current;
    const paint = canvas && hasSmoke ? setUpCanvas(canvas, width, height) : null;
    const context = canvas?.getContext("2d");
    if (!paint || !context) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = -Infinity;
    const paintNow = (time: number) => {
      last = time;
      context.clearRect(0, 0, width, height);
      const puffs = puffsOnScreen(latest.current.project, latest.current.sources);
      paintSmoke(context, paint, puffs, still ? LIFE_SECONDS * 0.4 : time / 1000);
    };
    const draw = (time: number) => {
      if (!still) frame = requestAnimationFrame(draw);
      if (time - last >= FRAME_MS) paintNow(time);
    };
    frame = requestAnimationFrame(draw);
    const stopFollowing = subscribe(() => paintNow(performance.now()));
    return () => {
      cancelAnimationFrame(frame);
      stopFollowing();
    };
  }, [canvasRef, hasSmoke, width, height, subscribe]);
}

export function SmokeLayer({ field, minutes }: { field: FireField; minutes: number }) {
  const { size } = useMapStage();
  const sources = useMemo(() => smokeSources(field, minutes), [field, minutes]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useSmokePainter(canvasRef, sources, size.width, size.height);
  if (sources.length === 0) return null;
  // The whole cloud fades as one layer, so overlapping puffs stay a single silhouette and the town
  // shows through it rather than darkening where puffs stack.
  return <canvas ref={canvasRef} style={{ width: size.width, height: size.height, opacity: SMOKE_OPACITY }} className="pointer-events-none absolute inset-0" aria-hidden />;
}
