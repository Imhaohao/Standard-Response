"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { OFFER_TTL_MS } from "@/convex/model";
import { capacitySummary, needsSummary } from "@/lib/labels";
import { formatElapsed, useNow } from "@/lib/time";
import { Button } from "../ui/button";

type Stop = FunctionReturnType<typeof api.offers.forVehicle>[number];
type Vehicles = FunctionReturnType<typeof api.vehicles.list>;

// Demo drivers (driven from this page) first, then everyone else.
const pickerOrder = (vehicles: Vehicles) =>
  [...vehicles].sort((a, b) => Number(a.driverIsSimulated) - Number(b.driverIsSimulated) || a.label.localeCompare(b.label));

function useSelectedVehicle(vehicles: Vehicles | undefined) {
  const [selected, setSelected] = useState<Id<"vehicles"> | null>(null);
  useEffect(() => {
    if (selected || !vehicles?.length) return;
    const id = setTimeout(() => setSelected(pickerOrder(vehicles)[0]._id), 0);
    return () => clearTimeout(id);
  }, [selected, vehicles]);
  return [selected, setSelected] as const;
}

function StopNeeds({ stop }: { stop: Stop }) {
  if (!stop.load) return null;
  return <p className="type-small text-ink-muted">Needs {needsSummary(stop.load, stop.crewNeeded ?? 1)}</p>;
}

function ClosedOfferCard({ stop, onDismiss }: { stop: Stop; onDismiss: () => void }) {
  return (
    <li className="flex flex-col gap-2 bg-surface-sunk p-4" role="status">
      <p className="type-heading">This assignment changed</p>
      <p className="type-small text-ink-muted">{stop.address} is no longer yours. Nothing was promised to the rider.</p>
      <Button variant="quiet" onClick={onDismiss}>
        Dismiss
      </Button>
    </li>
  );
}

