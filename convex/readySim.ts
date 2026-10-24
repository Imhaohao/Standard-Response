import { MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { metersBetween, Point } from "./model";
import { Helper, ReadyProfile, RecordFields } from "./readyProfile";

// Stand-in for the Ready check calls on simulated households, under the voice switch. It answers
// from each persona card the way a resident would on the phone, plus the things a card doesn't
// hold (where they sleep, care needs, a helper), drawn at made-up demo rates.

type Household = Doc<"households">;
type Located = Household & Point;
type Persona = Doc<"personas">;
type Random = () => number;
type CareNeed = ReadyProfile["care"][number];

const HELPER_SHARE = 0.55;
const NEIGHBOR_HELPER_SHARE = 0.6;
const NEIGHBOR_RADIUS_METERS = 450;
const NOTE_SHARE = 0.3;

const NOTES = [
  "Key under the planter by the back door",
  "Gate code 4471",
  "Two dogs, both friendly",
  "Knock loudly, she doesn't hear the bell",
  "Ramp is at the side gate, not the front steps",
  "Oxygen tanks in the hall closet",
];

const FAMILY = [
  { name: "Denise", relation: "daughter" },
  { name: "Marcus", relation: "son" },
  { name: "Lupe", relation: "niece" },
  { name: "Pastor Reggie", relation: "church" },
  { name: "Kenji", relation: "son-in-law" },
  { name: "Carol", relation: "sister" },
];

const pick = <T,>(random: Random, items: readonly T[]) => items[Math.floor(random() * items.length)];

function exitPlanFor(truth: Persona["truth"], random: Random): ReadyProfile["exitPlan"] {
  if (truth.mobility === "walks" && truth.hasCar && truth.canLeave === "yes") return "own_car";
  return random() < HELPER_SHARE ? "helper" : "needs_ride";
}

// People who can't manage stairs sleep on the ground floor.
function bedroomFor(truth: Persona["truth"], random: Random): ReadyProfile["bedroom"] {
  const stairsOk = truth.mobility === "walks" || truth.mobility === "walker";
  const floor = stairsOk && random() < 0.35 ? "upstairs" : random() < 0.05 ? "basement" : "ground";
  return { floor, side: random() < 0.5 ? "front" : "back" };
}

function careFor(persona: Persona, random: Random): CareNeed[] {
  const odds: [CareNeed, number][] = [
    ["hearing", persona.age > 75 ? 0.3 : 0.05],
    ["sight", persona.age > 70 ? 0.12 : 0.03],
    ["memory", persona.age > 78 ? 0.2 : 0.02],
    ["power_device", persona.truth.medical.includes("oxygen") ? 0.8 : 0.04],
    ["service_animal", 0.04],
  ];
  return odds.filter(([, chance]) => random() < chance).map(([need]) => need);
}

export function profileFromPersona(persona: Persona, random: Random, now: number): { record: RecordFields; ready: ReadyProfile } {
  const { truth } = persona;
  const ready: ReadyProfile = {
    at: now,
    via: "call",
    verified: true,
    exitPlan: exitPlanFor(truth, random),
    bedroom: bedroomFor(truth, random),
    care: careFor(persona, random),
    note: random() < NOTE_SHARE ? pick(random, NOTES) : undefined,
  };
  const record: RecordFields = {
    residentName: persona.name,
    peopleCount: truth.peopleCount,
    mobility: truth.mobility,
    assistanceRequired: truth.assistanceRequired,
    medical: truth.medical,
    pets: truth.pets,
    hasCar: truth.hasCar,
  };
  return { record, ready };
}

async function neighborHelper(ctx: MutationCtx, household: Located, nearby: Located[], random: Random): Promise<Helper | null> {
  const candidates = nearby.filter((other) => other._id !== household._id && metersBetween(household, other) < NEIGHBOR_RADIUS_METERS);
  if (candidates.length === 0) return null;
  const neighbor = pick(random, candidates);
  const persona = await ctx.db
    .query("personas")
    .withIndex("by_householdId", (q) => q.eq("householdId", neighbor._id))
    .unique();
  return { name: persona?.name ?? "A neighbor", phone: neighbor.callbackNumber, relation: "neighbor" };
}

// A neighbor down the street, or family from out of the area with a phone number we can call.
export async function helperFor(ctx: MutationCtx, household: Located, nearby: Located[], random: Random): Promise<Helper> {
  const neighbor = random() < NEIGHBOR_HELPER_SHARE ? await neighborHelper(ctx, household, nearby, random) : null;
  if (neighbor) return neighbor;
  const family = pick(random, FAMILY);
  return { ...family, phone: household.callbackNumber.replace(/^\+1626555/, "+1626556") };
}
