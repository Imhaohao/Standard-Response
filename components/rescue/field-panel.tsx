"use client";

import { FireTruck, Warning } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { doorStates, DoorState } from "@/lib/ink-map/fire-crews";
import { formatSinceWarning } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { Panel, PanelEmpty } from "../ui/panel";
import { DoorQueue, FireCrews } from "./use-fire-crews";

const VISIBLE_DOORS = 5;

// What a row shows beside the address: the engine on its way or at the door, or a mark for a door no
// engine can reach in time.
function DoorMark({ state }: { state: DoorState | undefined }) {
  if (state?.kind === "sent") {
    return (
      <span className="type-small inline-flex shrink-0 items-center gap-1 text-on-panel-muted">
        <FireTruck weight="fill" className="size-3.5" aria-hidden />
        {state.engine}
      </span>
    );
  }
  if (state?.kind === "passed") return <Warning weight="fill" className="size-3.5 shrink-0 text-signal" role="img" aria-label="No engine can reach it before the fire" />;
  return null;
}

function DoorRow({ address, position, state }: { address: string; position: number; state: DoorState | undefined }) {
  return (
    <li className="flex items-center gap-2.5 px-4 py-1">
      <span className="type-small grid size-5 shrink-0 place-items-center rounded-full bg-surface-sunk font-bold tabular-nums">{position}</span>
      <span className="type-small min-w-0 flex-1 truncate" title={address}>
        {address}
      </span>
      <DoorMark state={state} />
    </li>
  );
}

function emptyDoors(warned: boolean, unreached: number, enginesIdle: boolean) {
  if (!warned) return "After the warning, homes nobody reaches by phone show up here, most urgent first.";
  const waiting = enginesIdle ? "No door to knock yet, so the engines wait at their stations." : "No door to knock yet.";
  if (unreached > 0) return `${waiting} ${unreached === 1 ? "One home" : `${unreached} homes`} in the fire's path ${unreached === 1 ? "hasn't" : "haven't"} been reached.`;
  return enginesIdle ? waiting : "No doors to knock right now.";
}

type ListedDoor = DoorQueue[number] & { state: DoorState | undefined };

// How the engines stand on the list: how many are on a door, which number goes next, and how many
// doors no engine can reach in time.
function crewLine(doors: ListedDoor[], working: number) {
  const next = doors.findIndex((door) => door.state === undefined && door.lat !== undefined && door.lng !== undefined);
  const passed = doors.filter((door) => door.state?.kind === "passed").length;
  const lines = [];
  if (working > 0) lines.push(working === 1 ? "One engine is working the list." : `${working} engines are working the list.`);
  if (next >= 0) lines.push(`No. ${next + 1} is next.`);
  if (passed > 0) lines.push(`No engine can reach ${passed === 1 ? "one of these" : `${passed} of these`} and leave 3 minutes before the fire.`);
  return lines.join(" ");
}

function DoorList({ doors }: { doors: ListedDoor[] }) {
  const rest = doors.slice(VISIBLE_DOORS);
  return (
    <>
      <ol className="flex flex-col pb-2">
        {doors.slice(0, VISIBLE_DOORS).map((door, index) => (
          <DoorRow key={door._id} address={door.address} position={index + 1} state={door.state} />
        ))}
      </ol>
      {rest.length > 0 && (
        <details className="border-t border-panel-raised pb-2">
          <summary className="type-small cursor-pointer px-4 py-2 font-semibold hover:bg-panel-raised">+{rest.length} more</summary>
          <ol className="flex flex-col">
            {rest.map((door, index) => (
              <DoorRow key={door._id} address={door.address} position={VISIBLE_DOORS + index + 1} state={door.state} />
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

// Nobody answered the phone or the text. These are the doors a field crew has to knock, in the
// door-check list's order, which is the order the fire crews on the map take them in. A door the
// playback's crews have knocked drops off; the rest show which engine is on its way.
export function DoorCheckPanel({
  queue,
  crews,
  minutes,
  unreached = 0,
  className = "",
}: {
  queue: DoorQueue | undefined;
  crews: FireCrews | null;
  minutes: number;
  unreached?: number;
  className?: string;
}) {
  const control = useQuery(api.control.get);
  const warned = control?.warningIssuedAt !== undefined;
  const states = crews ? doorStates(crews.runs, minutes) : new Map<string, DoorState>();
  const working = [...states.values()].filter((state) => state.kind === "sent").length;
  const doors = (queue ?? []).map((door) => ({ ...door, state: states.get(door._id) })).filter((door) => door.state?.kind !== "knocked");
  const line = crews && doors.length > 0 ? crewLine(doors, working) : "";
  return (
    <Panel title="Doors to knock" aside={queue && <span className="type-figure pr-4 text-xl">{doors.length}</span>} className={className}>
      {line && <p className="type-small px-4 pb-2 text-on-panel-muted">{line}</p>}
      {doors.length > 0 ? (
        <DoorList doors={doors} />
      ) : (
        <PanelEmpty>{queue?.length ? "The engines have knocked every door on the list." : emptyDoors(warned, unreached, crews !== null && working === 0)}</PanelEmpty>
      )}
    </Panel>
  );
}

// Addresses callers named for somebody else. Address matching places most of them; the ones it couldn't are
// listed here with the reason, because a dispatcher has to read them by hand.
export function NominationPanel({ className = "" }: { className?: string }) {
  const open = useQuery(api.nominations.open);
  const flagged = useQuery(api.nominations.flagged);
  const rows = [...(flagged ?? []), ...(open ?? [])];
  const now = useSimNow(15_000);
  if (rows.length === 0) return null;

  return (
    <Panel title="Neighbors to check on" aside={<span className="type-figure pr-4 text-xl">{rows.length}</span>} className={className}>
      <ul className="flex min-h-0 flex-col overflow-y-auto pb-2">
        {rows.map((nomination) => (
          <li key={nomination._id} className="flex items-center gap-2 px-4 py-1" title={nomination.note ?? undefined}>
            <span className="type-small min-w-0 flex-1 truncate font-semibold">
              <SpokenAddress spoken={nomination.spokenAddress} />
              {nomination.note && <span className="font-normal text-on-panel-muted"> {nomination.note}</span>}
            </span>
            <span className="type-small shrink-0 tabular-nums text-on-panel-muted">{formatSinceWarning((now - nomination.at) / 60_000)} ago</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// What the caller said, as they said it. A street number with no street ("30") can't be found on
// the map, so it is marked as incomplete rather than shown as if it were an address.
function SpokenAddress({ spoken }: { spoken: string }) {
  if (/[a-z]/i.test(spoken)) return <>{spoken}</>;
  return (
    <>
      “{spoken}” <span className="font-normal text-signal">address incomplete</span>
    </>
  );
}
