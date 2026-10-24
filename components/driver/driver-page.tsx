"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowFatUp,
  CheckCircle,
  Drop,
  FirstAid,
  NavigationArrow,
  Users,
  WarningCircle,
  Wheelchair,
  X,
} from "@phosphor-icons/react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { NeedMark, useBuildingHighlights } from "@/components/map/use-highlights";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { OFFER_TTL_MS } from "@/convex/model";
import { createProjection } from "@/lib/ink-map/data";
import { useFireClock, useHazard } from "@/lib/ink-map/hazard";
import { LatLng } from "@/lib/geo";
import { formatCountdown, useNow } from "@/lib/time";
import { Button } from "../ui/button";

type Stop = FunctionReturnType<typeof api.offers.forVehicle>[number];
type Vehicles = FunctionReturnType<typeof api.vehicles.list>;

const PICKUP_RADIUS_METRES = 95;

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

type NeedItem = { id: string; Icon: typeof Users; count?: number; label: string; emphasis?: boolean };

// What has to be on the vehicle. Space is what the dispatcher matched on, so it is what the driver
// checks before setting off.
function needsOnBoard(load: Stop["load"]): NeedItem[] {
  if (!load) return [];
  const items: NeedItem[] = [];
  if (load.wheelchairSpaces > 0) items.push({ id: "wheelchair", Icon: Wheelchair, count: load.wheelchairSpaces, label: "wheelchair", emphasis: true });
  if (load.stretcherSpaces > 0) items.push({ id: "stretcher", Icon: ArrowFatUp, count: load.stretcherSpaces, label: "stretcher", emphasis: true });
  return items;
}

// What has to happen at the door. A lift needs a second pair of hands, and that is the thing a
// driver most needs to know before agreeing.
function needsAtDoor(stop: Stop): NeedItem[] {
  const rider = stop.rider;
  const items: NeedItem[] = [];
  const crew = stop.crewNeeded ?? 1;
  if (crew > 1) items.push({ id: "crew", Icon: Users, count: crew, label: "crew" });
  const lift = stop.needsLift || rider?.assistanceRequired === "two_person_lift" || rider?.mobility === "bedbound";
  if (lift) items.push({ id: "lift", Icon: ArrowFatUp, label: "Needs lifting", emphasis: true });
  const medical = rider?.medical ?? [];
  if (medical.includes("oxygen")) items.push({ id: "oxygen", Icon: Drop, label: "Oxygen", emphasis: true });
  if (medical.some((need) => need !== "oxygen")) items.push({ id: "medical", Icon: FirstAid, label: "Medical", emphasis: true });
  return items;
}

function needItems(stop: Stop): NeedItem[] {
  const people = stop.rider?.peopleCount ?? stop.load?.seats ?? 0;
  const person = { id: "people", Icon: Users, count: people, label: people === 1 ? "person" : "people" };
  return [person, ...needsOnBoard(stop.load), ...needsAtDoor(stop)];
}

// How many of what the driver has to fit, and what has to happen at the door. Every item is a glyph
// with a count; a driver reads this at a red light, not a sentence.
function NeedChips({ stop }: { stop: Stop }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {needItems(stop).map((item) => (
        <Chip key={item.id} {...item} />
      ))}
    </ul>
  );
}

function Chip({ Icon, count, label, emphasis = false }: NeedItem) {
  return (
    <li className={`flex items-center gap-1.5 ${emphasis ? "text-signal" : "text-ink"}`}>
      <Icon weight="bold" className="size-5" />
      <span className="type-small font-bold">{count ?? label}</span>
      {count !== undefined && <span className="type-small font-normal text-ink-muted">{label}</span>}
    </li>
  );
}

// The close-up: this house, on this street. The roof goes red and a pin sits on it, because at
// close range an oblique view hides the one building the driver is looking for.
function PickupPin({ at }: { at: LatLng }) {
  return (
    <GeoAnchor at={at}>
      <circle r={20} fill="var(--signal)" fillOpacity={0.14} />
      <circle r={9} fill="var(--signal)" stroke="var(--map-paper)" strokeWidth={2.5} />
    </GeoAnchor>
  );
}

