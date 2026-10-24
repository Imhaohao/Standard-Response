import { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { NeedMark } from "@/components/map/use-highlights";
import { Occupancy } from "@/lib/ink-map/renderer";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";

export type OpenRequest = FunctionReturnType<typeof api.requests.open>[number];

// How red a roof goes. A request nobody has answered is the loudest thing on the map, and a
// driver already on the way is nearly settled, so the town calms down as the plan works.
const LEVEL: Record<OpenRequest["status"], number> = {
  received: 0.55,
  approved: 0.7,
  driver_accepted: 0.78,
  en_route: 0.78,
  reassigning: 0.95,
  arrived: 0.3,
  closed: 0,
};

// Once a driver has them, they are not a person to be found any more. The vehicle marker carries them.
const SETTLED: OpenRequest["status"][] = ["arrived", "closed"];

export const awaitingRide = (request: OpenRequest) => !SETTLED.includes(request.status);

export function requestMarks(people: { at: Point; status: OpenRequest["status"]; escalation?: OpenRequest["escalation"] }[]): NeedMark[] {
  return people.map((person) => ({
    point: person.at,
    level: person.escalation ? 1 : LEVEL[person.status],
    pulse: Boolean(person.escalation),
  }));
}

export type Home = FunctionReturnType<typeof api.households.coverage>[number];

// A household that said it is leaving is out, and so is one that asked for a ride and no longer
// has an open request (the van has been). One nobody has heard from, or couldn't reach, is still
// home. An open ride request paints the roof red, which outranks both.
const ASKED_FOR_RIDE: Home["outcome"][] = ["needs_ride", "needs_accessible"];

export function homeOccupancy(home: Home, hasOpenRequest: boolean): Occupancy {
  if (home.outcome === "leaving") return "left";
  if (ASKED_FOR_RIDE.includes(home.outcome) && !hasOpenRequest) return "left";
  return "stillHome";
}

export function homeMarks(homes: Home[], withOpenRequest: Set<string>, toLocal: (point: LatLng) => Point): NeedMark[] {
  return homes.map((home) => ({ point: toLocal(home), level: 0, occupancy: homeOccupancy(home, withOpenRequest.has(home._id)) }));
}

// The order the dispatcher works through: escalations first, then whoever the fire reaches soonest.
export function byUrgency(a: OpenRequest, b: OpenRequest) {
  return Number(Boolean(b.escalation)) - Number(Boolean(a.escalation)) || a.deadlineAt - b.deadlineAt;
}
