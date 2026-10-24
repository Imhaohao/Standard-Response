"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatElapsed, useNow } from "@/lib/time";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";
import { Switch } from "../ui/switch";

const SOLVER_LABELS = { stand_in: "Stand-in", heuristic: "Heuristic", ortools: "OR-Tools" } as const;

const CHANGE_KINDS = [
  { kind: "offer", label: "offered" },
  { kind: "replace", label: "replaced" },
  { kind: "revoke", label: "revoked" },
] as const;

function ChangeCounts({ changes }: { changes: { kind: string }[] }) {
  return (
    <dl className="grid grid-cols-3 border-b border-panel-raised">
      {CHANGE_KINDS.map(({ kind, label }) => (
        <div key={kind} className="flex flex-col items-center gap-0.5 px-3 py-2">
          <dd className="type-figure text-lg">{changes.filter((change) => change.kind === kind).length}</dd>
          <dt className="type-small text-on-panel-muted">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

// Whether Track D's need model is actually running, and the switch that steers it.
function ModelState() {
  const state = useQuery(api.estimates.state);
  const setSmoothing = useMutation(api.estimates.setSmoothing);
  const now = useNow(5000);
  const lastRun = state?.lastRunAt;
  const hint = lastRun ? `Last pass ${formatElapsed(now - lastRun)} ago` : "No pass yet this session";
  return <Switch checked={state?.smoothing ?? true} onChange={(enabled) => void setSmoothing({ enabled })} label="Neighbour smoothing" hint={hint} />;
}

function ApprovalMode() {
  const control = useQuery(api.control.get);
  const setStandIns = useMutation(api.control.setStandIns);
  const auto = control?.autoApprove ?? true;
  return (
    <div className="flex items-center justify-between gap-2 border-t border-panel-raised px-3 py-2">
      <span className="type-small text-on-panel-muted">{auto ? "Offers approve themselves" : "You approve each offer"}</span>
      <Button variant="onPanelQuiet" className="!h-7 !px-2.5 !text-xs" onClick={() => void setStandIns({ autoApprove: !auto })}>
        {auto ? "Approve myself" : "Automate"}
      </Button>
    </div>
  );
}

export function PlanPanel({ className = "" }: { className?: string }) {
  const plan = useQuery(api.plans.latest);
  return (
    <Panel
      title={plan ? `Plan v${plan.version}` : "No plan yet"}
      aside={plan && <span className="type-small tabular-nums text-on-panel-muted">{SOLVER_LABELS[plan.solver]} · {plan.solveMs} ms</span>}
      className={className}
    >
      {plan && <ChangeCounts changes={plan.changes} />}
      <ModelState />
      <ApprovalMode />
    </Panel>
  );
}
