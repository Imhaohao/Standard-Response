"use client";

import { useMemo } from "react";
import { useMapStage } from "@/components/map/map-stage";
import { toLatLng } from "@/lib/crowd/grid";
import { STATE } from "@/lib/crowd/langevin";
import { FlowWorld } from "@/lib/flow/world";
import { SEGMENT_LIST } from "@/lib/mesh/roads";

const INK = "var(--map-ink)";
const PAPER = "var(--map-paper)";
const HAZARD = "var(--signal)";

// Thousands of marks per frame, so each kind of mark is one path of zero-length strokes with
// round caps: a dot per household, drawn in one DOM node.
function dotPath(points: { x: number; y: number; visible: boolean }[]) {
  let d = "";
  for (const p of points) if (p.visible) d += `M${p.x.toFixed(1)} ${p.y.toFixed(1)}h0`;
  return d;
}

function useAgentPoints(world: FlowWorld) {
  const { toScreen } = useMapStage();
  const crowd = world.crowd;
  const groups = { moving: [] as ReturnType<typeof toScreen>[], home: [] as ReturnType<typeof toScreen>[], waiting: [] as ReturnType<typeof toScreen>[] };
  for (let i = 0; i < crowd.count; i++) {
    const state = crowd.state[i];
    const group = state === STATE.moving ? groups.moving : state === STATE.home ? groups.home : state === STATE.waiting ? groups.waiting : null;
    if (group) group.push(toScreen(toLatLng(crowd.x[i], crowd.y[i])));
  }
  return groups;
}

// Households: cars on the road in ink, homes not yet left in faint ink, and everyone who can't
// leave on their own in red, because they are the people this whole system exists for.
export function AgentLayer({ world }: { world: FlowWorld }) {
  const groups = useAgentPoints(world);
  return (
    <g strokeLinecap="round">
      <path d={dotPath(groups.home)} stroke={INK} strokeOpacity={0.28} strokeWidth={2.5} />
      <path d={dotPath(groups.moving)} stroke={PAPER} strokeWidth={5.5} />
      <path d={dotPath(groups.moving)} stroke={INK} strokeWidth={3.5} />
      <path d={dotPath(groups.waiting)} stroke={PAPER} strokeWidth={6.5} />
      <path d={dotPath(groups.waiting)} stroke={HAZARD} strokeWidth={4.5} />
    </g>
  );
}

// Phones that met in the last few seconds of the night, as hairlines between them.
export function MeetingLayer({ world }: { world: FlowWorld }) {
  const { toScreen } = useMapStage();
  const crowd = world.crowd;
  let d = "";
  for (const [i, j] of world.recentMeetings) {
    const a = toScreen(toLatLng(crowd.x[i], crowd.y[i]));
    const b = toScreen(toLatLng(crowd.x[j], crowd.y[j]));
    if (a.visible && b.visible) d += `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return <path d={d} stroke={INK} strokeOpacity={0.45} strokeWidth={0.8} fill="none" />;
}

function streetPath(toScreen: ReturnType<typeof useMapStage>["toScreen"], segments: Iterable<number>) {
  let d = "";
  for (const index of segments) {
    const points = SEGMENT_LIST[index].path.map(toScreen);
    if (!points.some((p) => p.visible)) continue;
    d += points.map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
  }
  return d;
}

// Blocked streets. Faint dashes for every street that is blocked in the simulation; heavy ink for
// the ones the agency has heard about from uploaded phone reports.
// Both sets change only every few simulated minutes, so their paths are kept between frames.
export function BlockedStreetLayer({ truth, known }: { truth: ReadonlySet<number>; known: ReadonlySet<number> }) {
  const { toScreen } = useMapStage();
  const truthPath = useMemo(() => streetPath(toScreen, truth), [toScreen, truth]);
  const knownPath = useMemo(() => streetPath(toScreen, known), [toScreen, known]);
  return (
    <g fill="none" strokeLinecap="butt">
      <path d={truthPath} stroke={INK} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="3 4" />
      <path d={knownPath} stroke={PAPER} strokeWidth={6} />
      <path d={knownPath} stroke={INK} strokeWidth={4} strokeDasharray="2 2" />
    </g>
  );
}
