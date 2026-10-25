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

export function screenPath(project: Project, points: Point[], close = false) {
  let d = "";
  for (let i = 0; i < points.length; i++) {
    const { x, y } = project(points[i]);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return close && d ? `${d}Z` : d;
}

// A path whose `d` follows the camera. `shape` turns the current projection into path data.
function ProjectedPath({ shape, ...rest }: { shape: (project: Project) => string } & React.SVGProps<SVGPathElement>) {
  const ref = useRef<SVGPathElement>(null);
  useProjected((project) => ref.current?.setAttribute("d", shape(project)));
  return <path ref={ref} {...rest} />;
}

type LineProps = { route: Point[]; close?: boolean } & React.SVGProps<SVGPathElement>;

export function MapLine({ route, close = false, ...rest }: LineProps) {
  if (route.length < 2) return null;
  return <ProjectedPath shape={(project) => screenPath(project, route, close)} {...rest} />;
}

export function GeoLine({ route, close = false, ...rest }: { route: LatLng[]; close?: boolean } & React.SVGProps<SVGPathElement>) {
  const { toLocal } = useMapStage();
  return <MapLine route={route.map(toLocal)} close={close} {...rest} />;
}

type LegProps = { start: Point; end: Point; stroke: string; strokeWidth: number; strokeDasharray?: string; className?: string };

// A straight run between two places, used for the leg a vehicle is driving.
export function Leg({ start, end, ...rest }: LegProps) {
  return <ProjectedPath shape={(project) => screenPath(project, [start, end])} fill="none" {...rest} />;
}

export function GeoLeg({ start, end, ...rest }: { start: LatLng; end: LatLng } & Omit<LegProps, "start" | "end">) {
  const { toLocal } = useMapStage();
  return <Leg start={toLocal(start)} end={toLocal(end)} {...rest} />;
}

// Several closed rings as one even-odd path, so a hole inside a ring stays open.
export function MapShape({ rings, ...rest }: { rings: Point[][] } & React.SVGProps<SVGPathElement>) {
  const closed = rings.filter((ring) => ring.length >= 3);
  if (closed.length === 0) return null;
  return <ProjectedPath shape={(project) => closed.map((ring) => screenPath(project, ring, true)).join("")} fillRule="evenodd" {...rest} />;
}