function PickupMap({ stop }: { stop: Stop }) {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const control = useQuery(api.control.get);
  const clock = useFireClock(hazard, control?.warningIssuedAt);
  const toLocal = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }).toLocal, [data?.origin]);
  const at = useMemo(
    () => (stop?.lat !== undefined && stop.lng !== undefined ? { lat: stop.lat, lng: stop.lng } : null),
    [stop],
  );
  const here = useMemo(() => (at ? toLocal(at) : null), [at, toLocal]);
  const marks = useMemo<NeedMark[]>(() => (here ? [{ point: here, level: 1 }] : []), [here]);
  const highlights = useBuildingHighlights(data ?? null, marks);

  if (!data || !here || !at) return <div className="size-full bg-map-paper" />;

  return (
    <MapStage
      data={data}
      mode="ink"
      view={{ kind: "closeup", center: here, radius: PICKUP_RADIUS_METRES }}
      hazard={hazard}
      minutes={clock.minutes}
      highlights={highlights}
    >
      <PickupPin at={at} />
    </MapStage>
  );
}

// The countdown bar drains as the offer runs out. It turns red for the last third.
function OfferClock({ offeredAt }: { offeredAt: number | undefined }) {
  const now = useNow();
  const left = (offeredAt ?? now) + OFFER_TTL_MS - now;
  const fraction = Math.max(0, Math.min(1, left / OFFER_TTL_MS));
  const urgent = fraction < 0.34;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1 w-full bg-line">
        <div className={`h-full ${urgent ? "bg-signal" : "bg-ink"}`} style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className={`type-small tabular-nums ${urgent ? "font-bold text-signal" : "text-ink-muted"}`}>{formatCountdown(left)} to answer</p>
    </div>
  );
}

function ChangedCard({ stop, onDismiss }: { stop: Stop; onDismiss: () => void }) {
  return (
    <li className="flex flex-col gap-3 border-l-2 border-l-signal bg-surface-sunk p-4" role="status">
      <p className="type-title flex items-center gap-2">
        <WarningCircle weight="fill" className="size-6 text-signal" />
        This assignment changed
      </p>
      <p className="type-small">
        {stop.address} is no longer yours. The rider was never told you were coming, so nobody is waiting on you for it.
      </p>
      <Button variant="quiet" onClick={onDismiss} className="self-start">
        Dismiss
      </Button>
    </li>
  );
}

