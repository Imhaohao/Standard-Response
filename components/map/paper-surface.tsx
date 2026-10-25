"use client";

import { useMemo } from "react";
import { terrainContours } from "@/lib/ink-map/contours";
import { AREA_KIND, areaRings, InkMapData, Point, ROAD_WIDTH } from "@/lib/ink-map/data";
import { fieldGrid } from "@/lib/ink-map/fire-field";
import type { Hazard } from "@/lib/ink-map/hazard";
import { HAZARD_LAYERS } from "@/lib/ink-map/hazard-layers/registry";
import { isolines } from "@/lib/ink-map/isolines";
import { Frame, fitFrame, frameTransform, LocalProjection, Size } from "./projection";

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

// The flat map: the same ground as the 3D view, drawn as line work over a frame that fills the
// box. It is the fallback for a small screen, a slow machine, or a reader who wants no depth at all.
export function PaperSurface({
  data,
  frame,
  size,
  hazard,
  minutes,
}: {
  data: InkMapData;
  frame: Frame;
  size: Size;
  hazard: Hazard | null;
  minutes: number;
}) {
  const { scale } = frameTransform(frame, size);
  const { width, height } = size;
  const project = useMemo(() => fitFrame(frame, { width, height }), [frame, width, height]);
  const areas = useMemo(() => groupRings(data, frame, project), [data, frame, project]);
  const roads = useMemo(() => groupRoads(data, frame, project), [data, frame, project]);
  const contours = useMemo(() => contourPath(data, frame, project), [data, frame, project]);

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
      {hazard && <FlatHazard data={data} hazard={hazard} minutes={minutes} project={project} />}
    </>
  );
}

// The hazard at the minute on the clock, drawn by its kind's flat drawing (hazard-layers/registry.ts)
// over outlines traced from the same arrival times the 3D map shades.
function FlatHazard({ data, hazard, minutes, project }: { data: InkMapData; hazard: Hazard; minutes: number; project: LocalProjection }) {
  const { field } = hazard;
  const trace = useMemo(() => {
    const grid = fieldGrid(field);
    return (level: number) => isolines(grid, level).map((ring) => ringPath(project, ring)).join("");
  }, [field, project]);
  const Drawing = HAZARD_LAYERS[hazard.kind ?? "wildfire"].paper;
  return <Drawing data={data} field={field} scenario={hazard.scenario ?? null} minutes={minutes} burns={hazard.burns !== false} project={project} trace={trace} />;
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
    byKind.set(area.kind, [...(byKind.get(area.kind) ?? []), ...areaRings(area).map((ring) => ringPath(project, ring))]);
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
