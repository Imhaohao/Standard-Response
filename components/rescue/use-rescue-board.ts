"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { LatLng } from "@/lib/geo";
import { InkMapData, Point } from "@/lib/ink-map/data";
import { runRoute } from "@/lib/ink-map/road-route";
import { OpenRequest, awaitingRide } from "./marks";

export type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];
export type Assignment = FunctionReturnType<typeof api.offers.active>[number];
type DispatchRoute = FunctionReturnType<typeof api.dispatch.routes>[number];
type Closure = FunctionReturnType<typeof api.roads.closures>[number];

// What a van is doing, in the order a dispatcher cares: one that changed course or sits still is
// worth a look; one driving its run is not.
export type VanState = "rerouting" | "stalled" | "idle" | "boarding" | "waitingForDriver" | "driving";

export type Person = OpenRequest & { at: Point; assignment?: Assignment; vehicle?: Vehicle };

export type Van = {
  vehicle: Vehicle;
  at: Point;
  state: VanState;
  stops: Person[];
  route: Point[] | null;
  committed: boolean;
};

const REROUTE_SHOWN_MS = 20_000;
const STILL_AFTER_MS = 30_000;
const STILL_METERS = 8;
const AT_DOOR_METERS = 30;

// The dispatcher flags a household "unservable" when no vehicle can reach it, and the flag stays
// after a later plan does find one. A person with a van on the way is not unservable.
function liveEscalation(request: OpenRequest, assigned: boolean) {
  return request.escalation === "unservable" && assigned ? undefined : request.escalation;
}

// A caller whose address we couldn't confirm has no pin, but they still asked for a ride.
const located = (request: OpenRequest) => request.lat !== undefined && request.lng !== undefined;

function people(requests: OpenRequest[], assignments: Assignment[], vehicles: Map<Id<"vehicles">, Vehicle>, toLocal: (p: LatLng) => Point): Person[] {
  const byRequest = new Map(assignments.map((assignment) => [assignment.requestId, assignment]));
  return requests
    .filter(awaitingRide)
    .filter(located)
    .map((request) => {
      const assignment = byRequest.get(request._id);
      return {
        ...request,
        escalation: liveEscalation(request, Boolean(assignment)),
        at: toLocal({ lat: request.lat!, lng: request.lng! }),
        assignment,
        vehicle: assignment ? vehicles.get(assignment.vehicleId) : undefined,
      };
    });
}

// Remembers, per van, where it last moved and which stop it was heading for, so the map can say
// "sitting still" and "changed course" without the backend having to.
type Memory = { at: Point; movedAt: number; firstStop?: string; reroutedAt: number };

const MEMORY_TICK_MS = 2_500;

function remember(previous: Map<string, Memory>, vehicles: Vehicle[], firstStops: Map<string, string | undefined>, toLocal: (p: LatLng) => Point, time: number) {
  const next = new Map<string, Memory>();
  for (const vehicle of vehicles) {
    const at = toLocal({ lat: vehicle.lat, lng: vehicle.lng });
    const firstStop = firstStops.get(vehicle._id);
    const held = previous.get(vehicle._id);
    if (!held) {
      next.set(vehicle._id, { at, movedAt: time, firstStop, reroutedAt: 0 });
      continue;
    }
    const moved = Math.hypot(at[0] - held.at[0], at[1] - held.at[1]) > STILL_METERS;
    const changedCourse = Boolean(held.firstStop && firstStop && held.firstStop !== firstStop);
    next.set(vehicle._id, {
      at: moved ? at : held.at,
      movedAt: moved ? time : held.movedAt,
      firstStop,
      reroutedAt: changedCourse ? time : held.reroutedAt,
    });
  }
  return next;
}

function useVanMemory(vehicles: Vehicle[], firstStops: Map<string, string | undefined>, toLocal: (p: LatLng) => Point) {
  const latest = useRef({ vehicles, firstStops, toLocal });
  const [memory, setMemory] = useState(() => ({ vans: new Map<string, Memory>(), now: 0 }));
  useEffect(() => {
    latest.current = { vehicles, firstStops, toLocal };
  }, [vehicles, firstStops, toLocal]);
  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      const { vehicles: current, firstStops: stops, toLocal: project } = latest.current;
      setMemory((previous) => ({ vans: remember(previous.vans, current, stops, project, time), now: time }));
    };
    const id = setInterval(tick, MEMORY_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return { memory: memory.vans, now: memory.now };
}

