"use client";

import { useQuery } from "convex/react";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { CaretDown, Gear, Users, Van, Wheelchair } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { capacitySummary } from "@/lib/labels";
import { Switch } from "../ui/switch";
import { DriverMap } from "./driver-map";
import { ChangedCard, OfferCard } from "./offer-cards";
import { RunList } from "./run-list";
import { pickerOrder, Stop, useDriverBoard, Vehicle, Vehicles } from "./stops";

function useSelectedVehicle(vehicles: Vehicles | undefined) {
  const [selected, setSelected] = useState<Id<"vehicles"> | null>(null);
  useEffect(() => {
    if (selected || !vehicles?.length) return;
    const id = setTimeout(() => setSelected(pickerOrder(vehicles)[0]._id), 0);
    return () => clearTimeout(id);
  }, [selected, vehicles]);
  return [selected, setSelected] as const;
}

function Capacity({ vehicle }: { vehicle: Vehicle }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-on-panel-muted" aria-label={capacitySummary(vehicle)}>
      {vehicle.wheelchairSpaces > 0 && (
        <span className="flex items-center gap-0.5">
          <Wheelchair weight="bold" className="size-4" />
          <span className="type-small font-bold">{vehicle.wheelchairSpaces}</span>
        </span>
      )}
      <span className="flex items-center gap-0.5">
        <Users weight="bold" className="size-4" />
        <span className="type-small font-bold">{vehicle.seats}</span>
      </span>
    </span>
  );
}

// One phone can be any driver, so the driver's name is a picker.
function DriverPicker({
  vehicles,
  vehicle,
  onSelect,
}: {
  vehicles: Vehicles;
  vehicle: Vehicle | undefined;
  onSelect: (id: Id<"vehicles">) => void;
}) {
  return (
    <label className="relative flex min-h-12 items-center gap-3 px-3 hover:bg-panel-raised focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-on-panel">
      <span className="sr-only">Driving as</span>
      <span className="grid size-8 shrink-0 place-items-center bg-on-panel text-panel">
        <Van weight="fill" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-heading truncate">{vehicle?.driverName ?? "Pick a driver"}</span>
        <span className="type-small text-on-panel-muted">{vehicle?.label}</span>
      </span>
      {vehicle && <Capacity vehicle={vehicle} />}
      <CaretDown weight="bold" className="size-4 shrink-0" />
      <select
        className="absolute inset-0 cursor-pointer opacity-0"
        value={vehicle?._id ?? ""}
        onChange={(event) => onSelect(event.target.value as Id<"vehicles">)}
      >
        {pickerOrder(vehicles).map((v) => (
          <option key={v._id} value={v._id}>
            {v.driverName}, {v.label}
            {v.driverIsSimulated ? " (simulated)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

// Demo-only: with hold on, this phone acts like one on a slow network and a replaced offer stays tappable.
function DemoSettings({ hold, onHoldChange }: { hold: boolean; onHoldChange: (hold: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`grid size-12 place-items-center hover:bg-panel-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${open || hold ? "bg-panel-raised" : ""}`}
      >
        <Gear weight={hold ? "fill" : "bold"} className="size-5" />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 w-64 bg-panel shadow-float">
          <Switch checked={hold} onChange={onHoldChange} label="Hold offers until I tap" />
        </div>
      )}
    </div>
  );
}

function EmptyBoard() {
  return (
    <div className="flex items-center justify-center gap-3 bg-panel px-4 py-5 text-on-panel-muted" role="status">
      <span className="relative grid size-3 place-items-center" aria-hidden>
        <span className="absolute size-3 rounded-full bg-on-panel-muted animate-ping motion-reduce:hidden" />
        <span className="size-2 rounded-full bg-on-panel" />
      </span>
      <Van weight="bold" className="size-6" aria-label="Waiting for an offer" />
    </div>
  );
}

function Board({ vehicleId, vehicle, hold }: { vehicleId: Id<"vehicles">; vehicle: Vehicle | undefined; hold: boolean }) {
  const stops = useQuery(api.offers.forVehicle, { vehicleId }) ?? [];
  const board = useDriverBoard(stops, hold);
  const [chosen, setChosen] = useState<string | null>(null);
  const everything: Stop[] = [...board.offers, ...board.run];
  const focus = everything.find((stop) => stop._id === chosen) ?? board.offers[0] ?? board.run[0] ?? null;
  const quiet = everything.length === 0 && board.changed.length === 0;

  return (
    <>
      <div className="relative min-h-[34dvh] flex-1 overflow-hidden">
        <DriverMap focus={focus} run={board.run} vehicle={vehicle} />
      </div>
      <div className="flex max-h-[66dvh] flex-col gap-px overflow-y-auto bg-panel-raised">
        <ul className="flex flex-col gap-px">
          <AnimatePresence initial={false}>
            {board.changed.map((stop) => (
              <ChangedCard key={`changed-${stop._id}`} stop={stop} onDismiss={() => board.dismiss(stop._id)} />
            ))}
            {board.offers.map((stop) => (
              <OfferCard key={stop._id} stop={stop} onChanged={() => board.markChanged(stop._id)} onDeclined={() => board.dismiss(stop._id)} />
            ))}
          </AnimatePresence>
        </ul>
        <RunList stops={board.run} focusId={focus?._id} onFocus={(stop) => setChosen(stop._id)} />
        {quiet && <EmptyBoard />}
      </div>
    </>
  );
}

export function DriverPage() {
  const vehicles = useQuery(api.vehicles.list);
  const [selected, setSelected] = useSelectedVehicle(vehicles);
  const vehicle = vehicles?.find((v) => v._id === selected);
  const [hold, setHold] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-map-paper">
      <main className="relative mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-panel text-on-panel shadow-[0_0_0_1px_oklch(0_0_0/0.08),0_24px_60px_oklch(0_0_0/0.18)]">
        <div className="z-10 flex flex-col divide-y divide-panel-raised bg-panel/96 backdrop-blur-md">
          {vehicles && vehicles.length > 0 ? (
            <div className="flex items-center">
              <div className="min-w-0 flex-1">
                <DriverPicker vehicles={vehicles} vehicle={vehicle} onSelect={setSelected} />
              </div>
              <DemoSettings hold={hold} onHoldChange={setHold} />
            </div>
          ) : (
            <Van weight="bold" className="mx-4 my-4 size-6 text-on-panel-muted" aria-label="No vans yet" />
          )}
        </div>
        {selected && <Board key={selected} vehicleId={selected} vehicle={vehicle} hold={hold} />}
      </main>
    </div>
  );
}