function OfferCard({ stop, onChanged, onDeclined }: { stop: Stop; onChanged: () => void; onDeclined: () => void }) {
  const accept = useMutation(api.offers.accept);
  const decline = useMutation(api.offers.decline);
  const now = useNow();
  const left = (stop.offeredAt ?? now) + OFFER_TTL_MS - now;

  return (
    <li className="flex flex-col gap-3 bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="type-title">{stop.address}</p>
        <p className="type-small text-ink-muted">{stop.etaMinutes} min</p>
      </div>
      <StopNeeds stop={stop} />
      {stop.status === "proposed" ? (
        <p className="type-small">Waiting for the dispatcher to approve.</p>
      ) : (
        <>
          <p className="type-small text-ink-muted">Respond within {formatElapsed(left)}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={() => void accept({ assignmentId: stop._id }).then((r) => r === "changed" && onChanged())}>
              Accept pickup
            </Button>
            <Button
              size="lg"
              variant="quiet"
              onClick={() => {
                onDeclined();
                void decline({ assignmentId: stop._id });
              }}
            >
              Decline
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

function CantMakeIt({ stop }: { stop: Stop }) {
  const cancel = useMutation(api.offers.cancelByDriver);
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={armed ? "primary" : "quiet"}
      onClick={() => {
        if (!armed) return setArmed(true);
        void cancel({ assignmentId: stop._id });
      }}
    >
      {armed ? "Tap again: the rider will be told" : "I can't make this pickup"}
    </Button>
  );
}

function AcceptedRun({ stops }: { stops: Stop[] }) {
  if (stops.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-heading">Your run</h2>
      <ol className="flex flex-col gap-2">
        {stops.map((stop, i) => (
          <li key={stop._id} className="flex flex-col gap-2 bg-surface p-4">
            <p className="type-heading">
              {i + 1}. {stop.address}
            </p>
            <StopNeeds stop={stop} />
            <CantMakeIt stop={stop} />
          </li>
        ))}
      </ol>
    </section>
  );
}

type OfferMemory = { seen: Map<string, Stop>; closed: Set<string>; dismissed: Set<string> };

// Offers this phone has shown. One the plan replaces either flips to "changed" right away, or, with
// hold on (a slow phone), stays tappable so the server can reject the late accept.
function useOfferMemory(live: Stop[]) {
  const [memory, setMemory] = useState<OfferMemory>({ seen: new Map(), closed: new Set(), dismissed: new Set() });
  const unseen = live.filter((stop) => memory.seen.get(stop._id)?.status !== stop.status);
  useEffect(() => {
    if (unseen.length === 0) return;
    const id = setTimeout(() =>
      setMemory((m) => ({ ...m, seen: new Map([...m.seen, ...unseen.map((s) => [s._id, s] as const)]) })),
    );
    return () => clearTimeout(id);
  });
  const mark = (key: "closed" | "dismissed", stopId: string) =>
    setMemory((m) => ({ ...m, [key]: new Set([...m[key], stopId]) }));
  return { memory, mark };
}

function OfferList({ stops, hold }: { stops: Stop[]; hold: boolean }) {
  const live = stops.filter((s) => s.status !== "accepted");
  const { memory, mark } = useOfferMemory(live);
  const liveIds = new Set(stops.map((s) => s._id));
  const gone = [...memory.seen.values()].filter((s) => !liveIds.has(s._id) && s.status === "offered" && !memory.dismissed.has(s._id));
  const isClosed = (stop: Stop) => memory.closed.has(stop._id) || (!liveIds.has(stop._id) && !hold);
  const shown = [...live, ...gone];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-heading">Offers</h2>
      {shown.length === 0 && <p className="type-small text-ink-muted">No offers right now.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((stop) =>
          isClosed(stop) ? (
            <ClosedOfferCard key={stop._id} stop={stop} onDismiss={() => mark("dismissed", stop._id)} />
          ) : (
            <OfferCard
              key={stop._id}
              stop={stop}
              onChanged={() => mark("closed", stop._id)}
              onDeclined={() => mark("dismissed", stop._id)}
            />
          ),
        )}
      </ul>
    </section>
  );
}

function VehicleView({ vehicleId, hold }: { vehicleId: Id<"vehicles">; hold: boolean }) {
  const stops = useQuery(api.offers.forVehicle, { vehicleId }) ?? [];
  return (
    <>
      <OfferList stops={stops} hold={hold} />
      <AcceptedRun stops={stops.filter((s) => s.status === "accepted")} />
    </>
  );
}

export function DriverPage() {
  const vehicles = useQuery(api.vehicles.list);
  const [selected, setSelected] = useSelectedVehicle(vehicles);
  const vehicle = vehicles?.find((v) => v._id === selected);
  const [hold, setHold] = useState(false);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 bg-canvas px-4 py-5">
      <label className="type-small flex flex-col gap-1.5 font-semibold">
        Driving as
        <select
          className="type-body h-12 border border-line bg-surface px-3"
          value={selected ?? ""}
          onChange={(event) => setSelected(event.target.value as Id<"vehicles">)}
        >
          {vehicles &&
            pickerOrder(vehicles).map((v) => (
              <option key={v._id} value={v._id}>
                {v.driverName}, {v.label}
                {v.driverIsSimulated ? " (simulated)" : ""}
              </option>
            ))}
        </select>
      </label>
      {vehicles?.length === 0 && <p className="type-body text-ink-muted">Vehicles appear once the warning is issued on the call floor.</p>}
      {vehicle && <p className="type-small text-ink-muted">{capacitySummary(vehicle)}</p>}
      <label className="type-small flex items-center gap-2">
        <input type="checkbox" checked={hold} onChange={(event) => setHold(event.target.checked)} className="size-4" />
        Hold offers until I tap, like a phone on a slow network
      </label>
      {selected && <VehicleView key={selected} vehicleId={selected} hold={hold} />}
    </main>
  );
}
