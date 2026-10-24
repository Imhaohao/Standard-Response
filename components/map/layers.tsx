"use client";

import { ReactNode } from "react";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { useMapStage } from "./map-stage";

// Anchors a marker to the ground under it. Everything drawn here sits in the overlay SVG, which
// shares the surface's pixel grid, so a marker and its roof stay together at any window size.
export function Anchor({ point, children }: { point: Point; children: ReactNode }) {
  const { project } = useMapStage();
  const { x, y, visible } = project(point);
  if (!visible) return null;
  return <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>{children}</g>;
}

export function GeoAnchor({ at, children }: { at: LatLng; children: ReactNode }) {
  const { toLocal } = useMapStage();
  return <Anchor point={toLocal(at)}>{children}</Anchor>;
}

const pathData = (points: Point[], close: boolean) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + (close ? "Z" : "");

type LineProps = { route: Point[]; close?: boolean } & React.SVGProps<SVGPathElement>;

export function MapLine({ route, close = false, ...rest }: LineProps) {
  const { project } = useMapStage();
  if (route.length < 2) return null;
  const onScreen = route.map((point) => {
    const { x, y } = project(point);
    return [x, y] as Point;
  });
  return <path d={pathData(onScreen, close)} {...rest} />;
}

export function GeoLine({ route, close = false, ...rest }: { route: LatLng[]; close?: boolean } & React.SVGProps<SVGPathElement>) {
  const { toLocal } = useMapStage();
  return <MapLine route={route.map(toLocal)} close={close} {...rest} />;
}

type LegProps = { start: Point; end: Point; stroke: string; strokeWidth: number; strokeDasharray?: string; className?: string };

// A straight run between two places, used for the leg a vehicle is driving.
export function Leg({ start, end, ...rest }: LegProps) {
  const { project } = useMapStage();
  const a = project(start);
  const b = project(end);
  if (!a.visible || !b.visible) return null;
  return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...rest} />;
}

export function GeoLeg({ start, end, ...rest }: { start: LatLng; end: LatLng } & Omit<LegProps, "start" | "end">) {
  const { toLocal } = useMapStage();
  return <Leg start={toLocal(start)} end={toLocal(end)} {...rest} />;
}

// Several closed rings as one even-odd path, so a hole inside a ring stays open.
export function MapShape({ rings, ...rest }: { rings: Point[][] } & React.SVGProps<SVGPathElement>) {
  const { project } = useMapStage();
  const toScreen = (point: Point): Point => {
    const { x, y } = project(point);
    return [x, y];
  };
  const d = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => pathData(ring.map(toScreen), true))
    .join("");
  if (!d) return null;
  return <path d={d} fillRule="evenodd" {...rest} />;
}
