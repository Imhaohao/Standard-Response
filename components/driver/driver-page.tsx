"use client";

import { useQuery } from "convex/react";
import { AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";
import { Bed, CaretDown, Gear, Users, Van, Wheelchair, type Icon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Switch } from "../ui/switch";
import { DriverMap } from "./driver-map";
import { ChangedCard, OfferCard } from "./offer-cards";
import { RunList } from "./run-list";
import { pickerOrder, Stop, useDriverBoard, Vehicle, Vehicles } from "./stops";
import { PhoneScreen } from "@/components/ui/phone-screen";

function useSelectedVehicle(vehicles: Vehicles | undefined) {
  const [selected, setSelected] = useState<Id<"vehicles"> | null>(null);
  useEffect(() => {
    if (selected || !vehicles?.length) return;
    const id = setTimeout(() => setSelected(pickerOrder(vehicles)[0]._id), 0);
    return () => clearTimeout(id);
  }, [selected, vehicles]);
  return [selected, setSelected] as const;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function capacityItems(vehicle: Vehicle): { key: string; text: string; Icon: Icon }[] {
  const items = [
    { key: "seats", text: plural(vehicle.seats, "seat", "seats"), Icon: Users, count: vehicle.seats },
    { key: "wheelchair", text: plural(vehicle.wheelchairSpaces, "wheelchair space", "wheelchair spaces"), Icon: Wheelchair, count: vehicle.wheelchairSpaces },
    { key: "stretcher", text: plural(vehicle.stretcherSpaces, "stretcher", "stretchers"), Icon: Bed, count: vehicle.stretcherSpaces },
  ];
  return items.filter((item) => item.count > 0);
}

// What the van can carry, so a driver can sanity-check an offer against the room they have.
function Capacity({ vehicle }: { vehicle: Vehicle }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pr-3 pb-2.5 pl-14 text-on-panel-muted" aria-label="Room in your van">
      {capacityItems(vehicle).map(({ key, text, Icon }) => (
        <li key={key} className="type-small flex items-center gap-1.5 font-semibold">
          <Icon weight="bold" className="size-4 shrink-0" />
          {text}
        </li>
      ))}
    </ul>
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
    <label className="group relative flex min-h-14 items-center gap-3 px-3 focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-on-panel">
      <span className="sr-only">Driving as</span>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-on-panel text-panel">
        <Van weight="fill" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-heading truncate">{vehicle?.driverName ?? "Pick a driver"}</span>
        <span className="type-small text-on-panel-muted">{vehicle?.label}</span>
      </span>
      <span className="type-small flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-panel-raised px-3 font-bold group-hover:bg-line" aria-hidden>
        Switch driver
        <CaretDown weight="bold" className="size-3.5" />
      </span>
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

// Nothing to drive yet. The pulse says the page is live and listening, so a quiet screen isn't
// mistaken for a broken one.
function EmptyBoard() {
  return (
    <div className="flex items-center gap-3 bg-panel px-4 py-4" role="status">
      <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-panel-raised" aria-hidden>
        <span className="absolute size-10 rounded-full bg-on-panel-muted/30 animate-ping motion-reduce:hidden" />
        <Van weight="bold" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="type-heading">Waiting for your next pickup</span>
        <span className="type-small text-on-panel-muted">Keep this page open. New offers show up here.</span>
      </span>
    </div>
  );
}

function Board({ vehicleId, vehicle, hold }: { vehicleId: Id<"vehicles">; vehicle: Vehicle | undefined; hold: boolean }) {
  const stops = useQuery(api.offers.forVehicle, { vehicleId }) ?? [];
  const board = useDriverBoard(stops, hold);
  const [chosen, setChosen] = useState<string | null>(null);
  // What the driver can act on leads; offers the dispatcher hasn't approved yet wait below the run.
  const actionable = board.offers.filter((stop) => stop.status !== "proposed");
  const reviewing = board.offers.filter((stop) => stop.status === "proposed");
  const everything: Stop[] = [...actionable, ...board.run, ...reviewing];
  const focus = everything.find((stop) => stop._id === chosen) ?? everything[0] ?? null;
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
            {actionable.map((stop) => (
              <OfferCard key={stop._id} stop={stop} onChanged={() => board.markChanged(stop._id)} onDeclined={() => board.dismiss(stop._id)} />
            ))}
          </AnimatePresence>
        </ul>
        <RunList stops={board.run} focusId={focus?._id} onFocus={(stop) => setChosen(stop._id)} />
        <ul className="flex flex-col gap-px">
          {reviewing.map((stop) => (
            <OfferCard key={stop._id} stop={stop} onChanged={() => board.markChanged(stop._id)} onDeclined={() => board.dismiss(stop._id)} />
          ))}
        </ul>
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
    <PhoneScreen fitScreen>
      <div className="z-10 flex flex-col divide-y divide-panel-raised bg-panel/96 backdrop-blur-md">
        {vehicles && vehicles.length > 0 ? (
          <div className="flex flex-col">
            <div className="flex items-center">
              <div className="min-w-0 flex-1">
                <DriverPicker vehicles={vehicles} vehicle={vehicle} onSelect={setSelected} />
              </div>
              <DemoSettings hold={hold} onHoldChange={setHold} />
            </div>
            {vehicle && <Capacity vehicle={vehicle} />}
          </div>
        ) : (
          <Van weight="bold" className="mx-4 my-4 size-6 text-on-panel-muted" aria-label="No vans yet" />
        )}
      </div>
      {selected && <Board key={selected} vehicleId={selected} vehicle={vehicle} hold={hold} />}
    </PhoneScreen>
  );
}
