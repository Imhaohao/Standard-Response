import { interpolate } from "remotion";
import type { XY } from "./data/scene";
import { ease } from "./theme";

export const pathD = (points: XY[], close = false) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join("") + (close ? "Z" : "");

export function cumulative(points: XY[]) {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return out;
}

export function pointAt(points: XY[], lengths: number[], distance: number): XY {
  const index = lengths.findIndex((length) => length >= distance);
  if (index <= 0) return index === 0 ? points[0] : points[points.length - 1];
  const span = lengths[index] - lengths[index - 1] || 1;
  const t = (distance - lengths[index - 1]) / span;
  const [a, b] = [points[index - 1], points[index]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// How far along a polyline a place sits, by its nearest vertex.
export function distanceTo(points: XY[], lengths: number[], [x, y]: XY) {
  let best = 0;
  points.forEach(([px, py], i) => {
    if ((px - x) ** 2 + (py - y) ** 2 < (points[best][0] - x) ** 2 + (points[best][1] - y) ** 2) best = i;
  });
  return lengths[best];
}

export function bounds(points: XY[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export const centroid = (points: XY[]): XY => [
  points.reduce((sum, p) => sum + p[0], 0) / points.length,
  points.reduce((sum, p) => sum + p[1], 0) / points.length,
];

// A 0..1 progress between two frames, eased and clamped. Most motion in the film is this.
export const progress = (frame: number, start: number, end: number, easing = ease.outQuint) =>
  interpolate(frame, [start, end], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

// Deterministic per-index jitter so staggered things don't march in lockstep.
export const jitter = (index: number) => {
  const s = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
