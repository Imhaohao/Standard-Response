"use client";

import { useQuery } from "convex/react";
import { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Anchor, GeoLine, MapLine } from "@/components/map/layers";
import { Point } from "@/lib/ink-map/data";
import { ArrowsClockwise, Pause, Users, Van as VanIcon, Wheelchair } from "@phosphor-icons/react";
import { headCount } from "./request-badge";
import { Person, Van, VanState } from "./use-rescue-board";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const HAZARD = "var(--signal)";

const WAITING: Person["status"][] = ["received", "approved", "reassigning"];

// One badge per person, readable without reading: red means still waiting for a driver, ink means
// a driver said yes. The glyph says what they need: a wheelchair, or how many people.
function RequestPin({ person, focused }: { person: Person; focused: boolean }) {
  const waiting = WAITING.includes(person.status) && person.assignment?.status !== "accepted";
  const escalated = Boolean(person.escalation);
  // Someone a driver already has is settled: drawn small, so the red pins carry the map.
  const r = escalated ? 12 : waiting ? 10 : 7;
  const fill = waiting || escalated ? HAZARD : INK;
  const reassigning = person.status === "reassigning";
  return (
    <Anchor point={person.at}>
      {focused && <circle r={r + 9} fill="none" stroke={INK} strokeWidth={2.5} />}
      {escalated && <circle r={r} fill="none" stroke={HAZARD} strokeWidth={2} className="animate-ring-out" />}
      <circle r={r + 2.5} fill={PAPER} />
      <circle r={r} fill={fill} strokeDasharray={reassigning ? "4 3" : undefined} stroke={reassigning ? PAPER : "none"} strokeWidth={1.5} />
      {person.needsLift ? (
        <Wheelchair x={-r * 0.62} y={-r * 0.66} size={r * 1.28} weight="bold" color="white" />
      ) : (
        <text y={r * 0.38} textAnchor="middle" fontSize={r * 1.1} fontWeight={800} fill="white">
          {headCount(person)}
        </text>
      )}
    </Anchor>
  );
}

// The little round badge on a van's corner: the one thing worth knowing about it right now.
const STATE_BADGE: Partial<Record<VanState, { icon: ReactNode; spin?: boolean; label: string }>> = {
  rerouting: { icon: <ArrowsClockwise weight="bold" size={11} color="white" x={-5.5} y={-5.5} />, spin: true, label: "Changed course" },
  stalled: { icon: <Pause weight="fill" size={10} color="white" x={-5} y={-5} />, label: "Not moving" },
  idle: { icon: <Pause weight="fill" size={10} color="white" x={-5} y={-5} />, label: "Idle" },
  boarding: { icon: <Users weight="fill" size={10} color="white" x={-5} y={-5} />, label: "Picking up" },
};

function VanMark({ van, onHover }: { van: Van; onHover: (id: string | null) => void }) {
  const busy = van.stops.length > 0;
  const label = van.vehicle.label;
  const width = label.length * 6.6 + 26;
  const badge = STATE_BADGE[van.state];
  return (
    <Anchor point={van.at}>
      <g
        transform={`translate(${-width / 2} -10)`}
        className="pointer-events-auto cursor-pointer"
        onPointerEnter={() => onHover(van.vehicle._id)}
        onPointerLeave={() => onHover(null)}
      >
        <rect width={width} height={20} rx={5} fill={busy ? INK : PAPER} stroke={busy ? PAPER : INK} strokeWidth={busy ? 2 : 1.5} />
        <VanIcon x={5} y={3} size={14} weight="fill" color={busy ? "white" : INK} />
        <text x={22} y={14} fontSize={11} fontWeight={700} fill={busy ? "white" : INK}>
          {label}
        </text>
        {badge && (
          <g transform={`translate(${width} 0)`}>
            <title>{badge.label}</title>
            <circle r={8} fill={INK} stroke={PAPER} strokeWidth={2} />
            <g className={badge.spin ? "motion-safe:animate-spin" : undefined} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
              {badge.icon}
            </g>
          </g>
        )}
      </g>
    </Anchor>
  );
}

