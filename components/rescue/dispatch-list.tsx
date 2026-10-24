"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ASSIGNMENT_STATUS_LABELS, ESCALATION_LABELS, REQUEST_STATUS_LABELS, needsSummary } from "@/lib/labels";
import { formatCountdown, useNow } from "@/lib/time";
import { Button } from "../ui/button";
import { Section } from "../ui/section";

type Request = FunctionReturnType<typeof api.requests.open>[number];
type Assignment = FunctionReturnType<typeof api.offers.active>[number];

// Escalations first, then the nearest deadline.
const byUrgency = (a: Request, b: Request) =>
  Number(Boolean(b.escalation)) - Number(Boolean(a.escalation)) || a.deadlineAt - b.deadlineAt;

function AssignmentLine({ assignment, vehicleLabel }: { assignment: Assignment; vehicleLabel: string }) {
  const approve = useMutation(api.offers.approve);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="type-small">
        {vehicleLabel}, {assignment.etaMinutes} min away: {ASSIGNMENT_STATUS_LABELS[assignment.status]}
      </span>
      {assignment.status === "proposed" && (
        <Button onClick={() => void approve({ assignmentId: assignment._id })}>Approve offer</Button>
      )}
    </div>
  );
}

function RequestRow({
  request,
  assignments,
  vehicleLabels,
  now,
}: {
  request: Request;
  assignments: Assignment[];
  vehicleLabels: Map<Id<"vehicles">, string>;
  now: number;
}) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-line px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="type-heading">{request.address}</span>
        <span className="type-small text-ink-muted">{formatCountdown(request.deadlineAt - now)} left</span>
      </div>
      {request.escalation && <p className="type-small font-semibold text-signal">{ESCALATION_LABELS[request.escalation]}</p>}
      <p className="type-small text-ink-muted">
        {REQUEST_STATUS_LABELS[request.status]}. Needs {needsSummary(request.load, request.crewNeeded)}.
      </p>
      {assignments.map((assignment) => (
        <AssignmentLine key={assignment._id} assignment={assignment} vehicleLabel={vehicleLabels.get(assignment.vehicleId) ?? "Vehicle"} />
      ))}
    </li>
  );
}

function ApproveAll({ proposed }: { proposed: Assignment[] }) {
  const approve = useMutation(api.offers.approve);
  if (proposed.length === 0) return null;
  return (
    <Button
      variant="quiet"
      onClick={() => void Promise.all(proposed.map((a) => approve({ assignmentId: a._id })))}
    >
      Approve all {proposed.length}
    </Button>
  );
}

export function DispatchList({ className = "" }: { className?: string }) {
  const requests = useQuery(api.requests.open);
  const assignments = useQuery(api.offers.active) ?? [];
  const vehicles = useQuery(api.vehicles.list);
  const now = useNow(15_000);
  const vehicleLabels = new Map(vehicles?.map((v) => [v._id, v.label]));
  const open = (requests ?? []).filter((r) => r.status !== "arrived").sort(byUrgency);

  return (
    <Section title={`Ride requests (${open.length})`} aside={<ApproveAll proposed={assignments.filter((a) => a.status === "proposed")} />} className={className}>
      {open.length === 0 ? (
        <p className="type-body px-4 py-10 text-center text-ink-muted">Requests appear when a rider says they need a ride.</p>
      ) : (
        <ol className="flex max-h-[42rem] flex-col overflow-y-auto">
          {open.map((request) => (
            <RequestRow
              key={request._id}
              request={request}
              assignments={assignments.filter((a) => a.requestId === request._id)}
              vehicleLabels={vehicleLabels}
              now={now}
            />
          ))}
        </ol>
      )}
    </Section>
  );
}
