"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatElapsed } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { Panel } from "../ui/panel";
import { Switch } from "../ui/switch";
import { SegmentedControl } from "../ui/segmented-control";

const SOLVER_LABELS = { stand_in: "Stand-in", heuristic: "Heuristic", ortools: "OR-Tools", alns: "ALNS" } as const;

// What the planner did on its last change, in plain words: a ride offered to a driver, an offer moved
// to another vehicle, or an offer called off (a road closed, or the rider no longer needs it).
const CHANGE_PHRASES = [
  { kind: "offer", one: "ride offered to a driver", many: "rides offered to drivers" },
  { kind: "replace", one: "ride moved to another vehicle", many: "rides moved to other vehicles" },
  { kind: "revoke", one: "offer called off", many: "offers called off" },
] as const;

function changeSentence(changes: { kind: string }[]) {
  const parts = CHANGE_PHRASES.flatMap(({ kind, one, many }) => {
    const count = changes.filter((change) => change.kind === kind).length;
    return count === 0 ? [] : [`${count} ${count === 1 ? one : many}`];
  });
  return parts.length === 0 ? "No rides changed" : parts.join(", ");
}

function LastChange({ changes }: { changes: { kind: string }[] }) {
  return (
    <p className="type-small px-4 pb-2">
      <span className="text-on-panel-muted">Last change: </span>
      <span className="font-semibold">{changeSentence(changes)}</span>
    </p>
  );
}

// What the need model did on its last pass, in these six rows.
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

// Whether the need model is actually running, and the switch that steers it.
function ModelState() {
  const state = useQuery(api.estimates.state);
  const setSmoothing = useMutation(api.estimates.setSmoothing);
  const now = useSimNow(5000);
  const lastRun = state?.lastRunAt;
  const hint = lastRun !== undefined && now - lastRun <= STALE_MS ? `Last pass ${formatElapsed(now - lastRun)} ago` : "Stand-in or stopped";
  return (
    <>
      <div title={hint}>
        <Switch checked={state?.smoothing ?? true} onChange={(enabled) => void setSmoothing({ enabled })} label="Estimate who needs a ride from neighbors' answers" />
      </div>
      {state?.stats && <ModelStats stats={state.stats} />}
    </>
  );
}

const APPROVAL_OPTIONS = [
  { value: "auto", label: "Right away" },
  { value: "manual", label: "After I approve" },
] as const;

function ApprovalMode() {
  const control = useQuery(api.control.get);
  const setStandIns = useMutation(api.control.setStandIns);
  const auto = control?.autoApprove ?? true;
  return (
    <div className="flex flex-col gap-1.5 border-t border-panel-raised px-4 py-2">
      <span className="type-small font-semibold">Send ride offers to drivers</span>
      <SegmentedControl
        options={APPROVAL_OPTIONS}
        value={auto ? "auto" : "manual"}
        ariaLabel="When ride offers go to drivers"
        onChange={(value) => void setStandIns({ autoApprove: value === "auto" })}
      />
    </div>
  );
}

// The solver and its run time stay in the tooltip for whoever is debugging; the panel itself only
// says whether there is a plan yet.
function PlanStatus({ plan }: { plan: { version: number; solver: keyof typeof SOLVER_LABELS; solveMs: number } | null | undefined }) {
  if (plan) return <span className="sr-only">{`Plan update ${plan.version}, ${SOLVER_LABELS[plan.solver]} solver, ${plan.solveMs} ms`}</span>;
  return <span className="type-small mr-3 text-on-panel-muted">No plan yet</span>;
}

export function PlanPanel({ className = "" }: { className?: string }) {
  const plan = useQuery(api.plans.latest);
  return (
    <Panel
      title="Dispatch plan"
      aside={<PlanStatus plan={plan} />}
      className={className}
    >
      {plan && <LastChange changes={plan.changes} />}
      <ModelState />
      <ApprovalMode />
    </Panel>
  );
}
