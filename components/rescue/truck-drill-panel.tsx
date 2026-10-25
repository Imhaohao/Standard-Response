"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { ENGINE, MOST_TRUCKS_TRIED } from "@/convex/vehicleRun";
import { Button } from "../ui/button";
import { ON_PANEL_FIELD } from "../ui/field";
import { Panel } from "../ui/panel";
import { countsAt, Drill, HomeState, useDrillSeconds } from "./use-truck-drill";

const OUTCOMES: { state: HomeState; label: string; tone: string }[] = [
  { state: "rescued", label: "out before the fire", tone: "text-leaving" },
  { state: "too_late", label: "reached after the fire", tone: "text-signal" },
  { state: "never_reached", label: "never reached", tone: "text-signal" },
];

const SOURCES: Record<Drill["source"], string> = {
  board: "Tonight's residents who said they need a ride.",
  simulated_area: "Nobody on tonight's board needs a ride yet, so this uses the 200 simulated homes' truth cards.",
};

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="type-small text-on-panel-muted">{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${ON_PANEL_FIELD} tabular-nums`} />
    </label>
  );
}

function Progress({ drill, seconds }: { drill: Drill; seconds: number }) {
  const minute = Math.floor(seconds / 60);
  const last = Math.ceil(drill.endSeconds / 60);
  return (
    <div className="flex flex-col gap-1 px-4">
      <div className="h-1.5 overflow-hidden rounded-full bg-panel-raised">
        <div className="h-full rounded-full bg-on-panel" style={{ width: `${(seconds / drill.endSeconds) * 100}%` }} />
      </div>
      <p className="type-small text-on-panel-muted tabular-nums">
        Minute {minute} of {last} after the warning
      </p>
    </div>
  );
}

function Results({ drill }: { drill: Drill }) {
  const seconds = useDrillSeconds(drill, 250);
  const counts = countsAt(drill, seconds);
  const finished = seconds >= drill.endSeconds;
  return (
    <div className="flex flex-col gap-3 pb-3">
      <Progress drill={drill} seconds={seconds} />
      <dl className="flex flex-col gap-1 px-4">
        {OUTCOMES.map(({ state, label, tone }) => (
          <div key={state} className="flex items-baseline gap-2">
            <dd className={`type-figure w-10 text-right text-2xl ${tone}`}>{counts[state].people}</dd>
            <dt className="type-small text-on-panel-muted">
              people {label}, {counts[state].homes} {counts[state].homes === 1 ? "home" : "homes"}
            </dt>
          </div>
        ))}
      </dl>
      {finished && (
        <p className="type-small px-4">
          {drill.trucksNeeded === null
            ? `Even ${MOST_TRUCKS_TRIED} engines working this plan would not reach everyone in time.`
            : `It would take ${drill.trucksNeeded} engines working this plan to reach everyone before the fire.`}
        </p>
      )}
      <p className="type-small px-4 text-on-panel-muted">
        One engine at {drill.speedMph} mph with {drill.seats} spare {drill.seats === 1 ? "seat" : "seats"}, leaving {drill.station.name} at the warning and unloading at {drill.shelter.name}. {SOURCES[drill.source]}
      </p>
    </div>
  );
}

// One fire engine against the whole zone. Its run is simulated on the road graph and replayed on the
// map; the counts show who it got out, who it reached too late and who it never got to.
export function TruckDrillPanel({ drill }: { drill: Drill | null | undefined }) {
  const run = useMutation(api.truckDrill.run);
  const clear = useMutation(api.truckDrill.clear);
  const [speedMph, setSpeedMph] = useState(ENGINE.speedMph);
  const [seats, setSeats] = useState(ENGINE.seats);
  const [running, setRunning] = useState(false);
  const start = async () => {
    setRunning(true);
    try {
      await run({ speedMph, seats });
    } finally {
      setRunning(false);
    }
  };
  return (
    <Panel title="One fire truck">
      {drill && <Results drill={drill} />}
      <div className="flex items-end gap-2 px-4 pb-3">
        <NumberField label="Speed, mph" value={speedMph} onChange={setSpeedMph} min={5} max={65} />
        <NumberField label="Spare seats" value={seats} onChange={setSeats} min={1} max={12} />
      </div>
      <div className="flex gap-2 px-4 pb-4">
        <Button variant="onPanel" size="sm" className="flex-1" disabled={running} onClick={() => void start()}>
          {drill ? "Run the drill again" : "Send one truck"}
        </Button>
        {drill && (
          <Button variant="onPanelQuiet" size="sm" onClick={() => void clear()}>
            Clear the drill
          </Button>
        )}
      </div>
    </Panel>
  );
}
