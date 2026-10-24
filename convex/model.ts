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

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const metersPerDegLat = 111_320;
  const metersPerDegLng = metersPerDegLat * Math.cos((a.lat * Math.PI) / 180);
  const dy = (a.lat - b.lat) * metersPerDegLat;
  const dx = (a.lng - b.lng) * metersPerDegLng;
  return Math.hypot(dx, dy);
}

// Simulated area and the stand-in fire model. Pure data, safe to import from the browser.
export const AREA = { south: 34.178, north: 34.2, west: -118.168, east: -118.14 };
export const FIRE_ORIGIN = { lat: 34.205, lng: -118.135 };
export const FIRE_FIRST_ARRIVAL_MINUTES = 45;
export const FIRE_SPREAD_METERS_PER_MINUTE = 25;
export const EAST_WEST_STREETS = ["Altadena Dr", "Mariposa St", "Calaveras St", "Ventura St", "Woodbury Rd", "Palm St", "Figueroa Dr"];
export const NORTH_SOUTH_STREETS = ["Olive Ave", "Glenrose Ave", "Highview Ave", "Lincoln Ave", "Fair Oaks Ave"];