// The streets a van will drive, from where it is through each stop. Solid with moving ticks once a
// driver has said yes; dashed while it is only an offer, because an offer is not a commitment.
function VanRoute({ van, focused, faded }: { van: Van; focused: boolean; faded: boolean }) {
  if (!van.route) return null;
  const rerouting = van.state === "rerouting";
  const width = focused || rerouting ? 3.2 : 2.2;
  return (
    <g opacity={faded ? 0.15 : van.committed || focused ? 1 : 0.8} className="transition-opacity duration-200">
      <MapLine route={van.route} fill="none" stroke={PAPER} strokeWidth={width + 3} strokeLinecap="round" strokeLinejoin="round" />
      <MapLine
        route={van.route}
        fill="none"
        stroke={INK}
        strokeWidth={van.committed ? width : width - 0.6}
        strokeDasharray={van.committed ? undefined : "6 5"}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={van.committed ? "" : "animate-dash-flow"}
      />
      {van.committed && (
        <MapLine route={van.route} fill="none" stroke={PAPER} strokeWidth={width * 0.5} strokeDasharray="2 10" strokeLinecap="round" className="animate-dash-flow" />
      )}
    </g>
  );
}

function Closures() {
  const closures = useQuery(api.roads.closures);
  return (
    <>
      {closures?.map((closure) => (
        <g key={closure._id}>
          <GeoLine route={closure.path} stroke={PAPER} strokeWidth={7} strokeLinecap="round" fill="none" />
          <GeoLine route={closure.path} stroke={HAZARD} strokeWidth={3.5} strokeLinecap="round" strokeDasharray="1 6" fill="none" />
        </g>
      ))}
    </>
  );
}

function Zone() {
  const zone = useQuery(api.riders.currentZone);
  if (!zone) return null;
  return <GeoLine route={zone.polygon} close fill={INK} fillOpacity={0.05} stroke={INK} strokeWidth={1.6} strokeDasharray="9 5" />;
}

// What the dispatcher is drawing right now, before it is saved.
function Draft({ tool, draft }: { tool: string; draft: Point[] }) {
  if (draft.length === 0) return null;
  const color = tool === "closure" ? HAZARD : INK;
  const closed = tool === "zone" && draft.length > 2;
  return (
    <g>
      <MapLine route={closed ? [...draft, draft[0]] : draft} fill={closed ? color : "none"} fillOpacity={0.08} stroke={color} strokeWidth={2.5} strokeDasharray="7 5" />
      {draft.map((point, index) => (
        <Anchor key={index} point={point}>
          <circle r={4} fill={color} stroke={PAPER} strokeWidth={2} />
        </Anchor>
      ))}
    </g>
  );
}

type OverlayProps = {
  tool: string;
  draft: Point[];
  people: Person[];
  vans: Van[];
  focusId: string | null;
  vanFocusId: string | null;
  onVanHover: (id: string | null) => void;
};

// The van whose run is being looked at: one hovered directly, or the van serving the person hovered.
function lookedAtVan(people: Person[], focusId: string | null, vanFocusId: string | null) {
  return vanFocusId ?? people.find((person) => person._id === focusId)?.assignment?.vehicleId ?? null;
}

export function MapOverlays({ tool, draft, people, vans, focusId, vanFocusId, onVanHover }: OverlayProps) {
  const focusedVan = lookedAtVan(people, focusId, vanFocusId);
  // Red pins draw last so a person waiting is never hidden under a van or a covered neighbour.
  const ordered = [...people].sort((a, b) => Number(WAITING.includes(a.status)) - Number(WAITING.includes(b.status)));
  // The looked-at route draws last, on top of every other.
  const routes = [...vans].sort((a, b) => Number(a.vehicle._id === focusedVan) - Number(b.vehicle._id === focusedVan));
  return (
    <g>
      <Zone />
      <Closures />
      {routes.map((van) => (
        <VanRoute key={van.vehicle._id} van={van} focused={van.vehicle._id === focusedVan} faded={focusedVan !== null && van.vehicle._id !== focusedVan} />
      ))}
      {vans.map((van) => (
        <VanMark key={van.vehicle._id} van={van} onHover={onVanHover} />
      ))}
      {ordered.map((person) => (
        <RequestPin key={person._id} person={person} focused={person._id === focusId || (vanFocusId !== null && person.assignment?.vehicleId === vanFocusId)} />
      ))}
      <Draft tool={tool} draft={draft} />
    </g>
  );
}
