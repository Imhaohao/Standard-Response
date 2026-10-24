"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Anchor, GeoAnchor, GeoLeg, GeoLine, MapLine } from "@/components/map/layers";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { awaitingRide, OpenRequest } from "./marks";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const HAZARD = "var(--signal)";

type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];
type Assignment = FunctionReturnType<typeof api.offers.active>[number];
type Route = FunctionReturnType<typeof api.dispatch.routes>[number];

// Labels sit on a paper casing so they stay readable over streets and screentone.
const LABEL = { fill: INK, stroke: PAPER, strokeWidth: 3, paintOrder: "stroke" as const, fontSize: 11, fontWeight: 700 };

// Every pin is red, because every pin is a person who is still waiting. Escalation changes the
// shape and the size, not the colour: a bigger mark, a ring that keeps going out, and a word.
function RequestPin({ request }: { request: OpenRequest }) {
  const escalated = Boolean(request.escalation);
  const size = escalated ? 7.5 : 5.5;
  return (
    <GeoAnchor at={{ lat: request.lat!, lng: request.lng! }}>
      <circle r={size + 5} fill={HAZARD} fillOpacity={escalated ? 0.22 : 0.12} />
      {escalated && <circle r={16} fill="none" stroke={HAZARD} strokeWidth={2} className="animate-ring-out" />}
      {request.needsLift ? (
        <rect x={-size} y={-size} width={size * 2} height={size * 2} fill={HAZARD} stroke={PAPER} strokeWidth={2} />
      ) : (
        <circle r={size} fill={HAZARD} stroke={PAPER} strokeWidth={2} />
      )}
      {escalated && (
        <text x={13} y={-10} {...LABEL} fill={HAZARD}>
          {escalationShort(request.escalation!)}
        </text>
      )}
    </GeoAnchor>
  );
}

function escalationShort(escalation: string) {
  return { address_unconfirmed: "address?", medical: "medical", flames: "flames", unservable: "no vehicle" }[escalation] ?? escalation;
}

function VehicleMark({ vehicle }: { vehicle: Vehicle }) {
  return (
    <GeoAnchor at={{ lat: vehicle.lat, lng: vehicle.lng }}>
      <rect x={-10} y={-7} width={20} height={14} fill={PAPER} />
      <rect x={-9} y={-6} width={18} height={12} fill={INK} />
      <text x={14} y={4} {...LABEL}>
        {vehicle.label}
      </text>
    </GeoAnchor>
  );
}

// The route Track C's dispatcher computed: the real streets the van will drive. Dashed until a
// driver says yes, because an offer is not a commitment.
function VehicleRoute({ route, committed }: { route: Route; committed: boolean }) {
  return (
    <>
      <GeoLine route={route.remaining} stroke={PAPER} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
      <GeoLine
        route={route.remaining}
        stroke={INK}
        strokeWidth={committed ? 2 : 1.4}
        strokeDasharray={committed ? undefined : "5 4"}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={committed ? "" : "animate-dash-flow"}
      />
    </>
  );
}

// Before the dispatcher has routed anything, the map still has to show which van is going where.
function RunLeg({ assignment, vehicle, request }: { assignment: Assignment; vehicle: Vehicle; request: OpenRequest }) {
  const committed = assignment.status === "accepted";
  return (
    <>
      <GeoLeg start={{ lat: vehicle.lat, lng: vehicle.lng }} end={{ lat: request.lat!, lng: request.lng! }} stroke={PAPER} strokeWidth={4.5} />
      <GeoLeg
        start={{ lat: vehicle.lat, lng: vehicle.lng }}
        end={{ lat: request.lat!, lng: request.lng! }}
        stroke={INK}
        strokeWidth={committed ? 2 : 1.4}
        strokeDasharray={committed ? undefined : "5 4"}
        className={committed ? "" : "animate-dash-flow"}
      />
    </>
  );
}

function Closures() {
  const closures = useQuery(api.roads.closures);
  return (
    <>
      {closures?.map((closure) => (
        <g key={closure._id}>
          <GeoLine route={closure.path} stroke={PAPER} strokeWidth={7} strokeLinecap="round" />
          <GeoLine route={closure.path} stroke={HAZARD} strokeWidth={3.5} strokeLinecap="round" />
        </g>
      ))}
    </>
  );
}

function Zone() {
  const zone = useQuery(api.riders.currentZone);
  if (!zone) return null;
  return <GeoLine route={zone.polygon} close fill={INK} fillOpacity={0.07} stroke={INK} strokeWidth={1.6} strokeDasharray="9 5" />;
}

// What the dispatcher is drawing right now, before it is saved.
function Draft({ tool, draft }: { tool: string; draft: Point[] }) {
  if (draft.length === 0) return null;
  const color = tool === "closure" ? HAZARD : INK;
  return (
    <g>
      <MapLine
        route={tool === "zone" && draft.length > 2 ? [...draft, draft[0]] : draft}
        fill={tool === "zone" && draft.length > 2 ? color : "none"}
        fillOpacity={0.08}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="7 5"
      />
      {draft.map((point, index) => (
        <Anchor key={index} point={point}>
          <circle r={4} fill={color} stroke={PAPER} strokeWidth={2} />
        </Anchor>
      ))}
    </g>
  );
}

export function MapOverlays({ tool, draft }: { tool: string; draft: Point[] }) {
  const requests = useQuery(api.requests.open) ?? [];
  const assignments = useQuery(api.offers.active) ?? [];
  const vehicles = useQuery(api.vehicles.list) ?? [];
  const routes = useQuery(api.dispatch.routes) ?? [];
  const located = requests.filter(awaitingRide).filter((request) => request.lat !== undefined && request.lng !== undefined);
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle._id, vehicle]));
  const requestById = new Map(located.map((request) => [request._id, request]));
  const routeByVehicle = new Map(routes.filter((route) => route.remaining.length > 1).map((route) => [route.vehicleId, route]));
  const at = (request: OpenRequest): LatLng => ({ lat: request.lat!, lng: request.lng! });

  return (
    <g>
      <Zone />
      <Closures />
      {assignments.map((assignment) => {
        const vehicle = vehicleById.get(assignment.vehicleId);
        const request = requestById.get(assignment.requestId);
        if (!vehicle || !request) return null;
        const route = routeByVehicle.get(vehicle._id);
        const committed = assignment.status === "accepted";
        return route ? (
          <VehicleRoute key={assignment._id} route={route} committed={committed} />
        ) : (
          <RunLeg key={assignment._id} assignment={assignment} vehicle={vehicle} request={request} />
        );
      })}
      {vehicles.map((vehicle) => (
        <VehicleMark key={vehicle._id} vehicle={vehicle} />
      ))}
      {located.map((request) => (
        <RequestPin key={request._id} request={{ ...request, lat: at(request).lat, lng: at(request).lng }} />
      ))}
      <Draft tool={tool} draft={draft} />
    </g>
  );
}