function vanState(van: Omit<Van, "state">, memory: Memory | undefined, now: number, boarding: boolean): VanState {
  if (memory && now - memory.reroutedAt < REROUTE_SHOWN_MS) return "rerouting";
  const next = van.stops[0];
  if (!next) return "idle";
  if (boarding || Math.hypot(next.at[0] - van.at[0], next.at[1] - van.at[1]) < AT_DOOR_METERS) return "boarding";
  if (!van.committed) return "waitingForDriver";
  if (memory && now - memory.movedAt > STILL_AFTER_MS) return "stalled";
  return "driving";
}

const stopOrder = (a: Person, b: Person) =>
  Number(b.assignment?.status === "accepted") - Number(a.assignment?.status === "accepted") || (a.assignment?.stopOrder ?? 0) - (b.assignment?.stopOrder ?? 0);

function closedEdges(closures: Closure[]) {
  const keys = new Set<string>();
  for (const closure of closures) {
    if (closure.edgeKey) keys.add(closure.edgeKey);
    for (const key of closure.edgeKeys ?? []) keys.add(key);
  }
  return keys;
}

export function useRescueBoard(data: InkMapData | null, toLocal: (p: LatLng) => Point) {
  const requests = useQuery(api.requests.open);
  const assignments = useQuery(api.offers.active);
  const vehicles = useQuery(api.vehicles.list);
  const routes = useQuery(api.dispatch.routes);
  const closures = useQuery(api.roads.closures);

  const persons = useMemo(() => {
    const byId = new Map((vehicles ?? []).map((vehicle) => [vehicle._id, vehicle]));
    return people(requests ?? [], assignments ?? [], byId, toLocal);
  }, [requests, assignments, vehicles, toLocal]);

  const stopsByVan = useMemo(() => {
    const stops = new Map<string, Person[]>();
    for (const person of persons) {
      if (!person.assignment) continue;
      const list = stops.get(person.assignment.vehicleId) ?? [];
      list.push(person);
      stops.set(person.assignment.vehicleId, list);
    }
    for (const list of stops.values()) list.sort(stopOrder);
    return stops;
  }, [persons]);

  const firstStops = useMemo(() => new Map([...stopsByVan].map(([id, list]) => [id, list[0]?._id as string | undefined])), [stopsByVan]);
  const { memory, now } = useVanMemory(vehicles ?? [], firstStops, toLocal);
  const closed = useMemo(() => closedEdges(closures ?? []), [closures]);

  const vans = useMemo<Van[]>(() => {
    const dispatched = new Map((routes ?? []).map((route: DispatchRoute) => [route.vehicleId, route]));
    return (vehicles ?? []).map((vehicle) => {
      const at = toLocal({ lat: vehicle.lat, lng: vehicle.lng });
      const stops = stopsByVan.get(vehicle._id) ?? [];
      const fromDispatcher = dispatched.get(vehicle._id);
      const route = fromDispatcher && fromDispatcher.remaining.length > 1
        ? fromDispatcher.remaining.map(toLocal)
        : data && stops.length > 0 ? runRoute(data, at, stops.map((stop) => stop.at), closed) : null;
      const van = { vehicle, at, stops, route, committed: stops[0]?.assignment?.status === "accepted" };
      return { ...van, state: vanState(van, memory.get(vehicle._id), now, fromDispatcher?.boarding ?? false) };
    });
  }, [vehicles, routes, stopsByVan, data, closed, toLocal, memory, now]);

  const unplaced = useMemo(() => (requests ?? []).filter(awaitingRide).filter((request) => !located(request)), [requests]);

  return { people: persons, unplaced, vans, loaded: requests !== undefined && vehicles !== undefined };
}

export type RescueBoard = ReturnType<typeof useRescueBoard>;
