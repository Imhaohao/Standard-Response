"use client";

import { ReactNode, useRef } from "react";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { Project, useMapStage, useProjected } from "./map-stage";

// Everything drawn here sits in the overlay SVG, which shares the surface's pixel grid, so a marker
// and its roof stay together at any window size. Each primitive places itself with useProjected,
// which moves it with the camera without re-rendering it.

// Anchors a marker to the ground under it.
export function Anchor({ point, children }: { point: Point; children: ReactNode }) {
  const ref = useRef<SVGGElement>(null);
  useProjected((project) => {
    const element = ref.current;
    if (!element) return;
    const { x, y, visible } = project(point);
    element.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    element.style.display = visible ? "" : "none";
  });
  return <g ref={ref}>{children}</g>;
}

export function GeoAnchor({ at, children }: { at: LatLng; children: ReactNode }) {
  const { toLocal } = useMapStage();
  return <Anchor point={toLocal(at)}>{children}</Anchor>;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
type XY = { x: number; y: number };

// The part of a segment inside a box (Liang-Barsky), or null when it misses the box.
function clipSegment(a: XY, b: XY, box: Box): [XY, XY] | null {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let [enter, leave] = [0, 1];
  const edges: [number, number][] = [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]];
  for (const [p, q] of edges) {
    if (p === 0 && q < 0) return null;
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else if (p > 0) leave = Math.min(leave, t);
  }
  if (enter > leave) return null;
  return [
    { x: a.x + dx * enter, y: a.y + dy * enter },
    { x: a.x + dx * leave, y: a.y + dy * leave },
  ];
}

const OFFSCREEN_MARGIN_PX = 64;

// A line as path data, cut to the screen and a little past it. Zoomed in, a route can run thousands
// of pixels off the edge, and a dashed or animated stroke costs its whole length on every frame.
export function clippedPath(project: Project, points: Point[], size: { width: number; height: number }) {
  const box = { x0: -OFFSCREEN_MARGIN_PX, y0: -OFFSCREEN_MARGIN_PX, x1: size.width + OFFSCREEN_MARGIN_PX, y1: size.height + OFFSCREEN_MARGIN_PX };
  const screen = points.map((point) => project(point));
  let d = "";
  let open = false;
  for (let i = 1; i < screen.length; i++) {
    const piece = clipSegment(screen[i - 1], screen[i], box);
    if (!piece) {
      open = false;
      continue;
    }
    const [from, to] = piece;
    if (!open) d += `M${from.x.toFixed(1)} ${from.y.toFixed(1)}`;
    d += `L${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
    open = to.x === screen[i].x && to.y === screen[i].y;
  }
  return d;
}

// A closed ring cut to the same box (Sutherland-Hodgman), so a zone filled and outlined far past
// the edge of the screen only costs what shows. The cut runs along the box, off screen.
function clipRing(ring: XY[], box: Box): XY[] {
  const sides: [(p: XY) => boolean, (a: XY, b: XY) => XY][] = [
    [(p) => p.x >= box.x0, (a, b) => lerpTo(a, b, (box.x0 - a.x) / (b.x - a.x))],
    [(p) => p.x <= box.x1, (a, b) => lerpTo(a, b, (box.x1 - a.x) / (b.x - a.x))],
    [(p) => p.y >= box.y0, (a, b) => lerpTo(a, b, (box.y0 - a.y) / (b.y - a.y))],
    [(p) => p.y <= box.y1, (a, b) => lerpTo(a, b, (box.y1 - a.y) / (b.y - a.y))],
  ];
  return sides.reduce((points, [inside, cross]) => clipAgainst(points, inside, cross), ring);
}

const lerpTo = (a: XY, b: XY, t: number): XY => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function clipAgainst(points: XY[], inside: (p: XY) => boolean, cross: (a: XY, b: XY) => XY) {
  const out: XY[] = [];
  points.forEach((current, i) => {
    const previous = points[(i + points.length - 1) % points.length];
    if (inside(current) !== inside(previous)) out.push(cross(previous, current));
    if (inside(current)) out.push(current);
  });
  return out;
}

export function clippedRing(project: Project, ring: Point[], size: { width: number; height: number }) {
  const box = { x0: -OFFSCREEN_MARGIN_PX, y0: -OFFSCREEN_MARGIN_PX, x1: size.width + OFFSCREEN_MARGIN_PX, y1: size.height + OFFSCREEN_MARGIN_PX };
  const clipped = clipRing(ring.map((point) => project(point)), box);
  if (clipped.length < 3) return "";
  return clipped.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("") + "Z";
}

// A path whose `d` follows the camera. `shape` turns the current projection into path data.
function ProjectedPath({ shape, ...rest }: { shape: (project: Project) => string } & React.SVGProps<SVGPathElement>) {
  const ref = useRef<SVGPathElement>(null);
  useProjected((project) => ref.current?.setAttribute("d", shape(project)));
  return <path ref={ref} {...rest} />;
}

type LineProps = { route: Point[]; close?: boolean } & React.SVGProps<SVGPathElement>;

export function MapLine({ route, close = false, ...rest }: LineProps) {
  const { size } = useMapStage();
  if (route.length < 2) return null;
  const shape = close ? (project: Project) => clippedRing(project, route, size) : (project: Project) => clippedPath(project, route, size);
  return <ProjectedPath shape={shape} {...rest} />;
}

export function GeoLine({ route, close = false, ...rest }: { route: LatLng[]; close?: boolean } & React.SVGProps<SVGPathElement>) {
  const { toLocal } = useMapStage();
  return <MapLine route={route.map(toLocal)} close={close} {...rest} />;
}

type LegProps = { start: Point; end: Point; stroke: string; strokeWidth: number; strokeDasharray?: string; className?: string };

// A straight run between two places, used for the leg a vehicle is driving.
export function Leg({ start, end, ...rest }: LegProps) {
  const { size } = useMapStage();
  return <ProjectedPath shape={(project) => clippedPath(project, [start, end], size)} fill="none" {...rest} />;
}

export function GeoLeg({ start, end, ...rest }: { start: LatLng; end: LatLng } & Omit<LegProps, "start" | "end">) {
  const { toLocal } = useMapStage();
  return <Leg start={toLocal(start)} end={toLocal(end)} {...rest} />;
}

// Several closed rings as one even-odd path, so a hole inside a ring stays open.
export function MapShape({ rings, ...rest }: { rings: Point[][] } & React.SVGProps<SVGPathElement>) {
  const { size } = useMapStage();
  const closed = rings.filter((ring) => ring.length >= 3);
  if (closed.length === 0) return null;
  return <ProjectedPath shape={(project) => closed.map((ring) => clippedRing(project, ring, size)).join("")} fillRule="evenodd" {...rest} />;
}