function OfferCard({ stop, onChanged, onDeclined }: { stop: Stop; onChanged: () => void; onDeclined: () => void }) {
  const accept = useMutation(api.offers.accept);
  const decline = useMutation(api.offers.decline);
  const waiting = stop.status === "proposed";

  return (
    <li className="flex flex-col gap-4 bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="type-title">{stop.address}</p>
        <p className="type-small flex items-center gap-1.5 text-ink-muted">
          <NavigationArrow weight="bold" className="size-4" />
          {stop.etaMinutes} min drive
          {stop.rider?.residentName && ` · ${stop.rider.residentName}`}
        </p>
      </div>
      <NeedChips stop={stop} />
      {waiting ? (
        <p className="type-small text-ink-muted">The dispatcher has not approved this pickup yet.</p>
      ) : (
        <>
          <OfferClock offeredAt={stop.offeredAt} />
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" onClick={() => void accept({ assignmentId: stop._id }).then((result) => result === "changed" && onChanged())}>
              <CheckCircle weight="fill" className="size-5" />
              Accept
            </Button>
            <Button
              size="lg"
              variant="quiet"
              onClick={() => {
                onDeclined();
                void decline({ assignmentId: stop._id });
              }}
            >
              <X weight="bold" className="size-5" />
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
      {armed ? "Tap again, and the rider will be told" : "I can't make this pickup"}
    </Button>
  );
}

function RunStop({ stop, index }: { stop: Stop; index: number }) {
  return (
    <li className="flex flex-col gap-3 bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="type-figure flex size-7 shrink-0 items-center justify-center bg-ink text-base text-canvas">{index + 1}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="type-heading">{stop.address}</p>
          {stop.rider?.residentName && <p className="type-small text-ink-muted">{stop.rider.residentName}</p>}
        </div>
      </div>
      <NeedChips stop={stop} />
      <CantMakeIt stop={stop} />
    </li>
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
    const id = setTimeout(() => setMemory((m) => ({ ...m, seen: new Map([...m.seen, ...unseen.map((s) => [s._id, s] as const)]) })));
    return () => clearTimeout(id);
  });
  const mark = (key: "closed" | "dismissed", stopId: string) => setMemory((m) => ({ ...m, [key]: new Set([...m[key], stopId]) }));
  return { memory, mark };
}

function OfferList({ stops, hold }: { stops: Stop[]; hold: boolean }) {
  const live = stops.filter((stop) => stop.status !== "accepted");
  const { memory, mark } = useOfferMemory(live);
  const liveIds = new Set(stops.map((stop) => stop._id));
  const gone = [...memory.seen.values()].filter((stop) => !liveIds.has(stop._id) && stop.status === "offered" && !memory.dismissed.has(stop._id));
  const isClosed = (stop: Stop) => memory.closed.has(stop._id) || (!liveIds.has(stop._id) && !hold);
  const shown = [...live, ...gone];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-heading">Offers</h2>
      {shown.length === 0 && <p className="type-small text-ink-muted">Nothing offered to you right now.</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((stop) =>
          isClosed(stop) ? (
            <ChangedCard key={stop._id} stop={stop} onDismiss={() => mark("dismissed", stop._id)} />
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

function DriverBar({ vehicles, selected, onSelect }: { vehicles: Vehicles | undefined; selected: Id<"vehicles"> | null; onSelect: (id: Id<"vehicles">) => void }) {
  const vehicle = vehicles?.find((candidate) => candidate._id === selected);
  return (
    <header className="flex items-center gap-3 bg-panel px-4 py-3 text-on-panel">
      <span className="size-3 shrink-0 bg-signal" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-small font-bold">{vehicle ? vehicle.driverName : "No driver"}</span>
        <span className="type-small truncate text-on-panel-muted">
          {vehicle ? `${vehicle.label}, ${vehicle.seats} seats, ${vehicle.wheelchairSpaces} wheelchairs` : "Waiting for the warning"}
        </span>
      </div>
      <label className="type-small sr-only" htmlFor="driver-picker">
        Driving as
      </label>
      <select
        id="driver-picker"
        className="type-small max-w-[10rem] shrink-0 border border-panel-raised bg-panel-raised px-2 py-1.5 font-semibold text-on-panel"
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value as Id<"vehicles">)}
      >
        {vehicles?.length === 0 && <option value="">No vehicles</option>}
        {vehicles &&
          pickerOrder(vehicles).map((candidate) => (
            <option key={candidate._id} value={candidate._id}>
              {candidate.driverName} — {candidate.label}
              {candidate.driverIsSimulated ? " (simulated)" : ""}
            </option>
          ))}
      </select>
    </header>
  );
}

function DemoControls({ hold, onHold }: { hold: boolean; onHold: (hold: boolean) => void }) {
  return (
    <details className="bg-surface-sunk">
      <summary className="type-small cursor-pointer px-4 py-3 font-semibold text-ink-muted">Demo controls</summary>
      <label className="type-small flex items-center gap-2 px-4 pb-4">
        <input type="checkbox" checked={hold} onChange={(event) => onHold(event.target.checked)} className="size-4" />
        Hold offers until I tap, like a phone on a slow network
      </label>
    </details>
  );
}

function VehicleView({ vehicleId, hold, onHold }: { vehicleId: Id<"vehicles">; hold: boolean; onHold: (hold: boolean) => void }) {
  const stops = useQuery(api.offers.forVehicle, { vehicleId }) ?? [];
  const accepted = stops.filter((stop) => stop.status === "accepted");
  const focus = stops.find((stop) => stop.status === "offered") ?? accepted[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative h-[36dvh] min-h-52 shrink-0 border-b border-line">
        <PickupMap stop={focus} />
        {focus && <span className="type-small absolute bottom-0 left-0 bg-map-paper px-2 py-1 font-bold text-map-ink">{focus.address}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <OfferList stops={stops} hold={hold} />
        {accepted.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="type-heading">Your run, in order</h2>
            <ol className="flex flex-col gap-2">
              {accepted.map((stop, index) => (
                <RunStop key={stop._id} stop={stop} index={index} />
              ))}
            </ol>
          </section>
        )}
        <DemoControls hold={hold} onHold={onHold} />
      </div>
    </div>
  );
}

export function DriverPage() {
  const vehicles = useQuery(api.vehicles.list);
  const [selected, setSelected] = useSelectedVehicle(vehicles);
  const [hold, setHold] = useState(false);

  return (
    <main className="mx-auto flex h-[100dvh] max-w-md flex-col overflow-hidden bg-map-paper">
      <DriverBar vehicles={vehicles} selected={selected} onSelect={setSelected} />
      {selected ? (
        <VehicleView key={selected} vehicleId={selected} hold={hold} onHold={setHold} />
      ) : (
        <p className="type-small p-4 text-ink-muted">Vehicles appear once the warning is issued on the call floor.</p>
      )}
    </main>
  );
}
