"use client";

import { Car, Check, Handshake, LinkBreak, PhoneCall, type Icon } from "@phosphor-icons/react";
import { Anchor } from "@/components/map/layers";
import { useMapStage } from "@/components/map/map-stage";
import { Point } from "@/lib/ink-map/data";
import { Pickup, PickupStatus } from "./use-pickups";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const SIGNAL = "var(--signal)";
const BULGE = 0.22;

type ArcLook = { stroke: string; width: number; opacity: number; dash?: string; className?: string };

// A promise between neighbors, drawn the way van routes are: dotted while it's only on file,
// marching while we call, solid with moving ticks once the helper is on the way, and broken in red
// when it fell through.
const ARC: Record<PickupStatus, ArcLook> = {
  arranged: { stroke: INK, width: 1.4, opacity: 0.55, dash: "1 4" },
  checking: { stroke: INK, width: 1.8, opacity: 0.9, dash: "4 4", className: "animate-dash-flow" },
  coming: { stroke: INK, width: 2.4, opacity: 1 },
  done: { stroke: INK, width: 1.2, opacity: 0.22 },
  fell_through: { stroke: SIGNAL, width: 2.4, opacity: 1, dash: "42 16 42" },
};

const BADGE: Record<PickupStatus, { Icon: Icon; fill: string }> = {
  arranged: { Icon: Handshake, fill: INK },
  checking: { Icon: PhoneCall, fill: INK },
  coming: { Icon: Car, fill: INK },
  done: { Icon: Check, fill: INK },
  fell_through: { Icon: LinkBreak, fill: SIGNAL },
};

// A gentle curve from the helper's door to the resident's, bowed to one side so two arcs between
// close neighbors don't sit on top of each other.
function arcPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const cx = mx - (to.y - from.y) * BULGE;
  const cy = my + (to.x - from.x) * BULGE;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
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

function Arc({ pickup, emphasis }: { pickup: Pickup & { helperAt: Point }; emphasis: number }) {
  const { project } = useMapStage();
  const from = project(pickup.helperAt);
  const to = project(pickup.at);
  if (!from.visible && !to.visible) return null;
  const look = ARC[pickup.status];
  const d = arcPath(from, to);
  const width = look.width + (emphasis > 1 ? 1.5 : 0);
  return (
    <g opacity={look.opacity * Math.min(emphasis, 1)} className="transition-opacity duration-200">
      <path d={d} fill="none" stroke={PAPER} strokeWidth={width + 3} strokeLinecap="round" pathLength={100} strokeDasharray={look.dash && pickup.status === "fell_through" ? look.dash : undefined} />
      <path d={d} fill="none" stroke={look.stroke} strokeWidth={width} strokeLinecap="round" pathLength={100} strokeDasharray={look.dash} className={look.className} />
      {pickup.status === "coming" && <path d={d} fill="none" stroke={PAPER} strokeWidth={width * 0.5} strokeLinecap="round" strokeDasharray="1 7" pathLength={100} className="animate-dash-flow" />}
      {from.visible && <circle cx={from.x} cy={from.y} r={3.5} fill={look.stroke} stroke={PAPER} strokeWidth={1.5} />}
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

const hasHelperHome = (pickup: Pickup): pickup is Pickup & { helperAt: Point } => pickup.helperAt !== null;

export function PickupLayer({ pickups, focusHouseholdId }: { pickups: Pickup[]; focusHouseholdId: string | null }) {
  // Broken promises draw last so the red is never under an ink arc.
  const ordered = [...pickups].sort((a, b) => Number(a.status === "fell_through") - Number(b.status === "fell_through"));
  return (
    <g>
      {ordered.filter(hasHelperHome).map((pickup) => (
        <Arc key={pickup._id} pickup={pickup} emphasis={emphasisOf(pickup, focusHouseholdId)} />
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
