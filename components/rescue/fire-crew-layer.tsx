"use client";

import { Check, FireTruck } from "@phosphor-icons/react";
import { Anchor, MapLine } from "@/components/map/layers";
import { formatSinceWarning } from "@/lib/time";
import { crewAt, CrewMoment, CrewRun, visitedBy } from "@/lib/ink-map/fire-crews";
import { FireCrews, useSmoothMinutes } from "./use-fire-crews";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const EMBER = "var(--ember)";

const ARC_RADIUS = 15;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS;

// A crew that hasn't reached the map yet, or has driven back off it, isn't drawn.
const shown = (run: CrewRun, moment: CrewMoment) => !(run.joinsAtEdge && (moment.kind === "waiting" || moment.kind === "done"));

// The street a crew is driving to its next door, as a dotted ink line, and a ring on that door.
function Heading({ moment }: { moment: CrewMoment }) {
  if (moment.kind !== "driving") return null;
  return (
    <g>
      <MapLine route={moment.ahead} fill="none" stroke={PAPER} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <MapLine route={moment.ahead} fill="none" stroke={INK} strokeWidth={2.4} strokeDasharray="0.1 5" strokeLinecap="round" strokeLinejoin="round" />
      {moment.to && (
        <Anchor point={moment.to.at}>
          <circle r={9} fill="none" stroke={INK} strokeWidth={1.5} />
        </Anchor>
      )}
    </g>
  );
}

// A door the crew is at: a pulse while they help, and an arc that closes as the visit runs its course.
function AtTheDoor({ moment }: { moment: CrewMoment }) {
  if (moment.kind !== "helping") return null;
  return (
    <Anchor point={moment.at}>
      <circle r={9} fill="none" stroke={EMBER} strokeWidth={2} className="animate-ring-out" />
      <circle r={ARC_RADIUS} fill="none" stroke={PAPER} strokeWidth={5} />
      <circle
        r={ARC_RADIUS}
        fill="none"
        stroke={EMBER}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={`${moment.progress * ARC_LENGTH} ${ARC_LENGTH}`}
        transform="rotate(-90)"
      />
    </Anchor>
  );
}

// A door a crew has already knocked: a small check on the home's corner.
function Checked({ at }: { at: [number, number] }) {
  return (
    <Anchor point={at}>
      <g transform="translate(7 -7)">
        <circle r={5.5} fill={PAPER} stroke={INK} strokeWidth={1.2} />
        <Check x={-3.5} y={-3.5} size={7} weight="bold" color={INK} />
      </g>
    </Anchor>
  );
}

// Drawn under the homes and pins: where each crew is heading, the doors being helped, and the doors done.
export function FireCrewTrails({ crews, minutes }: { crews: FireCrews | null; minutes: number }) {
  const now = useSmoothMinutes(minutes);
  if (!crews) return null;
  return (
    <g>
      {visitedBy(crews.runs, now).map((visit) => (
        <Checked key={visit.home} at={visit.at} />
      ))}
      {crews.runs.map((run) => {
        const moment = crewAt(run, now);
        return (
          <g key={run.engine}>
            <Heading moment={moment} />
            <AtTheDoor moment={moment} />
          </g>
        );
      })}
    </g>
  );
}

// Parked at the curb beside the door it is helping at; otherwise right on the street.
const CURB: Record<CrewMoment["kind"], string | undefined> = { helping: "translate(-17 -12)", waiting: undefined, driving: undefined, done: undefined };

function EngineMark({ run, moment, label }: { run: CrewRun; moment: CrewMoment; label: string }) {
  return (
    <Anchor point={moment.at}>
      <g transform={CURB[moment.kind]}>
        <title>{`${run.engine}: ${label}`}</title>
        <circle r={12.5} fill={PAPER} />
        <circle r={10.5} fill={INK} />
        <FireTruck x={-6.5} y={-6.5} size={13} weight="fill" color="white" />
        {moment.kind === "driving" && <circle cx={8} cy={-8} r={3} fill={EMBER} stroke={PAPER} strokeWidth={1.5} className="motion-safe:animate-pulse" />}
      </g>
    </Anchor>
  );
}

// Drawn over everything else on the map, so an engine is never hidden under a home.
export function FireCrewEngines({ crews, minutes }: { crews: FireCrews | null; minutes: number }) {
  const now = useSmoothMinutes(minutes);
  if (!crews) return null;
  return (
    <g>
      {crews.runs.map((run) => {
        const moment = crewAt(run, now);
        if (!shown(run, moment)) return null;
        return <EngineMark key={run.engine} run={run} moment={moment} label={crewStatus(run, moment, crews.homeAddress)} />;
      })}
    </g>
  );
}

// What a crew is doing, in a few words, for the engine's tooltip and the crews panel.
export function crewStatus(run: CrewRun, moment: CrewMoment, homeAddress: Map<string, string>) {
  const address = (home: string) => homeAddress.get(home) ?? "a home in the fire's path";
  if (moment.kind === "waiting") return `Leaves ${run.station} ${formatSinceWarning(Math.ceil(run.leavesAt))} after the warning`;
  if (moment.kind === "helping") return `At ${address(moment.visit.home)}`;
  if (moment.kind === "driving") return moment.to ? `Driving to ${address(moment.to.home)}` : `Heading back to ${run.station}`;
  return "No more homes it can reach before the fire";
}
