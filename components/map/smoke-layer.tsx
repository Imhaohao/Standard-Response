"use client";

import { useEffect, useMemo, useRef } from "react";
import { Point } from "@/lib/ink-map/data";
import { ScenarioFront } from "@/lib/ink-map/fire-field";
import { Project, useMapStage } from "./map-stage";

// Smoke drawn the manga way: round puffs with an ink outline and a halftone shadow, rising in a few
// plumes spread along the whole burning edge and leaning downwind, thickest where the front runs
// fastest. Each puff's path is a real line in the air, from the burning ground to a point downwind
// and high above it, projected through the camera, so the plume keeps its heading at any zoom.
// It is painted on its own canvas above the map's markers: animating SVG puffs made the browser
// repaint every marker on the map for every frame of smoke.

const PUFFS = 72;
const LIFE_SECONDS = 9;
const EDGE_SAMPLES = 96;
const PLUME_EVERY_METERS = 900;
const MOST_PLUMES = 8;
// How hard the ground the last two fronts crossed still smokes, against the burning edge's 1.
const SMOULDER_HEAT = [0.6, 0.35];
// The scenario's wind carries smoke toward the west-southwest.
const DOWNWIND: Point = [-0.92, -0.38];
const DRIFT_METERS = 1000;
const RISE_METERS = 650;
const PUFF_METERS = 60;
const MAX_PUFF_PIXELS = 280;
const FRAME_MS = 33;
const OUTLINE_PX = 1.5;
const SHADOW_OPACITY = 0.5;

type Source = { point: Point; strength: number };

function sampleRing(ring: Point[], count: number): Point[] {
  const step = Math.max(1, Math.floor(ring.length / count));
  return ring.filter((_, index) => index % step === 0);
}

function distanceToRing(ring: Point[], [x, y]: Point) {
  let best = Infinity;
  for (const [rx, ry] of ring) best = Math.min(best, Math.hypot(rx - x, ry - y));
  return best;
}

function perimeter(ring: Point[]) {
  let total = 0;
  for (let i = 1; i < ring.length; i++) total += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  return total;
}

// Plumes spread around one front: the ring is cut into equal stretches and each plume rises where
// its stretch pushes furthest by the following front. A long push means a hot, fast run.
function plumesAlong(ring: Point[], nextRing: Point[] | null, plumes: number, heat: number): Source[] {
  const edge = sampleRing(ring, EDGE_SAMPLES).map((point) => ({ point, strength: nextRing ? distanceToRing(nextRing, point) : 1 }));
  const stretch = Math.ceil(edge.length / plumes);
  return Array.from({ length: plumes }, (_, i) => edge.slice(i * stretch, (i + 1) * stretch))
    .filter((part) => part.length > 0)
    .map((part) => part.reduce((best, source) => (source.strength > best.strength ? source : best)))
    .map((source) => ({ ...source, strength: source.strength * heat }));
}

// One plume for every kilometre or so of burning edge, and fewer, fainter ones over the ground the
// fire crossed in the last hour or so, which is still smouldering.
function smokeSources(fronts: ScenarioFront[], minutes: number): Source[] {
  const index = fronts.findLastIndex((front) => front.minutes <= minutes);
  if (index < 0) return [];
  const sampled = (i: number) => (fronts[i] ? sampleRing(fronts[i].ring, EDGE_SAMPLES * 2) : null);
  const plumes = Math.max(1, Math.min(MOST_PLUMES, Math.round(perimeter(fronts[index].ring) / PLUME_EVERY_METERS)));
  const sources = [
    ...plumesAlong(fronts[index].ring, sampled(index + 1), plumes, 1),
    ...SMOULDER_HEAT.flatMap((heat, back) => {
      const older = fronts[index - back - 1];
      return older ? plumesAlong(older.ring, sampled(index - back), Math.max(1, Math.round(plumes / 2)), heat) : [];
    }),
  ];
  const strongest = Math.max(...sources.map((source) => source.strength)) || 1;
  return sources.map((source) => ({ ...source, strength: Math.max(0.3, source.strength / strongest) }));
}

const hash = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

type Puff = { x: number; y: number; r: number; dx: number; dy: number; phase: number };

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
  };
}

// Where a puff is in its life: it swells as it rises and drifts, fades in quickly and out at the end.
function puffAt(puff: Puff, seconds: number) {
  const t = (seconds / LIFE_SECONDS + puff.phase) % 1;
  const opacity = Math.min(1, t / 0.08, (1 - t) / 0.14);
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
  const scale = Math.min(2, window.devicePixelRatio || 1);
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
function puffsOnScreen(project: Project, sources: Source[]) {
  const perSource = Math.ceil(PUFFS / Math.max(1, sources.length));
  const list: Puff[] = [];
  sources.forEach((source, s) => {
    for (let i = 0; i < perSource; i++) {
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

export function SmokeLayer({ fronts, minutes }: { fronts: ScenarioFront[]; minutes: number }) {
  const { size } = useMapStage();
  const sources = useMemo(() => smokeSources(fronts, minutes), [fronts, minutes]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useSmokePainter(canvasRef, sources, size.width, size.height);
  if (sources.length === 0) return null;
  return <canvas ref={canvasRef} style={{ width: size.width, height: size.height }} className="pointer-events-none absolute inset-0" aria-hidden />;
}
