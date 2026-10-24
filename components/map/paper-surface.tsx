"use client";

import { useMemo } from "react";
import { terrainContours } from "@/lib/ink-map/contours";
import { AREA_KIND, InkMapData, Point, ROAD_WIDTH } from "@/lib/ink-map/data";
import { ScenarioFront } from "@/lib/ink-map/fire-field";
import { Frame, fitFrame, frameTransform, LocalProjection, PAPER_FIT, Size } from "./projection";

const CONTOUR_INTERVAL = 25;
const MINOR_ROAD_CLASS = 6;

// Land use reads as tone, not colour: red is kept for the fire and for people who need help.
const AREA_TONE: Record<number, number> = {
  [AREA_KIND.park]: 0.05,
  [AREA_KIND.grass]: 0.04,
  [AREA_KIND.water]: 0.1,
  [AREA_KIND.school]: 0.06,
  [AREA_KIND.parking]: 0.08,
  [AREA_KIND.cemetery]: 0.05,
  [AREA_KIND.golf]: 0.04,
  [AREA_KIND.pitch]: 0.06,
  [AREA_KIND.wild]: 0.03,
};

// The flat map: the same ground as the 3D view, drawn as line work. It is the fallback for a
// small screen, a slow machine, or a reader who wants no depth at all.
export function PaperSurface({
  data,
  frame,
  size,
  fronts,
  minutes,
}: {
  data: InkMapData;
  frame: Frame;
  size: Size;
  fronts: ScenarioFront[];
  minutes: number;
}) {
  const { scale } = frameTransform(frame, size, PAPER_FIT);
  const { width, height } = size;
  const project = useMemo(() => fitFrame(frame, { width, height }, PAPER_FIT), [frame, width, height]);
  const areas = useMemo(() => groupRings(data, frame, project), [data, frame, project]);
  const roads = useMemo(() => groupRoads(data, frame, project), [data, frame, project]);
  const contours = useMemo(() => contourPath(data, frame, project), [data, frame, project]);
  const burned = fronts.filter((front) => front.minutes <= minutes);
  const upcoming = fronts.find((front) => front.minutes > minutes);

  return (
    <>
      <rect x={0} y={0} width={size.width} height={size.height} fill="var(--map-paper)" />
      {contours && <path d={contours} fill="none" stroke="var(--map-ink)" strokeOpacity={0.16} strokeWidth={0.7} />}
      {areas.map((area) => (
        <path key={area.kind} d={area.d} fill="var(--map-ink)" fillOpacity={AREA_TONE[area.kind] ?? 0.05} />
      ))}
      {roads.map((road) => (
        <path
          key={road.roadClass}
          d={road.d}
          fill="none"
          stroke="var(--map-ink)"
          strokeOpacity={road.roadClass <= 2 ? 0.72 : 0.4}
          strokeWidth={Math.max(0.7, ROAD_WIDTH[road.roadClass] * scale)}
          strokeLinecap="round"
        />
      ))}
      {burned.map((front) => (
        <path
          key={front.minutes}
          d={ringPath(project, front.ring)}
          fill="var(--signal)"
          fillOpacity={0.12}
          stroke="var(--signal)"
          strokeOpacity={0.5}
          strokeWidth={1.2}
        />
      ))}
      {upcoming && <path d={ringPath(project, upcoming.ring)} fill="none" stroke="var(--signal)" strokeWidth={1.4} strokeDasharray="6 5" />}
    </>
  );
}

const fmt = ({ x, y }: { x: number; y: number }) => `${x.toFixed(1)} ${y.toFixed(1)}`;

const line = (project: LocalProjection, point: Point, first: boolean) => `${first ? "M" : "L"}${fmt(project(point))}`;

function ringPath(project: LocalProjection, ring: Point[]) {
  return `${ring.map((point, i) => line(project, point, i === 0)).join("")}Z`;
}

// Only the ground near the frame is worth drawing, so each layer drops what it can't see.
function nearFrame(frame: Frame, point: Point, pad: number) {
  return point[0] >= frame.x0 - pad && point[0] <= frame.x1 + pad && point[1] >= frame.y0 - pad && point[1] <= frame.y1 + pad;
}

function groupRings(data: InkMapData, frame: Frame, project: LocalProjection) {
  const byKind = new Map<number, string[]>();
  for (const area of data.areas) {
    if (!area.ring.some((point) => nearFrame(frame, point, 200))) continue;
    byKind.set(area.kind, [...(byKind.get(area.kind) ?? []), ringPath(project, area.ring)]);
  }
  return [...byKind.entries()].map(([kind, rings]) => ({ kind, d: rings.join("") }));
}

function groupRoads(data: InkMapData, frame: Frame, project: LocalProjection) {
  const byClass = new Map<number, string[]>();
  for (const road of data.roads) {
    if (road.tunnel || road.roadClass > MINOR_ROAD_CLASS || road.path.length < 2) continue;
    if (!road.path.some((point) => nearFrame(frame, point, 60))) continue;
    const d = road.path.map((point, i) => line(project, point, i === 0)).join("");
    byClass.set(road.roadClass, [...(byClass.get(road.roadClass) ?? []), d]);
  }
  return [...byClass.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([roadClass, lines]) => ({ roadClass, d: lines.join("") }));
}

function contourPath(data: InkMapData, frame: Frame, project: LocalProjection) {
  return terrainContours(data.terrain, CONTOUR_INTERVAL, frame)
    .map(([a, b]) => `${line(project, a, true)}${line(project, b, false)}`)
    .join("");
}
