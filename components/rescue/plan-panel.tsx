"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatElapsed } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { Panel } from "../ui/panel";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";

const SOLVER_LABELS = { stand_in: "Stand-in", heuristic: "Heuristic", ortools: "OR-Tools" } as const;

const CHANGE_KINDS = [
  { kind: "offer", label: "offered" },
  { kind: "replace", label: "replaced" },
  { kind: "revoke", label: "revoked" },
] as const;

function ChangeCounts({ changes }: { changes: { kind: string }[] }) {
  return (
    <dl className="flex items-baseline gap-5 px-4 pb-2">
      {CHANGE_KINDS.map(({ kind, label }) => (
        <div key={kind} className="flex items-baseline gap-1.5">
          <dd className="type-figure text-2xl">{changes.filter((change) => change.kind === kind).length}</dd>
          <dt className="type-small text-on-panel-muted">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

// What the need model did on its last pass. Track D asked for these six rows in this order.
const STAT_ROWS = [
  { key: "scenarioMinute", label: "Scenario minute" },
  { key: "closuresAdded", label: "Hazard closures, last pass" },
  { key: "doorScored", label: "Door checks re-scored" },
  { key: "nominationsMatched", label: "Neighbor reports placed" },
  { key: "nominationsFlagged", label: "Neighbor reports unplaced" },
  { key: "located", label: "Callers located" },
] as const;

const STALE_MS = 15_000;

function ModelStats({ stats }: { stats: Record<string, number> }) {
  const rows = STAT_ROWS.filter((row) => stats[row.key] !== undefined);
  if (rows.length === 0) return null;
  return (
    <details className="border-t border-panel-raised">
      <summary className="type-small cursor-pointer px-4 py-2 font-semibold hover:bg-panel-raised">Last model pass</summary>
      <dl className="flex flex-col gap-0.5 px-4 pb-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-baseline justify-between gap-3">
            <dt className="type-small min-w-0 truncate text-on-panel-muted">{row.label}</dt>
            <dd className="type-small shrink-0 font-semibold tabular-nums">{stats[row.key]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

// Whether Track D's need model is actually running, and the switch that steers it.
function ModelState() {
  const state = useQuery(api.estimates.state);
  const setSmoothing = useMutation(api.estimates.setSmoothing);
  const now = useSimNow(5000);
  const lastRun = state?.lastRunAt;
  const hint = lastRun !== undefined && now - lastRun <= STALE_MS ? `Last pass ${formatElapsed(now - lastRun)} ago` : "Stand-in or stopped";
  return (
    <>
      <div title={hint}>
        <Switch checked={state?.smoothing ?? true} onChange={(enabled) => void setSmoothing({ enabled })} label="Neighbor smoothing" />
      </div>
      {state?.stats && <ModelStats stats={state.stats} />}
    </>
  );
}

const APPROVAL_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "manual", label: "I approve" },
] as const;

function ApprovalMode() {
  const control = useQuery(api.control.get);
  const setStandIns = useMutation(api.control.setStandIns);
  const auto = control?.autoApprove ?? true;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-panel-raised px-4 py-2">
      <span className="type-small font-semibold">Offers</span>
      <SegmentedControl
        options={APPROVAL_OPTIONS}
        value={auto ? "auto" : "manual"}
        ariaLabel="Who approves offers"
        onChange={(value) => void setStandIns({ autoApprove: value === "auto" })}
      />
    </div>
  );
}

export function PlanPanel({ className = "" }: { className?: string }) {
  const plan = useQuery(api.plans.latest);
  return (
    <Panel
      title={plan ? `Plan v${plan.version}` : "No plan yet"}
      aside={plan && <span className="type-small mr-3 rounded-md bg-surface-sunk px-1.5 py-0.5 font-semibold tabular-nums">{SOLVER_LABELS[plan.solver]} {plan.solveMs} ms</span>}
      className={className}
    >
      {plan && <ChangeCounts changes={plan.changes} />}
      <ModelState />
      <ApprovalMode />
    </Panel>
  );
}
