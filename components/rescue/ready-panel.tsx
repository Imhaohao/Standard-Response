"use client";

import { useMutation } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { Bed, Car, Check, Handshake, LinkBreak, PhoneCall, UsersThree, Van, Wheelchair, type Icon } from "@phosphor-icons/react";
import { ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { useSimNow } from "@/lib/use-sim-now";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";
import { Home } from "./marks";
import { placeName, Pickup, PickupStatus } from "./use-pickups";

type HomeFocus = { onFocus: (householdId: string) => void; onHover: (householdId: string | null) => void };

const WHEELCHAIRS = new Set(["manual_wheelchair", "power_wheelchair"]);

// One square per home, in a stable order, so the grid fills in as the agent works down the list.
function Census({ homes }: { homes: Home[] }) {
  const ordered = [...homes].sort((a, b) => a._id.localeCompare(b._id));
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(0.5rem,1fr))] gap-0.5" aria-hidden>
      {ordered.map((home) => {
        const tone = home.exitPlan ? "bg-on-panel" : home.readyMisses >= 2 ? "hatch text-on-panel-muted" : "bg-panel-raised";
        return <li key={home._id} className={`aspect-square rounded-[1px] transition-colors duration-500 ${tone}`} />;
      })}
    </ul>
  );
}

function Figure({ Icon, glyph, count, label }: { Icon?: Icon; glyph?: string; count: number; label: string }) {
  return (
    <li className="flex flex-col items-center gap-1 rounded-xl bg-panel-raised px-2 py-2" title={label}>
      <span className="flex items-center gap-1">
        {Icon ? <Icon weight="bold" className="size-5" /> : <span className="type-figure text-base">{glyph}</span>}
        <span className="type-figure text-xl tabular-nums">{count}</span>
      </span>
      <span className="type-small text-on-panel-muted">{label}</span>
    </li>
  );
}

function NeedFigures({ homes }: { homes: Home[] }) {
  const count = (test: (home: Home) => boolean) => homes.filter(test).length;
  return (
    <ul className="grid grid-cols-4 gap-1.5">
      <Figure Icon={Wheelchair} count={count((h) => WHEELCHAIRS.has(h.mobility ?? ""))} label="Wheelchair" />
      <Figure Icon={Bed} count={count((h) => h.mobility === "bedbound")} label="In bed" />
      <Figure Icon={UsersThree} count={count((h) => h.assistanceRequired === "two_person_lift")} label="Two to lift" />
      <Figure glyph="O₂" count={count((h) => h.oxygen)} label="Oxygen" />
    </ul>
  );
}

const PLAN_SEGMENTS: { key: NonNullable<Home["exitPlan"]>; label: string; Icon: Icon; tone: string }[] = [
  { key: "own_car", label: "Own car", Icon: Car, tone: "bg-line-strong" },
  { key: "helper", label: "A helper", Icon: Handshake, tone: "bg-on-panel-muted" },
  { key: "needs_ride", label: "Needs a ride", Icon: Van, tone: "bg-on-panel" },
];

