"use client";

import { useQuery } from "convex/react";
import { MouseEvent, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { MAP_HEIGHT, MAP_WIDTH, LatLng, pointsAttribute, project, unproject } from "@/lib/geo";
import { outcomeColor } from "@/lib/labels";
import { FireContours, Streets } from "../map/base-layers";

export type MapTool = "look" | "zone" | "closure";

const REQUEST_COLORS: Record<string, string> = {
  received: "var(--ride)",
  approved: "var(--ride)",
  driver_accepted: "var(--leaving)",
  en_route: "var(--leaving)",
  reassigning: "var(--signal)",
  arrived: "var(--unknown)",
};

function svgPoint(event: MouseEvent<SVGSVGElement>) {
  const svg = event.currentTarget;
  const matrix = svg.getScreenCTM()?.inverse();
  if (!matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
  return unproject(point.x, point.y);
}

function Households() {
  const homes = useQuery(api.households.coverage);
  return (
    <g>
      {homes?.map((home) => {
        const { x, y } = project(home);
        return <circle key={home._id} cx={x} cy={y} r={2} fill={outcomeColor(home.outcome)} opacity={0.6} />;
      })}
    </g>
  );
}

function Requests() {
  const requests = useQuery(api.requests.open);
  return (
    <g>
      {requests?.map((request) => {
        if (request.lat === undefined || request.lng === undefined) return null;
        const { x, y } = project({ lat: request.lat, lng: request.lng });
        const fill = REQUEST_COLORS[request.status] ?? "var(--ink)";
        const shape = request.needsLift ? (
          <rect x={x - 4.5} y={y - 4.5} width={9} height={9} fill={fill} stroke="var(--surface)" />
        ) : (
          <circle cx={x} cy={y} r={4.5} fill={fill} stroke="var(--surface)" />
        );
        return (
          <g key={request._id}>
            {request.escalation && <circle cx={x} cy={y} r={9} fill="none" stroke="var(--signal)" strokeWidth={2} />}
            {shape}
          </g>
        );
      })}
    </g>
  );
}

function Assignments() {
  const assignments = useQuery(api.offers.active);
  const vehicles = useQuery(api.vehicles.list);
  const byId = new Map(vehicles?.map((v) => [v._id, v]));
  return (
    <g>
      {assignments?.map((a) => {
        const vehicle = byId.get(a.vehicleId);
        if (!vehicle || a.lat === undefined || a.lng === undefined) return null;
        const from = project(vehicle);
        const to = project({ lat: a.lat, lng: a.lng });
        return (
          <line
            key={a._id}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="var(--ink)"
            strokeWidth={a.status === "accepted" ? 2 : 1}
            strokeDasharray={a.status === "accepted" ? undefined : "4 3"}
          />
        );
      })}
    </g>
  );
}

function Vehicles() {
  const vehicles = useQuery(api.vehicles.list);
  return (
    <g>
      {vehicles?.map((vehicle) => {
        const { x, y } = project(vehicle);
        return (
          <g key={vehicle._id}>
            <rect x={x - 5} y={y - 5} width={10} height={10} fill="var(--ink)" />
            <text x={x + 8} y={y + 4} className="fill-ink text-[10px] font-semibold">
              {vehicle.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ZoneAndClosures({ draft, tool }: { draft: LatLng[]; tool: MapTool }) {
  const zone = useQuery(api.riders.currentZone);
  const closures = useQuery(api.roads.closures);
  return (
    <g>
      {zone && <polygon points={pointsAttribute(zone.polygon)} fill="var(--ink)" fillOpacity={0.06} stroke="var(--ink)" strokeWidth={1.5} />}
      {closures?.map((closure) => (
        <polyline key={closure._id} points={pointsAttribute(closure.path)} fill="none" stroke="var(--signal)" strokeWidth={4} />
      ))}
      {draft.length > 0 && (
        <polyline
          points={pointsAttribute(tool === "zone" && draft.length > 2 ? [...draft, draft[0]] : draft)}
          fill="none"
          stroke={tool === "closure" ? "var(--signal)" : "var(--ink)"}
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      )}
      {draft.map((p, i) => {
        const { x, y } = project(p);
        return <circle key={i} cx={x} cy={y} r={3} fill="var(--ink)" />;
      })}
    </g>
  );
}

export function MapView({ tool, draft, onPick }: { tool: MapTool; draft: LatLng[]; onPick: (point: LatLng) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      className={`block h-auto w-full bg-surface-sunk ${tool === "look" ? "" : "cursor-crosshair"}`}
      role="img"
      aria-label="Rescue map of west Altadena: requests, vehicles, the warning zone and road closures"
      onClick={(event) => {
        if (tool === "look") return;
        const point = svgPoint(event);
        if (point) onPick(point);
      }}
    >
      <Streets />
      <FireContours />
      <Households />
      <ZoneAndClosures draft={draft} tool={tool} />
      <Assignments />
      <Requests />
      <Vehicles />
    </svg>
  );
}
