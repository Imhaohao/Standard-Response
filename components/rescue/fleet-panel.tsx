"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ASSIGNMENT_STATUS_LABELS } from "@/lib/labels";
import { Panel, PanelEmpty } from "../ui/panel";
import { CapacityIcons, VanChip } from "./request-badge";

type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];
type Assignment = FunctionReturnType<typeof api.offers.active>[number];

const RUNNING: Assignment["status"][] = ["proposed", "offered", "accepted"];

function vehicleDetail(vehicle: Vehicle, assignment?: Assignment, destination?: string) {
  const status = assignment ? `${ASSIGNMENT_STATUS_LABELS[assignment.status]}${destination ? `, ${destination}` : ""}` : "Free";
  return `${vehicle.driverName}. ${status}`;
}

export function FleetPanel({ className = "" }: { className?: string }) {
  const vehicles = useQuery(api.vehicles.list);
  const assignments = useQuery(api.offers.active) ?? [];
  const requests = useQuery(api.requests.open) ?? [];
  const addresses = new Map<Id<"requests">, string>(requests.map((request) => [request._id, request.address]));
  const running = assignments.filter((assignment) => RUNNING.includes(assignment.status));
  const freeCount = (vehicles ?? []).filter((vehicle) => !running.some((assignment) => assignment.vehicleId === vehicle._id)).length;

  return (
    <Panel title="Vehicles" aside={vehicles && <span className="type-small pr-4 text-on-panel-muted">{freeCount} free</span>} className={className}>
      {vehicles?.length ? (
        <ul className="flex flex-wrap gap-1.5 px-4 pb-3">
          {vehicles.map((vehicle) => {
            const assignment = running.find((candidate) => candidate.vehicleId === vehicle._id);
            const destination = assignment ? addresses.get(assignment.requestId) : undefined;
            return (
              <li key={vehicle._id}>
                <VanChip label={vehicle.label} busy={Boolean(assignment)} title={vehicleDetail(vehicle, assignment, destination)}>
                  <CapacityIcons seats={vehicle.seats} wheelchairSpaces={vehicle.wheelchairSpaces} />
                </VanChip>
              </li>
            );
          })}
        </ul>
      ) : (
        <PanelEmpty>No vehicles yet.</PanelEmpty>
      )}
    </Panel>
  );
}
