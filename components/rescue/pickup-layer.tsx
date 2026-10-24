"use client";

import { Car, Check, Handshake, LinkBreak, PhoneCall, type Icon } from "@phosphor-icons/react";
import { Anchor } from "@/components/map/layers";
import { useMapStage } from "@/components/map/map-stage";
import { Point } from "@/lib/ink-map/data";
import { Pickup, PickupStatus } from "./use-pickups";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const SIGNAL = "var(--signal)";

type ArcLook = { stroke: string; width: number; opacity: number; dash?: string; className?: string };

// A promise between neighbors, drawn along the streets the helper drives, the way van routes are:
// dotted while it's only on file,
// marching while we call, solid with moving ticks once the helper is on the way, and broken in red
// when it fell through.
const ARC: Record<PickupStatus, ArcLook> = {
  arranged: { stroke: INK, width: 2, opacity: 0.85, dash: "2 4" },
  checking: { stroke: INK, width: 2.2, opacity: 1, dash: "6 6", className: "animate-dash-flow" },
  coming: { stroke: INK, width: 2.6, opacity: 1 },
  done: { stroke: INK, width: 1.4, opacity: 0.3 },
  fell_through: { stroke: SIGNAL, width: 2.6, opacity: 1 },
};

// The broken promise: the drive with its middle missing, measured along the path so the gap always
// sits in the middle however long the drive is.
const BROKEN = { pathLength: 100, strokeDasharray: "40 20 40" };

const BADGE: Record<PickupStatus, { Icon: Icon; fill: string }> = {
  arranged: { Icon: Handshake, fill: INK },
  checking: { Icon: PhoneCall, fill: INK },
  coming: { Icon: Car, fill: INK },
  done: { Icon: Check, fill: INK },
  fell_through: { Icon: LinkBreak, fill: SIGNAL },
};

function screenPath(points: { x: number; y: number }[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

function Ringing({ at }: { at: Point }) {
  return (
    <Anchor point={at}>
      <circle r={9} fill="none" stroke={INK} strokeWidth={2} className="animate-ring-out" />
      <circle r={8} fill={INK} stroke={PAPER} strokeWidth={2} />
      <PhoneCall x={-5} y={-5} size={10} weight="fill" color="white" />
    </Anchor>
  );
}

function Drive({ pickup, emphasis }: { pickup: Pickup & { helperAt: Point; drive: Point[] }; emphasis: number }) {
  const { project } = useMapStage();
  const points = pickup.drive.map((point) => project(point));
  const from = points[0];
  if (!points.some((point) => point.visible)) return null;
  const look = ARC[pickup.status];
  const d = screenPath(points);
  const width = look.width + (emphasis > 1 ? 1.5 : 0);
  const broken = pickup.status === "fell_through" ? BROKEN : {};
  return (
    <g opacity={look.opacity * Math.min(emphasis, 1)} className="transition-opacity duration-200">
      <path d={d} fill="none" stroke={PAPER} strokeWidth={width + 3} strokeLinecap="round" strokeLinejoin="round" {...broken} />
      <path d={d} fill="none" stroke={look.stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={look.dash} className={look.className} {...broken} />
      {pickup.status === "coming" && <path d={d} fill="none" stroke={PAPER} strokeWidth={width * 0.5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 10" className="animate-dash-flow" />}
      {from.visible && <circle cx={from.x} cy={from.y} r={4} fill={look.stroke} stroke={PAPER} strokeWidth={2} />}
    </g>
  );
}

// Family coming from outside the map has no door to draw from: a badge on the home says it instead.
function Badge({ pickup, emphasis }: { pickup: Pickup; emphasis: number }) {
  const { Icon, fill } = BADGE[pickup.status];
  return (
    <Anchor point={pickup.at}>
      <g transform="translate(11 -11)" opacity={(pickup.status === "done" ? 0.35 : 1) * Math.min(emphasis, 1)}>
        <circle r={emphasis > 1 ? 10 : 8} fill={fill} stroke={PAPER} strokeWidth={2} />
        <Icon x={-5} y={-5} size={10} weight="bold" color="white" />
      </g>
    </Anchor>
  );
}

// Emphasis: 2 for the pickup being looked at, 0.35 for the rest while one is, 1 otherwise.
const emphasisOf = (pickup: Pickup, focusHouseholdId: string | null) =>
  focusHouseholdId === null ? 1 : pickup.householdId === focusHouseholdId ? 2 : 0.35;

const hasHelperHome = (pickup: Pickup): pickup is Pickup & { helperAt: Point; drive: Point[] } => pickup.helperAt !== null && pickup.drive !== null;

export function PickupLayer({ pickups, focusHouseholdId }: { pickups: Pickup[]; focusHouseholdId: string | null }) {
  // Broken promises draw last so the red is never under an ink arc.
  const ordered = [...pickups].sort((a, b) => Number(a.status === "fell_through") - Number(b.status === "fell_through"));
  return (
    <g>
      {ordered.filter(hasHelperHome).map((pickup) => (
        <Drive key={pickup._id} pickup={pickup} emphasis={emphasisOf(pickup, focusHouseholdId)} />
      ))}
      {ordered
        .filter((pickup) => !hasHelperHome(pickup))
        .map((pickup) => (
          <Badge key={pickup._id} pickup={pickup} emphasis={emphasisOf(pickup, focusHouseholdId)} />
        ))}
      {ordered.map((pickup) => {
        if (pickup.ringing === "helper" && pickup.helperAt) return <Ringing key={`${pickup._id}-ring`} at={pickup.helperAt} />;
        if (pickup.ringing === "resident") return <Ringing key={`${pickup._id}-ring`} at={pickup.at} />;
        return null;
      })}
    </g>
  );
}
