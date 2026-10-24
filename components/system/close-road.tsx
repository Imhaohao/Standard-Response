"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { RoadHorizon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { Button } from "../ui/button";
import { Panel, PanelEmpty } from "../ui/panel";

type Assignment = FunctionReturnType<typeof api.offers.active>[number];
type Route = FunctionReturnType<typeof api.dispatch.routes>[number];
type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];

const METRES_PER_DEGREE = 111_320;
const CUT_BEFORE_STOP = 70;
const CUT_HALF_WIDTH = 60;

function offset(from: LatLng, east: number, north: number): LatLng {
  return { lat: from.lat + north / METRES_PER_DEGREE, lng: from.lng + east / (METRES_PER_DEGREE * Math.cos((from.lat * Math.PI) / 180)) };
}

function metresBetween(a: LatLng, b: LatLng) {
  const east = (b.lng - a.lng) * METRES_PER_DEGREE * Math.cos((a.lat * Math.PI) / 180);
  const north = (b.lat - a.lat) * METRES_PER_DEGREE;
  return { east, north, length: Math.hypot(east, north) };
}

// With a routed van, close the last stretch of its real route before the door. Without one (the
// dispatch stand-in drives straight lines), cut across the approach a little short of the house;
// Track C closes every road a cut crosses.
function closurePath(van: Vehicle, stop: Assignment, route: Route | undefined): LatLng[] | null {
  if (stop.lat === undefined || stop.lng === undefined) return null;
  const door = { lat: stop.lat, lng: stop.lng };
  if (route && route.remaining.length >= 3) return route.remaining.slice(-3, -1);
  const { east, north, length } = metresBetween({ lat: van.lat, lng: van.lng }, door);
  if (length < 1) return null;
  const [ux, uy] = [east / length, north / length];
  const centre = offset(door, -ux * CUT_BEFORE_STOP, -uy * CUT_BEFORE_STOP);
  return [offset(centre, -uy * CUT_HALF_WIDTH, ux * CUT_HALF_WIDTH), offset(centre, uy * CUT_HALF_WIDTH, -ux * CUT_HALF_WIDTH)];
}

function VanRow({ van, stop, route }: { van: Vehicle; stop: Assignment; route: Route | undefined }) {
  const addClosures = useMutation(api.roads.addClosures);
  const [closed, setClosed] = useState(false);
  const path = closurePath(van, stop, route);
  return (
    <li className="flex items-center gap-3 px-4 pb-4">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-heading truncate">{stop.address}</span>
        <span className="type-small text-on-panel-muted">
          {van.driverName}, {van.label}, {stop.status === "accepted" ? "on the way" : "offered"}
        </span>
      </span>
      <Button
        variant={closed ? "onPanelQuiet" : "onPanel"}
        size="lg"
                disabled={!path || closed}
        onClick={() => path && void addClosures({ closures: [{ path, source: "manual" }] }).then(() => setClosed(true))}
      >
        <RoadHorizon weight="bold" className="size-4" />
        {closed ? "Closed" : "Close this road"}
      </Button>
    </li>
  );
}

// The demo beat: close the road between a driver-page van and its rider, on cue. The next re-plan
// routes around it or revokes the pickup.
export function CloseRoadPanel() {
  const vehicles = useQuery(api.vehicles.list) ?? [];
  const assignments = useQuery(api.offers.active) ?? [];
  const routes = useQuery(api.dispatch.routes) ?? [];
  const rows = vehicles
    .filter((van) => !van.driverIsSimulated)
    .flatMap((van) => {
      const stop = assignments
        .filter((assignment) => assignment.vehicleId === van._id && assignment.status !== "proposed")
        .sort((a, b) => a.stopOrder - b.stopOrder)[0];
      return stop ? [{ van, stop, route: routes.find((route) => route.vehicleId === van._id) }] : [];
    });
  return (
    <Panel title="Close this road">
      {rows.length === 0 ? (
        <PanelEmpty>No driver-page van has a pickup yet.</PanelEmpty>
      ) : (
        <ul>
          {rows.map(({ van, stop, route }) => (
            <VanRow key={stop._id} van={van} stop={stop} route={route} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
