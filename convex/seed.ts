import { MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { AREA, callPriorityFor, EAST_WEST_STREETS, NORTH_SOUTH_STREETS } from "./model";
import { fireArrivalFor } from "./fireArrival";
import { DEFAULT_HAZARD } from "./hazards";

// Simulated west Altadena. Every household here is labeled simulated in the UI.
// Needs are sampled from per-block vulnerability rates, and the need-model prior sees
// only those block rates plus noise, never an individual's truth card.

const BLOCK_GRID = 4;

const FIRST_NAMES = [
  "Ruth", "Alma", "Gustavo", "Mei-Ling", "Harold", "Josefina", "Darnell", "Ana", "Lucille", "Tomás",
  "Wen", "Beatrice", "Raymond", "Esperanza", "Kwame", "Hyun-woo", "Gloria", "Leon", "Shirley", "Arturo",
  "Yolanda", "Clarence", "Rosario", "Ming", "Odessa", "Felipe", "Bernice", "Jian", "Mae", "Rogelio",
];

type Persona = Omit<Doc<"personas">, "_id" | "_creationTime" | "householdId">;
type Truth = Persona["truth"];

export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = ReturnType<typeof mulberry32>;

const pick = <T,>(random: Random, items: readonly T[]) => items[Math.floor(random() * items.length)];

function placeOnStreet(random: Random) {
  const eastWest = random() < 0.6;
  const along = random();
  const streetIndex = Math.floor(random() * (eastWest ? EAST_WEST_STREETS.length : NORTH_SOUTH_STREETS.length));
  const jitter = (random() - 0.5) * 0.0006;
  if (eastWest) {
    const lat = AREA.south + ((streetIndex + 0.5) / EAST_WEST_STREETS.length) * (AREA.north - AREA.south) + jitter;
    const lng = AREA.west + along * (AREA.east - AREA.west);
    return { lat, lng, street: EAST_WEST_STREETS[streetIndex] };
  }
  const lng = AREA.west + ((streetIndex + 0.5) / NORTH_SOUTH_STREETS.length) * (AREA.east - AREA.west) + jitter;
  const lat = AREA.south + along * (AREA.north - AREA.south);
  return { lat, lng, street: NORTH_SOUTH_STREETS[streetIndex] };
}

function blockOf(lat: number, lng: number) {
  const row = Math.min(BLOCK_GRID - 1, Math.floor(((lat - AREA.south) / (AREA.north - AREA.south)) * BLOCK_GRID));
  const col = Math.min(BLOCK_GRID - 1, Math.floor(((lng - AREA.west) / (AREA.east - AREA.west)) * BLOCK_GRID));
  return row * BLOCK_GRID + col;
}

function sampleMobility(random: Random, age: number, vulnerability: number): Truth["mobility"] {
  const roll = random() / (0.4 + vulnerability);
  if (age > 78 && roll < 0.08) return "bedbound";
  if (age > 70 && roll < 0.2) return "manual_wheelchair";
  if (age > 65 && roll < 0.28) return "power_wheelchair";
  if (age > 60 && roll < 0.55) return "walker";
  return "walks";
}

function sampleAssistance(random: Random, mobility: Truth["mobility"]): Truth["assistanceRequired"] {
  if (mobility === "bedbound") return "two_person_lift";
  if (mobility === "walks") return "none";
  return random() < 0.3 ? "one_person_assist" : "none";
}

function sampleTruth(random: Random, age: number, vulnerability: number): Truth {
  const mobility = sampleMobility(random, age, vulnerability);
  const limited = mobility !== "walks";
  const oxygen = age > 68 && random() < 0.12;
  const hasCar = random() > vulnerability * 0.9;
  const canLeave: Truth["canLeave"] = limited || oxygen ? (random() < 0.7 ? "no" : "unsure") : hasCar ? "yes" : "no";
  return {
    canLeave,
    peopleCount: age > 75 && random() < 0.6 ? 1 : 1 + Math.floor(random() * 4),
    mobility,
    assistanceRequired: sampleAssistance(random, mobility),
    medical: oxygen ? ["oxygen"] : random() < 0.04 ? ["dialysis"] : [],
    pets: random() < 0.4,
    hasCar,
  };
}

const sampleLanguage = (random: Random) => (random() < 0.7 ? "en" : "es");

// The hazard picked on the call floor decides which scenario's fronts set the fire arrival times.
async function currentHazard(ctx: MutationCtx) {
  return (await ctx.db.query("control").first())?.hazard ?? DEFAULT_HAZARD;
}

const HOUSEHOLD_COUNT = 200;

export type VehicleSeed = Omit<Doc<"vehicles">, "_id" | "_creationTime" | "lat" | "lng" | "shiftEndsAt">;

const van = (label: string, driverName: string, crewSize: number, driverIsSimulated = true): VehicleSeed => ({
  label,
  type: "paratransit",
  driverName,
  seats: 4,
  wheelchairSpaces: 2,
  stretcherSpaces: 0,
  crewSize,
  liftCapable: true,
  driverIsSimulated,
});

// Maria's and Luis's vans are driven from the driver page during the demo.
export const FLEET: VehicleSeed[] = [
  van("Van 12", "Maria", 2, false),
  van("Van 7", "Luis", 2, false),
  van("Van 3", "Dwayne", 1),
  van("Van 4", "Paulina", 1),
  van("Van 9", "Grace", 2),
  van("Van 15", "Ernesto", 1),
  { ...van("Bus 2", "Howard", 1), type: "bus", seats: 20, wheelchairSpaces: 1 },
  { ...van("Medic 41", "Rosa", 2), type: "ambulance", seats: 1, wheelchairSpaces: 0, stretcherSpaces: 1 },
];

export const SHELTERS = [{ name: "Pasadena Convention Center", lat: 34.1443, lng: -118.1446, capacity: 1200 }];

// Where each vehicle starts: two draws each, along the south edge of the area.
function fleetSpots(random: Random, count: number) {
  return Array.from({ length: count }, () => ({
    lat: AREA.south + 0.001 + random() * 0.004,
    lng: AREA.west + random() * (AREA.east - AREA.west),
  }));
}

export async function seedFleet(ctx: MutationCtx, random: Random, warningAt: number, fleet: VehicleSeed[] = FLEET) {
  for (const [i, spot] of fleetSpots(random, fleet.length).entries()) {
    await ctx.db.insert("vehicles", { ...fleet[i], ...spot, shiftEndsAt: warningAt + 8 * 60 * 60_000 });
  }
  for (const shelter of SHELTERS) await ctx.db.insert("shelters", shelter);
}

type AreaOptions = { withFleet: boolean; batch: number };

export type AreaHome = {
  lat: number;
  lng: number;
  address: string;
  language: string;
  needPrior: number;
  persona: Persona;
};

// The simulated households in the order seeding draws them. Each home's draws come in a fixed order
// (place, address, age, prior, language, then the persona), so a batch is the same town every time.
function sampleHomes(random: Random, blockVulnerability: number[]): AreaHome[] {
  const usedAddresses = new Set<string>();
  const homes: AreaHome[] = [];
  for (let i = 0; i < HOUSEHOLD_COUNT; i++) {
    const { lat, lng, street } = placeOnStreet(random);
    let address = `${100 + Math.floor(random() * 1900)} ${street}`;
    while (usedAddresses.has(address)) address = `${100 + Math.floor(random() * 1900)} ${street}`;
    usedAddresses.add(address);

    const vulnerability = blockVulnerability[blockOf(lat, lng)];
    const age = Math.round(28 + random() * 40 + vulnerability * 50);
    const needPrior = Math.min(0.95, Math.max(0.03, vulnerability + (random() - 0.5) * 0.12));
    const language = sampleLanguage(random);
    const persona: Persona = {
      name: pick(random, FIRST_NAMES),
      age,
      answersPhone: 0.55 + random() * 0.4 - (age > 80 ? 0.15 : 0),
      repliesToText: random() < 0.45,
      truth: sampleTruth(random, age, vulnerability),
    };
    homes.push({ lat, lng, address, language, needPrior, persona });
  }
  return homes;
}

function areaRandom(batch: number) {
  const random = mulberry32(13 + batch);
  const blockVulnerability = Array.from({ length: BLOCK_GRID * BLOCK_GRID }, () => 0.08 + random() * 0.5);
  return { random, blockVulnerability };
}

// The demo area's households and truth cards as the warning seeds them, without writing anything.
export function demoAreaHomes() {
  const { random, blockVulnerability } = areaRandom(0);
  fleetSpots(random, FLEET.length);
  return sampleHomes(random, blockVulnerability);
}

// Batch 0 is the demo area. Later batches (the dispatcher's checks) get other households and phone numbers.
export async function seedSimulatedArea(ctx: MutationCtx, warningAt: number, options: AreaOptions = { withFleet: true, batch: 0 }) {
  const { random, blockVulnerability } = areaRandom(options.batch);
  const hazard = await currentHazard(ctx);
  if (options.withFleet) await seedFleet(ctx, random, warningAt);

  for (const [i, home] of sampleHomes(random, blockVulnerability).entries()) {
    const { lat, lng, address, language, needPrior, persona } = home;
    const fireArrivalAt = fireArrivalFor({ lat, lng }, warningAt, hazard);
    const householdId = await ctx.db.insert("households", {
      address,
      lat,
      lng,
      callbackNumber: `+1626555${String(1000 + options.batch * HOUSEHOLD_COUNT + i).padStart(4, "0")}`,
      language,
      callStatus: "not_called",
      outcome: "unknown",
      inZone: true,
      attempts: 0,
      needPrior,
      needProbability: needPrior,
      fireArrivalAt,
      callPriority: callPriorityFor(needPrior, fireArrivalAt, warningAt),
      simulated: true,
    });
    await ctx.db.insert("personas", { householdId, ...persona });
  }
}

// Seeds the demo fleet and shelter on a deployment that has riders but no vehicles yet.
// A night of only real households gets only the vans teammates drive from the driver page:
// nobody who isn't a real person is sent to pick up a real one.
export async function seedFleetIfEmpty(ctx: MutationCtx, warningAt: number, driverPageOnly = false) {
  if (await ctx.db.query("vehicles").first()) return false;
  const fleet = driverPageOnly ? FLEET.filter((vehicle) => !vehicle.driverIsSimulated) : FLEET;
  await seedFleet(ctx, mulberry32(13), warningAt, fleet);
  return true;
}

// The Ready check seeds the town before any warning. When the warning comes, every simulated home's
// fire arrival and call priority are measured from it instead.
// The warning starts the fire clock for every home with a location, simulated or real. Placeholder
// arrival times from sign-up or the rider list would otherwise order neighbors by when they signed
// up, not by where they live. The times come from the scenario fronts the map draws.
export async function retimeArea(ctx: MutationCtx, warningAt: number) {
  const households = await ctx.db.query("households").take(1000);
  const hazard = await currentHazard(ctx);
  for (const household of households) {
    if (household.lat === undefined || household.lng === undefined) continue;
    const fireArrivalAt = fireArrivalFor({ lat: household.lat, lng: household.lng }, warningAt, hazard);
    await ctx.db.patch("households", household._id, {
      fireArrivalAt,
      callPriority: callPriorityFor(household.needProbability, fireArrivalAt, warningAt),
    });
  }
}
