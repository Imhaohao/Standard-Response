"use client";

import { useQuery } from "convex/react";
import { ArrowRight } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { REQUEST_STATUS_LABELS, RequestStatus } from "@/lib/labels";
import { formatClock } from "@/lib/time";
import { AnimatedNumber } from "../ui/animated-number";
import { Panel, PanelEmpty } from "../ui/panel";

const SOLVER_LABELS = { stand_in: "Stand-in", heuristic: "Heuristic", ortools: "OR-Tools" } as const;

const CHANGE_KINDS = [
  { kind: "offer", label: "Offered" },
  { kind: "replace", label: "Replaced" },
  { kind: "revoke", label: "Revoked" },
] as const;

function Stat({ label, value, unit }: { label: string; value: number | undefined; unit?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-panel p-3">
      <dt className="type-small text-on-panel-muted">{label}</dt>
      <dd className="flex items-baseline gap-1">
        {value === undefined ? <span className="type-figure text-2xl text-on-panel-muted">–</span> : <AnimatedNumber value={value} className="type-figure text-2xl" />}
        {unit && value !== undefined && <span className="type-small text-on-panel-muted">{unit}</span>}
      </dd>
    </div>
  );
}

// Every re-plan: the problem it solved, how long it took, and what it changed for drivers.
export function ReplanPanel() {
  const plan = useQuery(api.plans.latest);
  const audit = useQuery(api.plans.auditTrail, { limit: 200 });
  const stale = audit?.filter((row) => row.kind === "stale_accept_rejected").length ?? 0;
  if (!plan) return <Panel title="No plan yet"><PanelEmpty>The first plan lands a few seconds after the warning.</PanelEmpty></Panel>;
  const count = (kind: string) => plan.changes.filter((change) => change.kind === kind).length;
  return (
    <Panel title={`Plan v${plan.version}`} aside={<span className="type-small text-on-panel-muted">{SOLVER_LABELS[plan.solver]}</span>}>
      <dl className="grid grid-cols-3 gap-px bg-panel-raised">
        <Stat label="Requests" value={plan.requestCount} />
        <Stat label="Vehicles" value={plan.vehicleCount} />
        <Stat label="Solve time" value={plan.solveMs} unit="ms" />
        {CHANGE_KINDS.map(({ kind, label }) => (
          <Stat key={kind} label={label} value={count(kind)} />
        ))}
      </dl>
      <p className="type-small flex items-baseline justify-between gap-2 border-t border-panel-raised px-3 py-2">
        <span className="text-on-panel-muted">Late accepts rejected</span>
        <span className="type-figure text-lg">{stale}</span>
      </p>
      {plan.fallbackReason && <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">Heuristic ran: {plan.fallbackReason}</p>}
      <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">Vehicle movement is simulated, 4x.</p>
    </Panel>
  );
}

const FLOW: RequestStatus[] = ["received", "approved", "driver_accepted", "en_route", "arrived"];

// Where every open request sits, left to right in the order a request moves. Reassigning is the
// detour, so it hangs under the line.
export function RequestFlow() {
  const requests = useQuery(api.requests.open) ?? [];
  const count = (status: RequestStatus) => requests.filter((request) => request.status === status).length;
  return (
    <Panel title="Requests" aside={<span className="type-small text-on-panel-muted tabular-nums">{requests.length} open</span>}>
      <ol className="flex items-stretch gap-1 p-3">
        {FLOW.map((status, index) => (
          <li key={status} className="flex min-w-0 flex-1 items-center gap-1">
            <span className="flex min-w-0 flex-1 flex-col gap-1 bg-panel-raised px-2 py-2">
              <AnimatedNumber value={count(status)} className="type-figure text-2xl" />
              <span className="type-small text-on-panel-muted">{REQUEST_STATUS_LABELS[status]}</span>
            </span>
            {index < FLOW.length - 1 && <ArrowRight weight="bold" className="size-3 shrink-0 text-on-panel-muted" aria-hidden />}
          </li>
        ))}
      </ol>
      <p className="type-small flex items-baseline gap-2 border-t border-panel-raised px-3 py-2">
        <AnimatedNumber value={count("reassigning")} className="type-figure text-lg" />
        <span className="text-on-panel-muted">{REQUEST_STATUS_LABELS.reassigning}</span>
      </p>
    </Panel>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const CALLBACK_SCALE_MS = 60_000;

// Time from the event (a driver accepting, a pickup revoked) to the rider hearing about it.
export function CallbackTiming() {
  const callbacks = useQuery(api.callbacks.recent, { limit: 30 });
  return (
    <Panel title="Callbacks" aside={<span className="type-small text-on-panel-muted">event to rider told</span>}>
      {callbacks?.length ? (
        <ul>
          {callbacks.map((callback) => {
            const took = callback.playedAt ? callback.playedAt - callback.createdAt : null;
            return (
              <li key={callback._id} className="grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-3 border-b border-panel-raised px-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <span className="type-small truncate font-bold">{callback.address}</span>
                  <span className="type-small text-on-panel-muted">{callback.announces === "driver_accepted" ? "Driver accepted" : "Driver can't reach them"}</span>
                </span>
                <span className="h-1.5 bg-panel-raised" aria-hidden>
                  {took !== null && <span className="block h-full bg-on-panel" style={{ width: `${Math.min(100, (took / CALLBACK_SCALE_MS) * 100)}%` }} />}
                </span>
                <span className="type-small text-right tabular-nums">{took !== null ? seconds(took) : callback.state}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <PanelEmpty>No callbacks yet.</PanelEmpty>
      )}
    </Panel>
  );
}

// The Convex demo beats: a stale accept rejected and a duplicate event ignored.
const HIGHLIGHT = new Set<Doc<"auditLog">["kind"]>(["stale_accept_rejected", "callback_duplicate", "revoked"]);

export function AuditTrail() {
  const rows = useQuery(api.plans.auditTrail, { limit: 80 });
  return (
    <Panel title="Audit trail" className="min-h-0">
      <ol className="flex min-h-0 flex-col overflow-y-auto">
        {rows?.map((row) => {
          const loud = HIGHLIGHT.has(row.kind);
          return (
            <li key={row._id} className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-panel-raised px-3 py-1.5 ${loud ? "bg-panel-raised shadow-[inset_3px_0_0_var(--on-panel)]" : ""}`}>
              <span className={`type-small ${loud ? "font-bold" : ""}`}>
                {row.planVersion !== undefined && <span className="text-on-panel-muted tabular-nums">v{row.planVersion} </span>}
                {row.message}
              </span>
              <span className="type-small text-on-panel-muted tabular-nums">{formatClock(row.at)}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
