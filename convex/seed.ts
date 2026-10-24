import { MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import {
  AREA,
  callPriorityFor,
  EAST_WEST_STREETS,
  FIRE_FIRST_ARRIVAL_MINUTES,
  FIRE_ORIGIN,
  FIRE_SPREAD_METERS_PER_MINUTE,
  metersBetween,
  NORTH_SOUTH_STREETS,
} from "./model";

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

function mulberry32(seed: number) {
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
    medical: oxygen ? ["oxygen"] : random() < 0.04 ? ["dialysis"] : [],
    pets: random() < 0.4,
    hasCar,
  };
}

function sampleLanguage(random: Random) {
  const roll = random();
  if (roll < 0.64) return "en";
  if (roll < 0.9) return "es";
  return "zh";
}

function fireArrivalFor(point: { lat: number; lng: number }, warningAt: number) {
  const minutes = FIRE_FIRST_ARRIVAL_MINUTES + metersBetween(point, FIRE_ORIGIN) / FIRE_SPREAD_METERS_PER_MINUTE;
  return warningAt + minutes * 60_000;
}

const HOUSEHOLD_COUNT = 200;

export async function seedSimulatedArea(ctx: MutationCtx, warningAt: number) {
  const random = mulberry32(13);
  const blockVulnerability = Array.from({ length: BLOCK_GRID * BLOCK_GRID }, () => 0.08 + random() * 0.5);
  const usedAddresses = new Set<string>();

  for (let i = 0; i < HOUSEHOLD_COUNT; i++) {
    const { lat, lng, street } = placeOnStreet(random);
    let address = `${100 + Math.floor(random() * 1900)} ${street}`;
    while (usedAddresses.has(address)) address = `${100 + Math.floor(random() * 1900)} ${street}`;
    usedAddresses.add(address);

    const vulnerability = blockVulnerability[blockOf(lat, lng)];
    const age = Math.round(28 + random() * 40 + vulnerability * 50);
    const needPrior = Math.min(0.95, Math.max(0.03, vulnerability + (random() - 0.5) * 0.12));
    const fireArrivalAt = fireArrivalFor({ lat, lng }, warningAt);

    const householdId = await ctx.db.insert("households", {
      address,
      lat,
      lng,
      callbackNumber: `+1626555${String(1000 + i).padStart(4, "0")}`,
      language: sampleLanguage(random),
      callStatus: "not_called",
      outcome: "unknown",
      attempts: 0,
      needPrior,
      needProbability: needPrior,
      fireArrivalAt,
      callPriority: callPriorityFor(needPrior, fireArrivalAt, warningAt),
      simulated: true,
    });
    await ctx.db.insert("personas", {
      householdId,
      name: pick(random, FIRST_NAMES),
      age,
      answersPhone: 0.55 + random() * 0.4 - (age > 80 ? 0.15 : 0),
      repliesToText: random() < 0.45,
      truth: sampleTruth(random, age, vulnerability),
    });
  }
}
