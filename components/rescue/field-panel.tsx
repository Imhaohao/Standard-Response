"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatClock } from "@/lib/time";
import { Panel, PanelEmpty } from "../ui/panel";

// Nobody answered the phone or the text. These are the doors a crew has to knock, in the order
// the fire will reach them.
export function DoorCheckPanel({ className = "" }: { className?: string }) {
  const homes = useQuery(api.doorChecks.queue, { limit: 12 });
  return (
    <Panel title={`Doors to knock (${homes?.length ?? 0})`} className={className}>
      {homes?.length ? (
        <ol className="flex min-h-0 flex-col overflow-y-auto">
          {homes.map((home, index) => (
            <li key={home._id} className="flex items-baseline gap-2.5 border-b border-panel-raised px-3 py-2">
              <span className="type-small w-4 shrink-0 text-right font-bold tabular-nums text-on-panel-muted">{index + 1}</span>
              <span className="type-small min-w-0 flex-1">{home.address}</span>
            </li>
          ))}
        </ol>
      ) : (
        <PanelEmpty>Every home on the list has been reached by phone or text.</PanelEmpty>
      )}
    </Panel>
  );
}

// Addresses callers named for somebody else. Track D places most of them; the ones it couldn't are
// listed here with the reason, because a dispatcher has to read them by hand.
export function NominationPanel({ className = "" }: { className?: string }) {
  const open = useQuery(api.nominations.open);
  const flagged = useQuery(api.nominations.flagged);
  const rows = [...(flagged ?? []), ...(open ?? [])];
  if (rows.length === 0) return null;

  return (
    <Panel title={`Neighbors named on calls (${rows.length})`} className={className}>
      <ul className="flex min-h-0 flex-col overflow-y-auto">
        {rows.map((nomination) => (
          <li key={nomination._id} className="flex flex-col gap-0.5 border-b border-panel-raised px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="type-small min-w-0 flex-1 font-semibold">{nomination.spokenAddress}</span>
              <span className="type-small shrink-0 tabular-nums text-on-panel-muted">{formatClock(nomination.at)}</span>
            </div>
            {nomination.note && <span className="type-small text-signal">{nomination.note}</span>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
