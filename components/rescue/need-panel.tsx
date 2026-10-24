"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { Users, Wheelchair } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ASSIGNMENT_STATUS_LABELS, ESCALATION_LABELS, REQUEST_STATUS_LABELS, needsSummary } from "@/lib/labels";
import { formatCountdown, useNow } from "@/lib/time";
import { Button } from "../ui/button";
import { Panel } from "../ui/panel";
import { OpenRequest, awaitingRide, byUrgency } from "./marks";

type Assignment = FunctionReturnType<typeof api.offers.active>[number];

// Two glyphs carry the whole request: who is travelling, and how many people it takes to move them.
function NeedGlyphs({ request }: { request: OpenRequest }) {
  const { seats, wheelchairSpaces, stretcherSpaces } = request.load;
  const wheeled = wheelchairSpaces + stretcherSpaces;
  return (
    <span className="flex shrink-0 items-center gap-1 text-on-panel-muted" aria-label={needsSummary(request.load, request.crewNeeded)}>
      {wheeled > 0 && (
        <span className="flex items-center gap-0.5 text-signal">
          <Wheelchair weight="bold" className="size-4" />
          <span className="type-small font-bold">{wheeled}</span>
        </span>
      )}
      <span className="flex items-center gap-0.5">
        <Users weight="bold" className="size-4" />
        <span className="type-small font-bold">{seats + request.crewNeeded}</span>
      </span>
    </span>
  );
}

function AssignmentLine({ assignment, vehicleLabel }: { assignment: Assignment; vehicleLabel: string }) {
  const approve = useMutation(api.offers.approve);
  const proposed = assignment.status === "proposed";
  return (
    <div className="flex items-center gap-2 border-t border-panel-raised pt-1.5">
      <span className="type-small min-w-0 flex-1 truncate text-on-panel-muted">
        <span className="font-semibold text-on-panel">{vehicleLabel}</span> {ASSIGNMENT_STATUS_LABELS[assignment.status].toLowerCase()}
        {assignment.etaMinutes > 0 && `, ${assignment.etaMinutes} min out`}
      </span>
      {proposed && (
        <Button variant="onPanel" className="!h-7 !px-2.5 !text-xs" onClick={() => void approve({ assignmentId: assignment._id })}>
          Approve
        </Button>
      )}
    </div>
  );
}

function NeedRow({
  request,
  assignments,
  vehicleLabels,
  now,
}: {
  request: OpenRequest;
  assignments: Assignment[];
  vehicleLabels: Map<Id<"vehicles">, string>;
  now: number;
}) {
  const escalation = request.escalation;
  return (
    <li className={`flex flex-col gap-1.5 border-b border-panel-raised px-3 py-2.5 ${escalation ? "border-l-2 border-l-signal bg-signal/10" : ""}`}>
      <div className="flex items-baseline gap-2">
        <span className="type-small min-w-0 flex-1 font-semibold">{request.address}</span>
        <span className="type-small shrink-0 tabular-nums text-on-panel-muted">{formatCountdown(request.deadlineAt - now)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className={`type-small ${escalation ? "font-bold text-signal" : "text-on-panel-muted"}`}>
          {escalation ? ESCALATION_LABELS[escalation] : REQUEST_STATUS_LABELS[request.status]}
        </span>
        <NeedGlyphs request={request} />
      </div>
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
    <Button variant="onPanelQuiet" className="!h-7 !px-2.5 !text-xs" onClick={() => void Promise.all(proposed.map((a) => approve({ assignmentId: a._id })))}>
      Approve all {proposed.length}
    </Button>
  );
}

export function NeedPanel({ className = "" }: { className?: string }) {
  const requests = useQuery(api.requests.open);
  const assignments = useQuery(api.offers.active) ?? [];
  const vehicles = useQuery(api.vehicles.list);
  const now = useNow(15_000);
  const vehicleLabels = new Map(vehicles?.map((vehicle) => [vehicle._id, vehicle.label]));
  const open = (requests ?? []).filter(awaitingRide).sort(byUrgency);
  const proposed = assignments.filter((assignment) => assignment.status === "proposed");

  return (
    <Panel
      title={`Who needs a ride (${open.length})`}
      aside={<ApproveAll proposed={proposed} />}
      className={className}
    >
      <ol className="flex min-h-0 flex-col overflow-y-auto">
        {open.map((request) => (
          <NeedRow
            key={request._id}
            request={request}
            assignments={assignments.filter((assignment) => assignment.requestId === request._id)}
            vehicleLabels={vehicleLabels}
            now={now}
          />
        ))}
      </ol>
    </Panel>
  );
}
