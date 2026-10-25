import type { Compass, HazardEdge } from "../../convex/fireArrival";
import type { Hazard } from "../../convex/hazards";
import type { Situation } from "../../convex/voice";
import { FIRE_STATIONS } from "../../lib/ink-map/fire-crews";
import { SITUATION_LINES } from "./lines/situation";
import type { Language, RideStatus } from "./script";

// The 911 call-taker's screen for one call: what disaster this is, when the fire model has it
// reaching the home, where its edge is now, the fastest drive out, the ride and the fire crews.
// Claude reads it as facts it may rely on; the numbers, times and route are spoken only through the
// fixed lines below, since the honesty guard drops any digit or route in Claude's own words.

export type CallFacts = { situation: Situation; ride: RideStatus; edge: HazardEdge | null; now: number };

// Closer than this, the fire is at the street, not "0.1 miles" away.
const AT_STREET_METERS = 160;
const METERS_PER_MILE = 1609.344;

const HAZARD_NAMES: Record<Hazard, string> = {
  wildfire: "wildfire evacuation, west Altadena",
  earthquake: "earthquake, west Altadena",
  flood: "flood evacuation, west Altadena",
  hurricane: "hurricane evacuation, west Altadena",
};

const COMPASS_WORDS: Record<Compass, string> = {
  north: "north",
  northeast: "north-east",
  east: "east",
  southeast: "south-east",
  south: "south",
  southwest: "south-west",
  west: "west",
  northwest: "north-west",
};

export const minutesLeft = ({ situation, now }: CallFacts) =>
  situation.fireArrivalAt === null ? null : Math.round((situation.fireArrivalAt - now) / 60_000);

const milesOf = (meters: number) => (meters / METERS_PER_MILE).toFixed(1);

function arrivalFact(facts: CallFacts) {
  const left = minutesLeft(facts);
  if (!facts.situation.hazardReaches) return "The fire model doesn't have it reaching this home.";
  if (left === null) return "No arrival estimate for this home yet.";
  return left <= 0 ? "The fire model has it at this home now." : `The fire model has it reaching this home in about ${left} minutes.`;
}

function edgeFact({ edge }: CallFacts) {
  if (!edge) return "";
  if (edge.meters < AT_STREET_METERS || !edge.direction) return "Fire edge now: at this street.";
  return `Fire edge now: about ${milesOf(edge.meters)} miles to the ${COMPASS_WORDS[edge.direction]}.`;
}

function routeFact({ situation }: CallFacts) {
  const route = situation.route;
  if (!route) return "No drive out found around the closed roads.";
  const via = route.streets.length > 0 ? `${route.streets.join(", then ")} to ` : "";
  return `Fastest drive out around closed roads: ${via}${route.destination}, about ${route.minutes} minutes without traffic.`;
}

function rideFact({ ride }: CallFacts) {
  if (!ride) return "Ride: no request yet.";
  const driver = ride.driver;
  if (!driver) return `Ride: request ${ride.status}, no driver has accepted.`;
  const to = driver.shelterName ? `, taking them to ${driver.shelterName}` : "";
  return `Ride: ${ride.status}. ${driver.name} drives a ${driver.vehicleType.replace("_", " ")} with ${driver.crewSize} crew, about ${Math.round(driver.etaMinutes)} minutes away${to}.`;
}

// The rescue map's engines (lib/ink-map/fire-crews.ts) take homes off the door-check list in order.
const ENGINES = FIRE_STATIONS.altadena.map((station) => station.engine);

function crewFact({ situation }: CallFacts) {
  const list = situation.onCrewList ? "This home is on that list." : "This home is not on that list.";
  const fleet = situation.fireUnits > 0 ? ` Dispatch also has ${situation.fireUnits} fire units for rides.` : "";
  return `Fire crews: ${ENGINES.length} engines (${ENGINES.join(", ")}) work the door-check list; ${situation.homesWaitingForCrew} homes are waiting on it. ${list}${fleet}`;
}

// The screen as Claude sees it, in English whatever the call language.
export function briefText(facts: CallFacts) {
  const warning = facts.situation.warningIssuedAt === null ? "no warning issued yet" : "evacuation warning in effect";
  return [
    `Disaster: ${HAZARD_NAMES[facts.situation.hazard]}; ${warning}.`,
    arrivalFact(facts),
    edgeFact(facts),
    routeFact(facts),
    rideFact(facts),
    crewFact(facts),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

// Spoken when they ask where the fire is or how long they have. Wildfire only: the fronts are fire.
function whereLine({ edge }: CallFacts, language: Language) {
  if (!edge?.direction || edge.meters < AT_STREET_METERS) return "";
  const lines = SITUATION_LINES[language];
  return lines.fireNear(milesOf(edge.meters), lines.compass[edge.direction]);
}

const firesAtHome = ({ situation }: CallFacts) =>
  situation.hazard === "wildfire" && situation.warningIssuedAt !== null && situation.hazardReaches;

export function fireLine(facts: CallFacts, language: Language): string | null {
  if (!firesAtHome(facts)) return null;
  const lines = SITUATION_LINES[language];
  const left = minutesLeft(facts);
  if (left !== null && left <= 0) return lines.fireAtStreet;
  const when = left !== null ? lines.reachesIn(left) : "";
  return [whereLine(facts, language), when].filter((line) => line !== "").join(" ") || null;
}

// Spoken when they ask which way to go, and to someone leaving on their own.
export function routeLine({ situation }: CallFacts, language: Language): string | null {
  const route = situation.route;
  if (!route || route.streets.length === 0) return null;
  return SITUATION_LINES[language].routeOut(route.streets, route.destination, route.minutes);
}
