"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Anchor, GeoAnchor, GeoLeg, GeoLine, MapLine } from "@/components/map/layers";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { Van, Wheelchair } from "@phosphor-icons/react";
import { awaitingRide, OpenRequest } from "./marks";

const PAPER = "var(--map-paper)";
const INK = "var(--map-ink)";
const HAZARD = "var(--signal)";

type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];
type Assignment = FunctionReturnType<typeof api.offers.active>[number];
type Route = FunctionReturnType<typeof api.dispatch.routes>[number];

const WAITING: OpenRequest["status"][] = ["received", "approved", "reassigning"];

// One badge per person, readable without reading: red means still waiting for a driver, ink means
// a driver said yes. The glyph says what they need: a wheelchair, or how many people.
function RequestPin({ request }: { request: OpenRequest }) {
  const waiting = WAITING.includes(request.status);
  const escalated = Boolean(request.escalation);
  const r = escalated ? 13 : 10.5;
  const fill = waiting || escalated ? HAZARD : INK;
  const people = request.load.seats + request.load.wheelchairSpaces + request.load.stretcherSpaces;
  return (
    <GeoAnchor at={{ lat: request.lat!, lng: request.lng! }}>
      {(waiting || escalated) && <circle r={r} fill="none" stroke={HAZARD} strokeWidth={2} className="animate-ring-out" />}
      <circle r={r + 2.5} fill={PAPER} />
      <circle r={r} fill={fill} strokeDasharray={request.status === "reassigning" ? "4 3" : undefined} stroke={request.status === "reassigning" ? PAPER : "none"} strokeWidth={1.5} />
      {request.needsLift ? (
        <Wheelchair x={-r * 0.62} y={-r * 0.66} size={r * 1.28} weight="bold" color="white" />
      ) : (
        <text y={4} textAnchor="middle" fontSize={r * 1.05} fontWeight={800} fill="white">
          {people}
        </text>
      )}
      {escalated && <EscalationChip escalation={request.escalation!} r={r} />}
    </GeoAnchor>
  );
}

function EscalationChip({ escalation, r }: { escalation: string; r: number }) {
  const label = escalationShort(escalation);
  const width = label.length * 6.4 + 14;
  return (
    <g transform={`translate(${r + 5} ${-r - 4})`}>
      <rect width={width} height={18} rx={9} fill={HAZARD} stroke={PAPER} strokeWidth={2} />
      <text x={width / 2} y={12.5} textAnchor="middle" fontSize={11} fontWeight={700} fill="white">
        {label}
      </text>
    </g>
  );
}

function escalationShort(escalation: string) {
  return { address_unconfirmed: "Address?", medical: "Medical", flames: "Sees flames", unservable: "No vehicle", language_barrier: "Language" }[escalation] ?? escalation;
}

// A van is a dark chip with its name inside, so the label never floats away from the vehicle.
// A van with nobody to fetch is drawn hollow.
function VehicleMark({ vehicle, busy }: { vehicle: Vehicle; busy: boolean }) {
  const width = vehicle.label.length * 6.6 + 26;
  return (
    <GeoAnchor at={{ lat: vehicle.lat, lng: vehicle.lng }}>
      <g transform={`translate(${-width / 2} -10)`}>
        <rect width={width} height={20} rx={5} fill={busy ? INK : PAPER} stroke={busy ? PAPER : INK} strokeWidth={busy ? 2 : 1.5} />
        <Van x={5} y={3} size={14} weight="fill" color={busy ? "white" : INK} />
        <text x={22} y={14} fontSize={11} fontWeight={700} fill={busy ? "white" : INK}>
          {vehicle.label}
        </text>
      </g>
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
  const busyVehicles = new Set(assignments.map((assignment) => assignment.vehicleId));

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
        <VehicleMark key={vehicle._id} vehicle={vehicle} busy={busyVehicles.has(vehicle._id)} />
      ))}
      {located.map((request) => (
        <RequestPin key={request._id} request={{ ...request, lat: at(request).lat, lng: at(request).lng }} />
      ))}
      <Draft tool={tool} draft={draft} />
    </g>
  );
}
