"use client";

import { ReactNode } from "react";
import { ArrowsClockwise, Pause, Users } from "@phosphor-icons/react";
import { Panel, PanelEmpty } from "../ui/panel";
import { streetOf } from "./need-panel";
import { CapacityIcons, VanChip } from "./request-badge";
import { Van, VanState } from "./use-rescue-board";

// The same corner badges the map draws on a van, so a van reads the same in both places.
const STATE: Record<VanState, { label: string; icon?: ReactNode }> = {
  rerouting: { label: "Changed course", icon: <ArrowsClockwise weight="bold" className="size-3.5 motion-safe:animate-spin" /> },
  stalled: { label: "Not moving", icon: <Pause weight="fill" className="size-3.5" /> },
  idle: { label: "Idle", icon: <Pause weight="fill" className="size-3.5" /> },
  boarding: { label: "Picking up", icon: <Users weight="fill" className="size-3.5" /> },
  waitingForDriver: { label: "Offered, waiting for the driver" },
  driving: { label: "Driving" },
};

function vanTitle(van: Van) {
  const next = van.stops[0];
  const heading = next ? `, next ${streetOf(next.address)}` : "";
  return `${van.vehicle.driverName}. ${STATE[van.state].label}${heading}`;
}

// One line per van: who it is, where it is heading, and a badge only when it needs a look.
function VanRow({ van }: { van: Van }) {
  const next = van.stops[0];
  const state = STATE[van.state];
  return (
    <li className="flex items-center gap-2 px-4 py-1" title={vanTitle(van)}>
      <VanChip label={van.vehicle.label} busy={van.stops.length > 0}>
        <CapacityIcons seats={van.vehicle.seats} wheelchairSpaces={van.vehicle.wheelchairSpaces} />
      </VanChip>
      <span className="type-small min-w-0 flex-1 truncate text-on-panel-muted">
        {next ? streetOf(next.address) : ""}
        {van.stops.length > 1 && <span className="tabular-nums"> +{van.stops.length - 1}</span>}
      </span>
      {state.icon && (
        <span className="type-small inline-flex shrink-0 items-center gap-1 font-semibold">
          {state.icon}
          {state.label}
        </span>
      )}
    </li>
  );
}

function StateCount({ state, vans }: { state: VanState; vans: Van[] }) {
  const count = vans.filter((van) => van.state === state).length;
  if (count === 0) return null;
  return (
    <span className="type-small inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2 py-0.5 font-bold tabular-nums" title={STATE[state].label}>
      {STATE[state].icon}
      {count}
    </span>
  );
}

export function FleetPanel({ vans, className = "" }: { vans: Van[]; className?: string }) {
  return (
    <Panel
      title="Vans"
      aside={
        <span className="flex items-center gap-1.5 pr-3">
          <StateCount state="rerouting" vans={vans} />
          <StateCount state="stalled" vans={vans} />
          <StateCount state="idle" vans={vans} />
          <StateCount state="boarding" vans={vans} />
        </span>
      }
      className={className}
    >
      {vans.length ? (
        <ul className="flex flex-col pb-2">
          {vans.map((van) => (
            <VanRow key={van.vehicle._id} van={van} />
          ))}
        </ul>
      ) : (
        <PanelEmpty>No vans yet.</PanelEmpty>
      )}
    </Panel>
  );
}
