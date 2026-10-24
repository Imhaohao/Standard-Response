"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { Users, Wheelchair } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Panel, PanelEmpty } from "../ui/panel";

type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];
type Assignment = FunctionReturnType<typeof api.offers.active>[number];

const TYPE_LABELS = { paratransit: "Paratransit", bus: "Bus", fire_unit: "Fire unit", ambulance: "Ambulance" } as const;

const RUNNING: Assignment["status"][] = ["proposed", "offered", "accepted"];

function VehicleStatus({ assignment, destination }: { assignment?: Assignment; destination?: string }) {
  if (!assignment) return <span className="type-small text-on-panel-muted">Free</span>;
  if (assignment.status === "proposed") return <span className="type-small font-semibold text-signal">Waiting for your approval</span>;
  if (assignment.status === "offered") return <span className="type-small text-on-panel-muted">Offer sent to the driver</span>;
  return (
    <span className="type-small min-w-0 truncate text-on-panel-muted">
      On the way{assignment.etaMinutes > 0 ? `, ${assignment.etaMinutes} min out` : ""}
      {destination ? ` to ${destination}` : ""}
    </span>
  );
}

function VehicleRow({ vehicle, assignment, destination }: { vehicle: Vehicle; assignment?: Assignment; destination?: string }) {
  return (
    <li className="flex flex-col gap-0.5 border-b border-panel-raised px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="type-small min-w-0 flex-1 truncate font-semibold">
          {vehicle.label}
          <span className="font-normal text-on-panel-muted"> {TYPE_LABELS[vehicle.type]}, {vehicle.driverName}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-on-panel-muted" aria-label={`Fits ${vehicle.seats} seats, ${vehicle.wheelchairSpaces} wheelchairs, crew of ${vehicle.crewSize}`}>
          {vehicle.wheelchairSpaces > 0 && (
            <span className="flex items-center gap-0.5">
              <Wheelchair weight="bold" className="size-3.5" />
              <span className="type-small font-bold">{vehicle.wheelchairSpaces}</span>
            </span>
          )}
          <span className="flex items-center gap-0.5">
            <Users weight="bold" className="size-3.5" />
            <span className="type-small font-bold">{vehicle.seats}</span>
          </span>
        </span>
      </div>
      <VehicleStatus assignment={assignment} destination={destination} />
    </li>
  );
}

export function FleetPanel({ className = "" }: { className?: string }) {
  const vehicles = useQuery(api.vehicles.list);
  const assignments = useQuery(api.offers.active) ?? [];
  const requests = useQuery(api.requests.open) ?? [];
  const addresses = new Map<Id<"requests">, string>(requests.map((request) => [request._id, request.address]));
  const running = assignments.filter((assignment) => RUNNING.includes(assignment.status));

  return (
    <Panel title={`Vehicles (${vehicles?.length ?? 0})`} className={className}>
      {vehicles?.length ? (
        <ul className="flex min-h-0 flex-col overflow-y-auto">
          {vehicles.map((vehicle) => {
            const assignment = running.find((candidate) => candidate.vehicleId === vehicle._id);
            return (
              <VehicleRow
                key={vehicle._id}
                vehicle={vehicle}
                assignment={assignment}
                destination={assignment ? addresses.get(assignment.requestId) : undefined}
              />
            );
          })}
        </ul>
      ) : (
        <PanelEmpty>No vehicles yet.</PanelEmpty>
      )}
    </Panel>
  );
}
