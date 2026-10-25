"use client";

import { Check, FireTruck } from "@phosphor-icons/react";
import { crewAt, CrewRun, visitedBy } from "@/lib/ink-map/fire-crews";
import { Panel } from "../ui/panel";
import { crewStatus } from "./fire-crew-layer";
import { FireCrews } from "./use-fire-crews";

// The engine as the map draws it, so the row and the mark read as the same thing.
function EngineChip() {
  return (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-map-ink" aria-hidden>
      <FireTruck weight="fill" className="size-3.5 text-white" />
    </span>
  );
}

function CrewRow({ run, minutes, homeAddress }: { run: CrewRun; minutes: number; homeAddress: Map<string, string> }) {
  const status = crewStatus(run, crewAt(run, minutes), homeAddress);
  const doors = run.visits.filter((visit) => visit.leaveMinutes <= minutes).length;
  return (
    <li className="flex items-center gap-2.5 px-4 py-1" title={`${run.engine}, ${run.station}. ${status}`}>
      <EngineChip />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-small font-semibold">{run.engine}</span>
        <span className="type-small truncate text-on-panel-muted">{status}</span>
      </span>
      <span className="type-small shrink-0 tabular-nums text-on-panel-muted" aria-label={`${doors} doors knocked`}>
        {doors}
      </span>
    </li>
  );
}

// Who the crews are, what each is doing now and how many doors it has knocked. The rows double as
// the legend for the engines, the dotted lines to their next door and the checks on doors done.
export function FireCrewPanel({ crews, minutes }: { crews: FireCrews | null; minutes: number }) {
  if (!crews) return null;
  const knocked = visitedBy(crews.runs, minutes).length;
  return (
    <Panel
      title="Fire crews"
      aside={
        <span className="type-small inline-flex items-center gap-1 pr-2 font-semibold tabular-nums" title="Doors the crews have knocked">
          <Check weight="bold" className="size-3.5" aria-hidden />
          {knocked}
        </span>
      }
    >
      <ul className="flex flex-col pb-2">
        {crews.runs.map((run) => (
          <CrewRow key={run.engine} run={run} minutes={minutes} homeAddress={crews.homeAddress} />
        ))}
      </ul>
      <p className="type-small px-4 pb-3 text-on-panel-muted">
        A playback, not live positions. Engines leave LA County Fire stations at the warning and knock on doors in the fire&rsquo;s path, in the same order as the door-check list. Station points are approximate.
      </p>
    </Panel>
  );
}
