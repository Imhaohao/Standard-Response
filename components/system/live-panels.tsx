"use client";

import { useQuery } from "convex/react";
import { ClockCounterClockwise, PhoneCall, Path } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { REQUEST_STATUS_LABELS, RequestStatus } from "@/lib/labels";
import { formatClock } from "@/lib/time";
import { AnimatedNumber } from "../ui/animated-number";
import { Panel } from "../ui/panel";
import { Disclosure } from "./disclosure";
import { Tag } from "../ui/tag";

const SOLVER_LABELS = { stand_in: "Stand-in", heuristic: "Heuristic", ortools: "OR-Tools", alns: "ALNS" } as const;

const CHANGE_KINDS = [
  { kind: "offer", label: "Offered" },
  { kind: "replace", label: "Replaced" },
  { kind: "revoke", label: "Revoked" },
] as const;

function Stat({ label, value, unit }: { label: string; value: number | undefined; unit?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-small text-on-panel-muted">{label}</dt>
      <dd className="flex items-baseline gap-1">
        {value === undefined ? <span className="type-figure text-2xl text-on-panel-muted">–</span> : <AnimatedNumber value={value} className="type-figure text-2xl" />}
        {unit && value !== undefined && <span className="type-small text-on-panel-muted">{unit}</span>}
      </dd>
    </div>
  );
}

export function PlanDisclosure() {
  const plan = useQuery(api.plans.latest);
  const audit = useQuery(api.plans.auditTrail, { limit: 200 });
  const stale = audit?.filter((row) => row.kind === "stale_accept_rejected").length ?? 0;
  if (!plan) {
    return (
      <Disclosure icon={Path} title="Plan" fact="none yet">
        <p className="type-small text-on-panel-muted">The first plan lands a few seconds after the warning.</p>
      </Disclosure>
    );
  }
  const count = (kind: string) => plan.changes.filter((change) => change.kind === kind).length;
  return (
    <Disclosure icon={Path} title={`Plan v${plan.version}`} fact={`${SOLVER_LABELS[plan.solver]}, solved in ${plan.solveMs} ms`}>
      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <Stat label="Requests" value={plan.requestCount} />
        <Stat label="Vehicles" value={plan.vehicleCount} />
        <Stat label="Solve time" value={plan.solveMs} unit="ms" />
        <Stat label="Late accepts rejected" value={stale} />
        {CHANGE_KINDS.map(({ kind, label }) => (
          <Stat key={kind} label={label} value={count(kind)} />
        ))}
      </dl>
      {plan.fallbackReason && <p className="type-small text-on-panel-muted">Heuristic ran: {plan.fallbackReason}</p>}
    </Disclosure>
  );
}

const PIPELINE: { status: RequestStatus; label: string; fill: string }[] = [
  { status: "received", label: "Waiting", fill: "bg-signal-soft text-signal" },
  { status: "approved", label: "Offer sent", fill: "bg-panel-raised" },
  { status: "driver_accepted", label: "Accepted", fill: "bg-panel-raised" },
  { status: "en_route", label: "On the way", fill: "bg-panel-raised" },
  { status: "arrived", label: "Picked up", fill: "bg-on-panel text-panel" },
];

export function RequestPipeline() {
  const requests = useQuery(api.requests.open) ?? [];
  const count = (status: RequestStatus) => requests.filter((request) => request.status === status).length;
  const reassigning = count("reassigning");
  return (
    <Panel
      title="Requests"
      aside={
        <span className="type-small flex items-center gap-3 tabular-nums">
          {reassigning > 0 && <span className="font-bold">{reassigning} finding a new driver</span>}
          <span className="text-on-panel-muted">{requests.length} open</span>
        </span>
      }
    >
      <ol className="flex flex-wrap gap-1 px-4 pb-4 sm:flex-nowrap">
        {PIPELINE.map(({ status, label, fill }) => (
          <li
            key={status}
            title={REQUEST_STATUS_LABELS[status]}
            className={`flex min-w-24 flex-col gap-1 rounded-lg px-3 py-3 transition-[flex-grow] duration-500 sm:min-w-16 sm:rounded-none sm:first:rounded-l-xl sm:last:rounded-r-xl ${fill}`}
            style={{ flexGrow: 2 + Math.sqrt(count(status)) }}
          >
            <AnimatedNumber value={count(status)} className="type-figure text-5xl" />
            <span className="type-small font-semibold">{label}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

const callbackSeconds = (took: number) => `${(took / 1000).toFixed(1)} s`;
const CALLBACK_SCALE_MS = 60_000;

export type CallbackSpread = { medianMs: number; minMs: number; maxMs: number };

export function useCallbackSpread(): CallbackSpread | null {
  const callbacks = useQuery(api.callbacks.recent, { limit: 30 });
  const times = (callbacks ?? []).flatMap((callback) => (callback.playedAt ? [callback.playedAt - callback.createdAt] : [])).sort((a, b) => a - b);
  if (times.length === 0) return null;
  return { medianMs: times[Math.floor(times.length / 2)], minMs: times[0], maxMs: times[times.length - 1] };
}

export function CallbacksDisclosure() {
  const callbacks = useQuery(api.callbacks.recent, { limit: 30 });
  const spread = useCallbackSpread();
  return (
    <Disclosure icon={PhoneCall} title="Callbacks" fact={spread ? `median ${callbackSeconds(spread.medianMs)}` : "none yet"}>
      <Tag>Event to rider told</Tag>
      <ul>
        {callbacks?.map((callback) => {
          const took = callback.playedAt ? callback.playedAt - callback.createdAt : null;
          return (
            <li key={callback._id} className="grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="type-small truncate font-bold">{callback.address}</span>
                <span className="type-small text-on-panel-muted">{callback.announces === "driver_accepted" ? "Driver accepted" : "Driver can't reach them"}</span>
              </span>
              <span className="h-1.5 bg-panel-raised" aria-hidden>
                {took !== null && <span className="block h-full bg-on-panel" style={{ width: `${Math.min(100, (took / CALLBACK_SCALE_MS) * 100)}%` }} />}
              </span>
              <span className="type-small text-right tabular-nums">{took !== null ? callbackSeconds(took) : callback.state}</span>
            </li>
          );
        })}
      </ul>
    </Disclosure>
  );
}

// The Convex demo beats: a stale accept rejected and a duplicate event ignored.
const HIGHLIGHT = new Set<Doc<"auditLog">["kind"]>(["stale_accept_rejected", "callback_duplicate", "revoked"]);

export function AuditDisclosure() {
  const rows = useQuery(api.plans.auditTrail, { limit: 80 });
  return (
    <Disclosure icon={ClockCounterClockwise} title="Audit trail" fact={`${rows?.length ?? 0} events`}>
      <ol className="flex max-h-96 flex-col overflow-y-auto">
        {rows?.map((row) => {
          const loud = HIGHLIGHT.has(row.kind);
          return (
            <li key={row._id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-1.5 ${loud ? "bg-panel-raised px-2 shadow-[inset_3px_0_0_var(--on-panel)]" : ""}`}>
              <span className={`type-small ${loud ? "font-bold" : ""}`}>
                {row.planVersion !== undefined && <span className="text-on-panel-muted tabular-nums">v{row.planVersion} </span>}
                {row.message}
              </span>
              <span className="type-small text-on-panel-muted tabular-nums">{formatClock(row.at)}</span>
            </li>
          );
        })}
      </ol>
    </Disclosure>
  );
}
