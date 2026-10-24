"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { Check, Info } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { deathsIfUnserved, expectedDeaths } from "@/convex/fatalityRisk";
import { ASSIGNMENT_STATUS_LABELS, ESCALATION_LABELS } from "@/lib/labels";
import { formatCountdown, useNow } from "@/lib/time";
import { Button } from "../ui/button";
import { Panel, PanelEmpty } from "../ui/panel";
import { OpenRequest, byUrgency } from "./marks";
import { EscalationPill, NeedStage, RequestBadge, VanChip, needStage } from "./request-badge";

type Assignment = FunctionReturnType<typeof api.offers.active>[number];

const STAGES = [
  { stage: "waiting", label: "Waiting", segment: "bg-signal", figure: "text-signal text-5xl" },
  { stage: "vanComing", label: "Van coming", segment: "bg-map-ink", figure: "text-ink text-3xl" },
  { stage: "pickedUp", label: "Picked up", segment: "bg-on-panel-muted", figure: "text-ink-muted text-3xl" },
] as const;

const MIN_SEGMENT_SHARE = 0.1;

function StageSummary({ counts }: { counts: Record<NeedStage, number> }) {
  const total = STAGES.reduce((sum, { stage }) => sum + counts[stage], 0);
  return (
    <div className="flex flex-col gap-2 px-4 pb-3">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-sunk" aria-hidden>
        {STAGES.map(({ stage, segment }) => (
          <span key={stage} className={`${segment} transition-[flex-grow] duration-300`} style={{ flexGrow: Math.max(counts[stage], counts[stage] > 0 ? total * MIN_SEGMENT_SHARE : 0), flexBasis: 0 }} />
        ))}
        {total === 0 && <span className="flex-1" />}
      </div>
      <dl className="flex items-end justify-between gap-2">
        {STAGES.map(({ stage, label, figure }) => (
          <div key={stage} className="flex flex-col gap-1">
            <dd className={`type-figure tabular-nums ${figure}`}>{counts[stage]}</dd>
            <dt className="type-small text-on-panel-muted">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

const RISK_MODEL_NOTE =
  "Assumed risk model, not a prediction: each rider's risk grows with their need, is zero when a vehicle reaches them by their deadline, and reaches its maximum at fire arrival. The solver plans to make the first number as small as it can.";

function boardingTime(assignment: Assignment) {
  const from = assignment.etaUpdatedAt ?? assignment.offeredAt ?? assignment.proposedAt;
  return from + assignment.etaMinutes * 60_000;
}

function deathEstimates(requests: OpenRequest[], assignments: Assignment[]) {
  const boardsAt = new Map(assignments.map((assignment) => [assignment.requestId, boardingTime(assignment)]));
  let withPlan = 0;
  let withoutRides = 0;
  for (const request of requests) {
    withoutRides += deathsIfUnserved(request);
    if (needStage(request) !== "pickedUp") withPlan += expectedDeaths(request, boardsAt.get(request._id) ?? null);
  }
  return { withPlan, withoutRides };
}

function DeathEstimate({ requests, assignments }: { requests: OpenRequest[]; assignments: Assignment[] }) {
  const { withPlan, withoutRides } = deathEstimates(requests, assignments);
  return (
    <div className="mx-4 mb-3 flex items-end gap-6 rounded-xl bg-surface-sunk px-3 py-2.5">
      <dl className="flex flex-1 items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <dd className="type-figure text-3xl tabular-nums text-signal">{withPlan.toFixed(1)}</dd>
          <dt className="type-small text-on-panel-muted">Expected deaths, this plan</dt>
        </div>
        <div className="flex flex-col items-end gap-1">
          <dd className="type-figure text-2xl tabular-nums text-ink-muted">{withoutRides.toFixed(1)}</dd>
          <dt className="type-small text-on-panel-muted">If no vehicle came</dt>
        </div>
      </dl>
      <span className="mb-0.5 text-on-panel-muted" title={RISK_MODEL_NOTE} aria-label={RISK_MODEL_NOTE} role="img">
        <Info className="size-4" />
      </span>
    </div>
  );
}

function ApproveButton({ assignment }: { assignment: Assignment }) {
  const approve = useMutation(api.offers.approve);
  return (
    <Button variant="onPanel" aria-label="Approve this offer" title="Approve this offer" className="!size-7 !rounded-lg !p-0" onClick={() => void approve({ assignmentId: assignment._id })}>
      <Check weight="bold" className="size-4" />
    </Button>
  );
}

function NeedRow({
  request,
  assignment,
  vehicleLabel,
  now,
}: {
  request: OpenRequest;
  assignment?: Assignment;
  vehicleLabel: string;
  now: number;
}) {
  const escalation = request.escalation;
  const title = escalation ? ESCALATION_LABELS[escalation] : undefined;
  return (
    <li className={`flex items-center gap-2 px-4 py-1.5 ${escalation ? "bg-signal-soft" : ""}`} title={title}>
      <RequestBadge request={request} />
      <span className="type-small min-w-0 flex-1 truncate font-semibold" title={request.address}>
        {request.address}
      </span>
      {escalation && <EscalationPill escalation={escalation} />}
      <span className="type-small shrink-0 rounded-md bg-surface-sunk px-1.5 py-0.5 font-semibold tabular-nums">{formatCountdown(request.deadlineAt - now)}</span>
      {assignment && (
        <VanChip label={vehicleLabel} busy title={`${vehicleLabel} ${ASSIGNMENT_STATUS_LABELS[assignment.status].toLowerCase()}`} />
      )}
      {assignment?.status === "proposed" && <ApproveButton assignment={assignment} />}
    </li>
  );
}

function ApproveAll({ proposed }: { proposed: Assignment[] }) {
  const approve = useMutation(api.offers.approve);
  if (proposed.length === 0) return null;
  return (
    <Button variant="onPanel" className="!h-7 !rounded-lg !px-2.5 !text-xs" onClick={() => void Promise.all(proposed.map((a) => approve({ assignmentId: a._id })))}>
      Approve all {proposed.length}
    </Button>
  );
}

function countStages(requests: OpenRequest[]): Record<NeedStage, number> {
  const counts = { waiting: 0, vanComing: 0, pickedUp: 0 };
  for (const request of requests) counts[needStage(request)] += 1;
  return counts;
}

export function NeedPanel({ className = "" }: { className?: string }) {
  const requests = useQuery(api.requests.open);
  const assignments = useQuery(api.offers.active) ?? [];
  const vehicles = useQuery(api.vehicles.list);
  const now = useNow(15_000);
  const vehicleLabels = new Map<Id<"vehicles">, string>(vehicles?.map((vehicle) => [vehicle._id, vehicle.label]));
  const all = requests ?? [];
  const open = all.filter((request) => needStage(request) !== "pickedUp").sort(byUrgency);
  const proposed = assignments.filter((assignment) => assignment.status === "proposed");

  return (
    <Panel title="Who needs a ride" aside={<ApproveAll proposed={proposed} />} className={className}>
      <StageSummary counts={countStages(all)} />
      <DeathEstimate requests={all} assignments={assignments} />
      {open.length === 0 ? (
        <PanelEmpty>Nobody is waiting.</PanelEmpty>
      ) : (
        <ol className="flex min-h-0 flex-col overflow-y-auto pb-2">
          {open.map((request) => {
            const assignment = assignments.find((candidate) => candidate.requestId === request._id);
            return (
              <NeedRow
                key={request._id}
                request={request}
                assignment={assignment}
                vehicleLabel={assignment ? (vehicleLabels.get(assignment.vehicleId) ?? "Van") : ""}
                now={now}
              />
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
