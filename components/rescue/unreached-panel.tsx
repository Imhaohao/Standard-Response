"use client";

import { useMutation } from "convex/react";
import { Phone, Warning } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { phoneForPeople } from "@/lib/labels";
import { Button, ButtonLink } from "../ui/button";
import { Panel } from "../ui/panel";
import { streetOf } from "./need-panel";
import { Unreached } from "./unreached";

type HomeFocus = { onFocus: (householdId: string) => void; onHover: (householdId: string | null) => void };

function fireWords({ inFire, minutesToFire }: Unreached) {
  if (inFire) return "Fire there now";
  if (minutesToFire === null) return "Fire likely within the hour";
  return `Fire in ${Math.max(1, Math.round(minutesToFire))} min`;
}

// The same red square the map paints on the home, pulsing while the fire is on it.
function UnreachedSwatch({ inFire }: { inFire: boolean }) {
  return (
    <span className="relative grid size-8 shrink-0 place-items-center" aria-hidden>
      {inFire && <span className="absolute size-6 rounded-sm bg-signal/40 motion-safe:animate-ping" />}
      <span className="size-3.5 bg-signal ring-2 ring-panel" />
    </span>
  );
}

// A backend deployed before these fields sends no address or number; the row still shows and the
// call button waits for a number.
function UnreachedRow({ entry, focus }: { entry: Unreached; focus: HomeFocus }) {
  const { home } = entry;
  const address = home.address as string | undefined;
  const number = home.callbackNumber as string | undefined;
  const who = home.residentName ?? (address ? streetOf(address) : "Address not on file");
  return (
    <li className="flex items-center pr-4 transition-colors duration-150 hover:bg-surface-sunk">
      <button
        type="button"
        onClick={() => focus.onFocus(home._id)}
        onMouseEnter={() => focus.onHover(home._id)}
        onMouseLeave={() => focus.onHover(null)}
        onFocus={() => focus.onHover(home._id)}
        onBlur={() => focus.onHover(null)}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pr-1.5 pl-4 text-left"
      >
        <UnreachedSwatch inFire={entry.inFire} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-small truncate font-semibold" title={address}>
            {who}
          </span>
          <span className="type-small truncate text-on-panel-muted">{entry.reason}</span>
        </span>
        <span className={`type-small shrink-0 text-right font-bold tabular-nums ${entry.inFire || entry.minutesToFire !== null ? "text-signal" : "text-on-panel"}`}>
          {fireWords(entry)}
        </span>
      </button>
      {number && (
        <ButtonLink href={`tel:${number}`} variant="onPanelQuiet" size="sm" square aria-label={`Call ${who} at ${phoneForPeople(number)}`} title={phoneForPeople(number)}>
          <Phone weight="bold" className="size-4" />
        </ButtonLink>
      )}
    </li>
  );
}

// Nothing on the night will ever ring these homes: say so, and offer the one switch that fixes it.
export function StandInWarning({ count, className = "" }: { count: number; className?: string }) {
  const setStandIns = useMutation(api.control.setStandIns);
  const homes = count === 1 ? "One real home" : `${count} real homes`;
  return (
    <div className={`flex flex-col gap-2 rounded-xl bg-signal-soft p-3 text-on-panel ${className}`} role="alert">
      <p className="type-small flex gap-2 font-semibold">
        <Warning weight="fill" className="mt-0.5 size-4 shrink-0 text-signal" aria-hidden />
        {homes} will never be called. The voice agent is a stand-in, and it only calls simulated homes.
      </p>
      <Button variant="onPanel" size="sm" className="self-start" onClick={() => void setStandIns({ simulateVoice: false })}>
        <Phone weight="bold" className="size-4" />
        Switch to real calls
      </Button>
    </div>
  );
}

// Homes the fire has reached, or will within the hour, that nobody has confirmed are out.
// `skipped` counts every real home the voice stand-in will never ring, near the fire or not.
export function UnreachedPanel({ unreached, skipped, focus }: { unreached: Unreached[]; skipped: number; focus: HomeFocus }) {
  if (unreached.length === 0 && skipped === 0) return null;
  return (
    <Panel title="Not reached" aside={<span className="type-figure pr-4 text-xl tabular-nums text-signal">{unreached.length}</span>}>
      {skipped > 0 && <StandInWarning count={skipped} className="mx-4 mb-2" />}
      <ol className="flex max-h-72 flex-col overflow-y-auto pb-2">
        {unreached.map((entry) => (
          <UnreachedRow key={entry.home._id} entry={entry} focus={focus} />
        ))}
      </ol>
    </Panel>
  );
}
