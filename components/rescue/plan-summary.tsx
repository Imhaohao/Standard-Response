"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "../ui/button";
import { Section } from "../ui/section";

const SOLVER_LABELS = { stand_in: "Stand-in", heuristic: "Heuristic", ortools: "OR-Tools" } as const;

function ApprovalMode() {
  const control = useQuery(api.control.get);
  const setStandIns = useMutation(api.control.setStandIns);
  const auto = control?.autoApprove ?? true;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
      <span className="type-small">{auto ? "Offers are approved automatically" : "You approve each offer"}</span>
      <Button variant="quiet" onClick={() => void setStandIns({ autoApprove: !auto })}>
        {auto ? "Approve offers myself" : "Approve automatically"}
      </Button>
    </div>
  );
}

export function PlanSummary() {
  const plan = useQuery(api.plans.latest);
  const changes = plan?.changes ?? [];
  const count = (kind: string) => changes.filter((c) => c.kind === kind).length;
  return (
    <Section title={plan ? `Plan v${plan.version}` : "No plan yet"}>
      {plan && (
        <dl className="type-small grid grid-cols-2 gap-x-4 gap-y-1 px-4 py-3">
          <dt className="text-ink-muted">Solver</dt>
          <dd>{SOLVER_LABELS[plan.solver]}</dd>
          <dt className="text-ink-muted">Solve time</dt>
          <dd>{plan.solveMs} ms</dd>
          <dt className="text-ink-muted">New offers</dt>
          <dd>{count("offer")}</dd>
          <dt className="text-ink-muted">Offers replaced</dt>
          <dd>{count("replace")}</dd>
          <dt className="text-ink-muted">Pickups revoked</dt>
          <dd>{count("revoke")}</dd>
        </dl>
      )}
      <ApprovalMode />
    </Section>
  );
}
