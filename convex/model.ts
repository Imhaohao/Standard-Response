import type { Doc } from "./_generated/dataModel";

type Outcome = Doc<"households">["outcome"];
type RecordFields = Pick<
  Doc<"households">,
  "canLeave" | "mobility" | "medical" | "hasCar" | "callStatus"
>;

const ACCESSIBLE_MOBILITY = new Set(["manual_wheelchair", "power_wheelchair", "bedbound"]);

export function outcomeFor(record: RecordFields): Outcome {
  if (record.callStatus === "door_check") return "unreachable";
  if (record.mobility && ACCESSIBLE_MOBILITY.has(record.mobility)) return "needs_accessible";
  if (record.medical?.includes("oxygen")) return "needs_accessible";
  if (record.canLeave === "no" || record.canLeave === "unsure") return "needs_ride";
  if (record.canLeave === "yes" && record.hasCar === false) return "needs_ride";
  if (record.canLeave === "yes") return "leaving";
  return "unknown";
}

const MIN_SLACK_MINUTES = 5;

// Expected value of calling this home now: chance it needs help times how soon the fire arrives.
export function callPriorityFor(needProbability: number, fireArrivalAt: number, now: number) {
  const minutesLeft = Math.max((fireArrivalAt - now) / 60_000, MIN_SLACK_MINUTES);
  return (needProbability * 1000) / minutesLeft;
}

export type Point = { lat: number; lng: number };

export function metersBetween(a: Point, b: Point) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = metersPerDegLat * Math.cos((a.lat * Math.PI) / 180);
  const dy = (a.lat - b.lat) * metersPerDegLat;
  const dx = (a.lng - b.lng) * metersPerDegLng;
  return Math.hypot(dx, dy);
}

export function located<T extends { lat?: number; lng?: number }>(row: T): row is T & Point {
  return row.lat !== undefined && row.lng !== undefined;
}

export function insidePolygon(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.lat > p.lat !== b.lat > p.lat;
    if (crosses && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

// What a ride request needs from a vehicle. Compatibility is a hard constraint for every dispatcher.
export type RideNeed = {
  load: { seats: number; wheelchairSpaces: number; stretcherSpaces: number };
  crewNeeded: number;
  needsLift: boolean;
  boardingMinutes: number;
  weight: number;
};

type NeedFields = Pick<Doc<"households">, "outcome" | "peopleCount" | "mobility" | "assistanceRequired" | "medical">;

const WHEELCHAIRS = new Set(["manual_wheelchair", "power_wheelchair"]);

function boardingMinutesFor(record: NeedFields) {
  if (record.mobility === "bedbound" || record.assistanceRequired === "two_person_lift") return 20;
  if (record.mobility && WHEELCHAIRS.has(record.mobility)) return 10;
  if (record.mobility === "walker") return 5;
  return 2;
}

function loadFor(record: NeedFields): RideNeed["load"] {
  const wheelchairSpaces = record.mobility && WHEELCHAIRS.has(record.mobility) ? 1 : 0;
  const stretcherSpaces = record.mobility === "bedbound" ? 1 : 0;
  const people = Math.max(record.peopleCount ?? 1, 1);
  return { seats: Math.max(people - wheelchairSpaces - stretcherSpaces, 0), wheelchairSpaces, stretcherSpaces };
}

const weightFor = (record: NeedFields) =>
  (record.outcome === "needs_accessible" ? 3 : 1) + (record.medical?.includes("oxygen") ? 1 : 0);

export function rideNeedFor(record: NeedFields): RideNeed | null {
  if (record.outcome !== "needs_ride" && record.outcome !== "needs_accessible") return null;
  const load = loadFor(record);
  return {
    load,
    crewNeeded: record.assistanceRequired === "two_person_lift" ? 2 : 1,
    needsLift: load.wheelchairSpaces + load.stretcherSpaces > 0,
    boardingMinutes: boardingMinutesFor(record),
    weight: weightFor(record),
  };
}

type VehicleFit = Pick<
  Doc<"vehicles">,
  "seats" | "wheelchairSpaces" | "stretcherSpaces" | "crewSize" | "liftCapable"
>;
type NeedFit = Pick<RideNeed, "load" | "crewNeeded" | "needsLift">;

export function vehicleCanServe(vehicle: VehicleFit, need: NeedFit) {
  return (
    vehicle.seats >= need.load.seats &&
    vehicle.wheelchairSpaces >= need.load.wheelchairSpaces &&
    vehicle.stretcherSpaces >= need.load.stretcherSpaces &&
    vehicle.crewSize >= need.crewNeeded &&
    (vehicle.liftCapable || !need.needsLift)
  );
}

// A request's deadline: when the hazard reaches the home, less time to board and leave.
export const DEADLINE_MARGIN_MINUTES = 10;
export const deadlineFor = (fireArrivalAt: number) => fireArrivalAt - DEADLINE_MARGIN_MINUTES * 60_000;

// Simulated area and the stand-in fire model. Pure data, safe to import from the browser.
export const AREA = { south: 34.178, north: 34.2, west: -118.168, east: -118.14 };
export const FIRE_ORIGIN = { lat: 34.205, lng: -118.135 };
export const FIRE_FIRST_ARRIVAL_MINUTES = 45;
export const FIRE_SPREAD_METERS_PER_MINUTE = 25;
export const EAST_WEST_STREETS = ["Altadena Dr", "Mariposa St", "Calaveras St", "Ventura St", "Woodbury Rd", "Palm St", "Figueroa Dr"];
export const NORTH_SOUTH_STREETS = ["Olive Ave", "Glenrose Ave", "Highview Ave", "Lincoln Ave", "Fair Oaks Ave"];
