"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatSinceWarning } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { Panel, PanelEmpty } from "../ui/panel";

const VISIBLE_DOORS = 5;

function DoorRow({ address, position }: { address: string; position: number }) {
  return (
    <li className="flex items-center gap-2.5 px-4 py-1">
      <span className="type-small grid size-5 shrink-0 place-items-center rounded-full bg-surface-sunk font-bold tabular-nums">{position}</span>
      <span className="type-small min-w-0 flex-1 truncate" title={address}>
        {address}
      </span>
    </li>
  );
}

// Nobody answered the phone or the text. These are the doors a crew has to knock, in the order
// the fire will reach them.
function emptyDoors(warned: boolean, unreached: number) {
  if (!warned) return "After the warning, homes nobody reaches by phone show up here, nearest the fire first.";
  if (unreached > 0) return `No crew has been sent yet. ${unreached === 1 ? "One home" : `${unreached} homes`} in the fire's path ${unreached === 1 ? "hasn't" : "haven't"} been reached.`;
  return "No doors to knock right now.";
}

export function DoorCheckPanel({ unreached = 0, className = "" }: { unreached?: number; className?: string }) {
  const homes = useQuery(api.doorChecks.queue, { limit: 12 });
  const control = useQuery(api.control.get);
  const warned = control?.warningIssuedAt !== undefined;
  const rest = homes?.slice(VISIBLE_DOORS) ?? [];
  return (
    <Panel title="Doors to knock" aside={homes && <span className="type-figure pr-4 text-xl">{homes.length}</span>} className={className}>
      {homes?.length ? (
        <>
          <ol className="flex flex-col pb-2">
            {homes.slice(0, VISIBLE_DOORS).map((home, index) => (
              <DoorRow key={home._id} address={home.address} position={index + 1} />
            ))}
          </ol>
          {rest.length > 0 && (
            <details className="border-t border-panel-raised pb-2">
              <summary className="type-small cursor-pointer px-4 py-2 font-semibold hover:bg-panel-raised">+{rest.length} more</summary>
              <ol className="flex flex-col">
                {rest.map((home, index) => (
                  <DoorRow key={home._id} address={home.address} position={VISIBLE_DOORS + index + 1} />
                ))}
              </ol>
            </details>
          )}
        </>
      ) : (
        <PanelEmpty>{emptyDoors(warned, unreached)}</PanelEmpty>
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
    <Panel title="Neighbors named" aside={<span className="type-figure pr-4 text-xl">{rows.length}</span>} className={className}>
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
