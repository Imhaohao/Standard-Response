import type { Point } from "@/lib/ink-map/data";
import type { ScreenPoint } from "@/lib/ink-map/renderer";
import { JAMMED_PACE, type CrowdDot, type StreetFlow } from "./crowd";
import type { Census, Home } from "./town";

export type Project = (point: Point) => ScreenPoint;
export type Palette = Record<"night" | "ink" | "muted" | "signal" | "ride" | "leaving" | "unknown" | "ember", string>;
type Ctx = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
const easeOut = (t: number) => 1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3;

export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(`--${name}`).trim();
  return {
    night: token("night"),
    ink: token("on-night"),
    muted: token("on-night-muted"),
    signal: token("signal"),
    ride: token("ride"),
    leaving: token("leaving"),
    unknown: token("unreachable"),
    ember: token("ember"),
  };
}

function tracePath(ctx: Ctx, screen: ScreenPoint[]) {
  ctx.beginPath();
  ctx.moveTo(screen[0].x, screen[0].y);
  for (const p of screen.slice(1)) ctx.lineTo(p.x, p.y);
}

function pathLength(screen: ScreenPoint[]) {
  let length = 0;
  for (let i = 1; i < screen.length; i++) length += Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y);
  return length;
}

// The first `upTo` pixels of a path, ending partway along a segment.
function partialPath(screen: ScreenPoint[], upTo: number) {
  const shown = [screen[0]];
  let travelled = 0;
  for (let i = 1; i < screen.length; i++) {
    const [a, b] = [screen[i - 1], screen[i]];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (travelled + length >= upTo) {
      const t = length === 0 ? 0 : (upTo - travelled) / length;
      shown.push({ ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      return shown;
    }
    travelled += length;
    shown.push(b);
  }
  return shown;
}

const ARROW_SPACING = 90;

// Small chevrons along a route, every ARROW_SPACING pixels, pointing the way it is driven.
function paintChevrons(ctx: Ctx, screen: ScreenPoint[], size: number) {
  ctx.setLineDash([]);
  ctx.beginPath();
  let untilNext = ARROW_SPACING / 2;
  for (let i = 1; i < screen.length; i++) {
    const [a, b] = [screen[i - 1], screen[i]];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const [ux, uy] = [(b.x - a.x) / length, (b.y - a.y) / length];
    for (let along = untilNext; along <= length; along += ARROW_SPACING) {
      const [x, y] = [a.x + ux * along, a.y + uy * along];
      ctx.moveTo(x - ux * size - uy * size * 0.8, y - uy * size + ux * size * 0.8);
      ctx.lineTo(x, y);
      ctx.lineTo(x - ux * size + uy * size * 0.8, y - uy * size - ux * size * 0.8);
    }
    untilNext = untilNext > length ? untilNext - length : ARROW_SPACING - ((length - untilNext) % ARROW_SPACING);
  }
  ctx.stroke();
}

export type RouteStyle = { color: string; width: number; progress: number; glow?: number; dashed?: boolean; arrows?: boolean };

// A line along `points`, drawn on from its start over `progress` (0 to 1). Dashed lines are the
// emergency services' runs; arrows show which way a run is driven.
export function strokeRoute(ctx: Ctx, project: Project, points: Point[], style: RouteStyle) {
  if (points.length < 2 || style.progress <= 0) return;
  const screen = points.map(project);
  const shown = style.progress >= 1 ? screen : partialPath(screen, pathLength(screen) * easeOut(style.progress));
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.shadowColor = style.color;
  ctx.shadowBlur = style.glow ?? 0;
  ctx.setLineDash(style.dashed ? [style.width * 2.4, style.width * 2] : []);
  tracePath(ctx, shown);
  ctx.stroke();
  if (style.arrows) paintChevrons(ctx, shown, style.width * 1.6 + 3);
  ctx.restore();
}

export function paintZone(ctx: Ctx, project: Project, ring: Point[], style: { progress: number; alpha: number; ink: string }) {
  const screen = ring.map(project);
  ctx.save();
  ctx.globalAlpha = style.alpha * 0.06 * easeOut(style.progress);
  ctx.fillStyle = style.ink;
  tracePath(ctx, screen);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  strokeRoute(ctx, project, [...ring, ring[0]], { color: style.ink, width: 2.5 * style.alpha + 0.5, progress: style.progress });
}

function censusColor(census: Census, palette: Palette) {
  if (census === "need") return palette.signal;
  if (census === "help") return palette.ride;
  if (census === "left") return palette.leaving;
  return palette.unknown;
}

const HOME_DOT = 4;
// The homes that need someone, and the ones that can help, stand out from the ones already gone.
const CENSUS_DOT: Record<Census, { size: number; alpha: number }> = {
  need: { size: 7, alpha: 1 },
  help: { size: 7, alpha: 1 },
  left: { size: 5, alpha: 0.8 },
  unreached: { size: 4.5, alpha: 0.9 },
};
const RING_MS = 1100;

// Every home in the zone gets its call: a light on the roof and a ring going out from it, in a wave
// that starts at the zone's middle and runs to its edges.
export function paintRinging(ctx: Ctx, project: Project, homes: Home[], center: Point, elapsed: number, palette: Palette) {
  ctx.lineWidth = 1.4;
  for (const home of homes) {
    const p = project(home.at);
    if (!p.visible) continue;
    const t = elapsed - 900 - Math.hypot(home.at[0] - center[0], home.at[1] - center[1]) * 0.9 - home.hash * 500;
    ctx.globalAlpha = t < 0 ? 0.3 : 0.85;
    ctx.fillStyle = t < 0 ? palette.muted : palette.ink;
    ctx.fillRect(p.x - HOME_DOT / 2, p.y - HOME_DOT / 2, HOME_DOT, HOME_DOT);
    if (t < 0 || t > RING_MS) continue;
    const k = t / RING_MS;
    ctx.globalAlpha = 0.7 * (1 - k);
    ctx.strokeStyle = palette.ink;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3 + k * 16, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Each home settles from white into what its call found, in a scattered order.
export function paintCensus(ctx: Ctx, project: Project, homes: Home[], style: { elapsed: number; alpha: number; palette: Palette }) {
  for (const home of homes) {
    const p = project(home.at);
    if (!p.visible) continue;
    const settled = Math.min(Math.max((style.elapsed - 300 - home.hash * 1600) / 500, 0), 1);
    ctx.globalAlpha = style.alpha * CENSUS_DOT[home.census].alpha;
    const size = CENSUS_DOT[home.census].size;
    ctx.fillStyle = settled < 0.5 ? style.palette.ink : censusColor(home.census, style.palette);
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 2, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// A home picked out on the map: a solid dot with a dark collar, a glow and, while it waits, rings.
export function paintMarker(ctx: Ctx, at: ScreenPoint, style: { color: string; night: string; radius: number; rings: boolean; elapsed: number }) {
  if (!at.visible) return;
  ctx.save();
  if (style.rings) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = style.color;
    for (const delay of [0, 600, 1200]) {
      const k = ((style.elapsed + 1800 - delay) % 1800) / 1800;
      ctx.globalAlpha = 0.8 * (1 - k);
      ctx.beginPath();
      ctx.arc(at.x, at.y, style.radius + k * style.radius * 3, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = style.night;
  ctx.beginPath();
  ctx.arc(at.x, at.y, style.radius + 4, 0, TAU);
  ctx.fill();
  ctx.shadowColor = style.color;
  ctx.shadowBlur = style.radius * 2.5;
  ctx.fillStyle = style.color;
  ctx.beginPath();
  ctx.arc(at.x, at.y, style.radius, 0, TAU);
  ctx.fill();
  ctx.restore();
}

export function paintRequests(ctx: Ctx, project: Project, stops: Point[], style: { elapsed: number; color: string; night: string }) {
  for (const [i, stop] of stops.entries()) {
    if (i === 0) continue;
    const grown = easeOut((style.elapsed - 200 - i * 70) / 500);
    if (grown <= 0) continue;
    paintMarker(ctx, project(stop), { color: style.color, night: style.night, radius: 7 * grown, rings: false, elapsed: 0 });
  }
}

export function paintRescuer(ctx: Ctx, at: ScreenPoint, kind: "neighbour" | "engine", palette: Palette) {
  if (!at.visible) return;
  ctx.fillStyle = palette.night;
  ctx.fillRect(at.x - 11, at.y - 11, 22, 22);
  ctx.fillStyle = kind === "engine" ? palette.ink : palette.ride;
  if (kind === "engine") ctx.fillRect(at.x - 8, at.y - 8, 16, 16);
  else {
    ctx.beginPath();
    ctx.arc(at.x, at.y, 8, 0, TAU);
    ctx.fill();
  }
}

export function paintCrowd(ctx: Ctx, project: Project, dots: CrowdDot[], style: { jams: boolean; alpha: number; palette: Palette }) {
  ctx.save();
  ctx.globalAlpha = style.alpha;
  ctx.fillStyle = style.palette.ink;
  const jammed: ScreenPoint[] = [];
  for (const dot of dots) {
    const p = project(dot.at);
    if (!p.visible) continue;
    if (style.jams && dot.jammed) jammed.push(p);
    else ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
  }
  ctx.fillStyle = style.palette.ember;
  ctx.shadowColor = style.palette.ember;
  ctx.shadowBlur = 14;
  for (const p of jammed) ctx.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
  ctx.restore();
}

// Slow traffic is amber and stopped traffic red, the colours every maps app uses; streets moving
// freely stay green. Busier streets draw wider.
const SLOW_PACE = 0.75;

function flowColor(pace: number, palette: Palette) {
  if (pace < JAMMED_PACE) return palette.signal;
  if (pace < SLOW_PACE) return palette.ride;
  return palette.leaving;
}

export function paintTraffic(ctx: Ctx, project: Project, flows: StreetFlow[], style: { glow: boolean; palette: Palette }) {
  for (const flow of flows) {
    const jammed = flow.pace < JAMMED_PACE;
    strokeRoute(ctx, project, flow.path, {
      color: flowColor(flow.pace, style.palette),
      width: Math.min(5 + flow.cars * 0.6, 13),
      progress: 1,
      glow: style.glow && jammed ? 14 : 0,
    });
  }
}