function ExitPlans({ homes }: { homes: Home[] }) {
  const counts = PLAN_SEGMENTS.map((segment) => ({ ...segment, count: homes.filter((home) => home.exitPlan === segment.key).length }));
  if (counts.every((segment) => segment.count === 0)) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {counts.map((segment) => (
          <span key={segment.key} className={`${segment.tone} transition-[flex-grow] duration-500`} style={{ flexGrow: segment.count, flexBasis: 0 }} />
        ))}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {counts.map(({ key, label, Icon, count, tone }) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dd className="type-figure flex items-center gap-1.5 text-xl tabular-nums">
              <Icon weight="bold" className="size-4" />
              {count}
            </dd>
            <dt className="type-small flex items-center gap-1.5 text-on-panel-muted">
              <span className={`size-2 shrink-0 rounded-full ${tone}`} aria-hidden />
              {label}
            </dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CampaignButton({ running, started }: { running: boolean; started: boolean }) {
  const start = useMutation(api.ready.start);
  const stop = useMutation(api.ready.stop);
  if (running) {
    return (
      <Button variant="onPanelQuiet" size="sm" onClick={() => void stop()}>
        <PhoneCall weight="fill" className="size-4 motion-safe:animate-ringing" />
        Pause calls
      </Button>
    );
  }
  return (
    <Button variant="onPanel" size="sm" onClick={() => void start()}>
      <PhoneCall weight="bold" className="size-4" />
      {started ? "Call the rest" : "Call every home"}
    </Button>
  );
}

// Before any warning: how much of the town we already know, and what it needs.
function ReadyCheck({ homes, running }: { homes: Home[]; running: boolean }) {
  const onFile = homes.filter((home) => home.exitPlan).length;
  return (
    <Panel title="Ready check" aside={<span className="pr-1">{<CampaignButton running={running} started={onFile > 0} />}</span>}>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="flex items-baseline gap-2">
          <span className="type-figure text-3xl tabular-nums">{onFile}</span>
          <span className="type-small text-on-panel-muted">of {homes.length} homes on file</span>
        </p>
        <Census homes={homes} />
        {onFile > 0 && <NeedFigures homes={homes} />}
        <ExitPlans homes={homes} />
      </div>
    </Panel>
  );
}

const STATUS: Record<PickupStatus, { label: string; Icon: Icon; rank: number; tone?: string }> = {
  fell_through: { label: "Fell through", Icon: LinkBreak, rank: 0, tone: "text-signal" },
  checking: { label: "Calling", Icon: PhoneCall, rank: 1 },
  coming: { label: "On the way", Icon: Car, rank: 2 },
  done: { label: "Picked up", Icon: Check, rank: 3 },
  arranged: { label: "Not checked yet", Icon: Handshake, rank: 4 },
};

const REASON: Record<NonNullable<Pickup["reason"]>, string> = {
  helper_declined: "Can't come",
  helper_unreachable: "No answer",
  helper_never_came: "Never came",
  resident_unreachable: "Can't reach them",
};

function minutesUntil(at: number | undefined, now: number) {
  if (!at || !now) return null;
  return Math.max(0, Math.round((at - now) / 60_000));
}

// Past the helper's ETA, the agent is about to ask the resident whether they were picked up.
const etaWords = (minutes: number | null) => (minutes === null ? "On the way" : minutes === 0 ? "Due now" : `${minutes} min`);

function rowStatus(pickup: Pickup, now: number): ReactNode {
  if (pickup.status === "fell_through" && pickup.reason) return REASON[pickup.reason];
  if (pickup.status === "checking") return pickup.ringing ? `Ringing ${pickup.helperName}` : "Calling";
  if (pickup.status === "coming") return etaWords(minutesUntil(pickup.helperEtaAt, now));
  return STATUS[pickup.status].label;
}

function PickupRowItem({ pickup, focus }: { pickup: Pickup; focus: HomeFocus }) {
  const { Icon, tone } = STATUS[pickup.status];
  const now = useSimNow(15_000);
  return (
    <li>
      <button
        type="button"
        onClick={() => focus.onFocus(pickup.householdId)}
        onPointerEnter={() => focus.onHover(pickup.householdId)}
        onPointerLeave={() => focus.onHover(null)}
        className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors duration-150 hover:bg-surface-sunk focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel"
      >
        <Icon weight="bold" className={`size-4 shrink-0 ${tone ?? ""} ${pickup.ringing ? "motion-safe:animate-ringing" : ""}`} />
        <span className="min-w-0 flex-1 truncate">
          <span className="type-heading">{placeName(pickup)}</span>
          <span className="type-small text-on-panel-muted"> from {pickup.helperName}</span>
        </span>
        <span className={`type-small shrink-0 font-semibold tabular-nums ${tone ?? ""}`}>{rowStatus(pickup, now)}</span>
      </button>
    </li>
  );
}

function StatusCounts({ pickups }: { pickups: Pickup[] }) {
  const shown: PickupStatus[] = ["fell_through", "checking", "coming", "done"];
  return (
    <ul className="flex flex-wrap gap-1.5 px-4 pb-2">
      {shown.map((status) => {
        const count = pickups.filter((pickup) => pickup.status === status).length;
        const { Icon, label, tone } = STATUS[status];
        return (
          <li key={status} title={label} className={`type-small inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2 py-0.5 font-bold tabular-nums ${count === 0 ? "opacity-40" : (tone ?? "")}`}>
            <Icon weight="bold" className="size-3.5" />
            {count}
            <span className="font-normal">{label.toLowerCase()}</span>
          </li>
        );
      })}
    </ul>
  );
}

// On the night: every helper on file, worst news first.
function NeighborPickups({ pickups, focus }: { pickups: Pickup[]; focus: HomeFocus }) {
  const active = pickups.filter((pickup) => pickup.status !== "done" && pickup.status !== "arranged").sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank);
  return (
    <Panel title="Neighbor pickups" aside={<span className="type-small pr-1 tabular-nums text-on-panel-muted">{pickups.length}</span>}>
      <StatusCounts pickups={pickups} />
      <ul className="flex max-h-64 flex-col overflow-y-auto pb-2">
        {active.map((pickup) => (
          <PickupRowItem key={pickup._id} pickup={pickup} focus={focus} />
        ))}
      </ul>
    </Panel>
  );
}

type Control = FunctionReturnType<typeof api.control.get> | undefined;

const campaignRunning = (control: Control) => control !== undefined && "readyCheckRunning" in control && control.readyCheckRunning === true;

export function ReadyPanel({ homes, pickups, control, focus }: { homes: Home[]; pickups: Pickup[]; control: Control; focus: HomeFocus }) {
  const running = campaignRunning(control);
  if (control?.warningIssuedAt) return pickups.length > 0 ? <NeighborPickups pickups={pickups} focus={focus} /> : null;
  if (homes.length === 0 && !running) {
    return (
      <Panel title="Ready check" aside={<span className="pr-1"><CampaignButton running={false} started={false} /></span>}>
        <p className="type-small px-4 pb-4 text-on-panel-muted">Before fire season, the agent calls every home to learn who lives there, what help they need and who will pick them up.</p>
      </Panel>
    );
  }
  return <ReadyCheck homes={homes} running={running} />;
}
