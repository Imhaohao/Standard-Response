"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ScreenPoint, useCameraVersion, useMapStage } from "@/components/map/map-stage";
import { Point } from "@/lib/ink-map/data";
import { FireField } from "@/lib/ink-map/fire-field";
import { Hazard } from "@/lib/ink-map/hazard";
import { burnedPoints, frontSpread, SpreadVector } from "@/lib/ink-map/fire-spread";

const PAPER = "var(--map-paper)";
const HAZARD = "var(--signal)";
// Each arrow ends where that stretch of front will be this many minutes from now.
const ARROW_MINUTES = 10;
const HOVER_RADIUS_PX = 36;

type ScreenArrow = { tail: ScreenPoint; head: ScreenPoint; metersPerMinute: number };

function toArrow(project: (point: Point) => ScreenPoint, vector: SpreadVector): ScreenArrow {
  const reach = vector.metersPerMinute * ARROW_MINUTES;
  const head: Point = [vector.at[0] + vector.direction[0] * reach, vector.at[1] + vector.direction[1] * reach];
  return { tail: project(vector.at), head: project(head), metersPerMinute: vector.metersPerMinute };
}

function nearest<T>(items: T[], at: (item: T) => ScreenPoint, x: number, y: number) {
  let best: { item: T; distance: number } | null = null;
  for (const item of items) {
    const point = at(item);
    if (!point.visible) continue;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (!best || distance < best.distance) best = { item, distance };
  }
  return best;
}

type Overlay = { svg: SVGSVGElement; stage: HTMLElement; rect: DOMRect };

// The pointer in overlay pixels while it is over the map itself, not a panel floating above it.
// It updates at most once a frame and not at all while a button is held, so a drag across the map
// costs nothing here; the box's position is read only when it changes size.
function usePointerOverMap(anchor: React.RefObject<SVGGElement | null>) {
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let overlay: Overlay | null = null;
    let frame = 0;
    let latest: PointerEvent | null = null;
    const measure = () => {
      const svg = anchor.current?.ownerSVGElement;
      const stage = svg?.parentElement;
      overlay = svg && stage ? { svg, stage, rect: svg.getBoundingClientRect() } : null;
    };
    const resized = new ResizeObserver(measure);
    const firstMeasure = () => {
      measure();
      if (overlay) resized.observe(overlay.svg);
    };
    const update = () => {
      frame = 0;
      const event = latest;
      if (!overlay) firstMeasure();
      if (!event || !overlay || event.buttons !== 0 || !(event.target instanceof Node) || !overlay.stage.contains(event.target)) return setPointer(null);
      setPointer({ x: event.clientX - overlay.rect.left, y: event.clientY - overlay.rect.top });
    };
    const onMove = (event: PointerEvent) => {
      latest = event;
      frame ||= requestAnimationFrame(update);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", measure, { capture: true });
    };
  }, [anchor]);
  return pointer;
}

function Arrow({ arrow, focused }: { arrow: ScreenArrow; focused: boolean }) {
  const { tail, head } = arrow;
  const angle = (Math.atan2(head.y - tail.y, head.x - tail.x) * 180) / Math.PI;
  const width = focused ? 3 : 2;
  return (
    <g>
      <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={PAPER} strokeWidth={width + 3} strokeLinecap="round" />
      <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y} stroke={HAZARD} strokeWidth={width} strokeLinecap="round" />
      <path d="M0 0 L-9 -5 L-9 5 Z" transform={`translate(${head.x} ${head.y}) rotate(${angle})`} fill={HAZARD} stroke={PAPER} strokeWidth={1.5} />
      <circle cx={tail.x} cy={tail.y} r={focused ? 3.5 : 2.5} fill={HAZARD} stroke={PAPER} strokeWidth={1.5} />
    </g>
  );
}

function SpeedLabel({ arrow }: { arrow: ScreenArrow }) {
  const text = `${Math.round(arrow.metersPerMinute)} m/min`;
  const width = text.length * 7 + 16;
  return (
    <g transform={`translate(${arrow.head.x + 8} ${arrow.head.y - 26})`}>
      <rect width={width} height={22} rx={11} fill={HAZARD} stroke={PAPER} strokeWidth={2} />
      <text x={width / 2} y={15} textAnchor="middle" fontSize={12} fontWeight={700} fill="white" className="tabular-nums">
        {text}
      </text>
    </g>
  );
}

// Hovering the fire shows how fast each stretch of its front is advancing, and which way.
export function FireSpreadLayer({ hazard, minutes }: { hazard: Hazard | null; minutes: number }) {
  if (!hazard) return null;
  return <SpreadArrows field={hazard.field} minutes={minutes} />;
}

function SpreadArrows({ field, minutes }: { field: FireField; minutes: number }) {
  const { project } = useMapStage();
  // The arrows show only under a resting pointer, so a re-render after the camera moves is cheap.
  const camera = useCameraVersion();
  const anchor = useRef<SVGGElement>(null);
  const pointer = usePointerOverMap(anchor);
  const minute = Math.floor(minutes);
  const vectors = useMemo(() => frontSpread(field, minute), [field, minute]);
  const burned = useMemo(() => burnedPoints(field, minute), [field, minute]);
  const hovering = pointer !== null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `camera` changes whenever the camera moves
  const arrows = useMemo(() => (hovering ? vectors.map((vector) => toArrow(project, vector)) : []), [hovering, vectors, project, camera]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `camera` changes whenever the camera moves
  const burnedOnScreen = useMemo(() => (hovering ? burned.map((point) => project(point)) : []), [hovering, burned, project, camera]);

  const overFire = pointer !== null && (nearest(burnedOnScreen, (point) => point, pointer.x, pointer.y)?.distance ?? Infinity) <= HOVER_RADIUS_PX;
  const focused = overFire ? nearest(arrows, (arrow) => arrow.tail, pointer.x, pointer.y)?.item : undefined;

  return (
    <g ref={anchor} className="transition-opacity duration-200" opacity={overFire ? 1 : 0}>
      {overFire &&
        arrows.filter((arrow) => arrow.tail.visible && arrow.head.visible).map((arrow, i) => <Arrow key={i} arrow={arrow} focused={arrow === focused} />)}
      {focused && <SpeedLabel arrow={focused} />}
    </g>
  );
}
