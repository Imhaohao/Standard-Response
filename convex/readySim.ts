import { MutationCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { metersBetween, Point } from "./model";
import { Helper, ReadyProfile, RecordFields } from "./readyProfile";
import { needsLineFor } from "./scripts";

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

// The stand-in's side of a Ready check call, so it shows on the call floor as it happens. Each of the
// resident's answers carries the record fields it fills; the full profile is saved when the call ends.

type Stage = Doc<"calls">["stage"];
type Floor = NonNullable<ReadyProfile["bedroom"]>["floor"];

export type ReadyStep = { speaker: "agent" | "resident"; stage: Stage; text: string; fields?: RecordFields };

type ReadyPhrases = {
  greet: (address: string) => string;
  confirm: (name: string) => string;
  askHousehold: string;
  household: (people: number, pets: boolean) => string;
  askNeeds: string;
  askPlan: string;
  plan: (exitPlan: ReadyProfile["exitPlan"], helper: Helper | undefined) => string;
  askBedroom: string;
  bedroom: (bedroom: ReadyProfile["bedroom"]) => string;
  askNote: string;
  noNote: string;
  close: (name: string) => string;
};

const FLOORS_EN: Record<Floor, string> = { ground: "the ground floor", upstairs: "upstairs", basement: "the basement" };
const FLOORS_ES: Record<Floor, string> = { ground: "la planta baja", upstairs: "el piso de arriba", basement: "el sótano" };

const READY_PHRASES: Record<"en" | "es", ReadyPhrases> = {
  en: {
    greet: (address) =>
      `Hello, this is the Altadena Ready check. There's no emergency. We're calling every home ahead of time so we know who might need help getting out. Is this ${address}?`,
    confirm: (name) => `Yes, this is ${name}.`,
    askHousehold: "How many people live there, and are there any pets?",
    household: (people, pets) => `${people === 1 ? "Just me" : `${people} of us`}${pets ? ", and a dog." : ", no pets."}`,
    askNeeds: "Does anyone use a walker or wheelchair, or need oxygen or other medical equipment?",
    askPlan: "If you had to leave in a hurry, how would you get out?",
    plan: (exitPlan, helper) =>
      exitPlan === "own_car" ? "We'd drive ourselves." : helper ? `${helper.name} would come and get me.` : "I'd need a ride. I don't drive.",
    askBedroom: "Where do you sleep, in case a crew has to come in for you?",
    bedroom: (bedroom) => (bedroom ? `On ${FLOORS_EN[bedroom.floor]}${bedroom.side ? `, at the ${bedroom.side} of the house` : ""}.` : "I'd rather not say."),
    askNote: "Anything else a rescue crew should know?",
    noNote: "No, that's everything.",
    close: (name) => `Thank you, ${name}. You're on file. If a warning comes, we'll call you first.`,
  },
  es: {
    greet: (address) =>
      `Hola, le llamamos del chequeo de preparación de Altadena. No es una emergencia. Llamamos a cada casa con tiempo para saber quién podría necesitar ayuda para salir. ¿Es ${address}?`,
    confirm: (name) => `Sí, habla ${name}.`,
    askHousehold: "¿Cuántas personas viven ahí, y tienen mascotas?",
    household: (people, pets) => `${people === 1 ? "Solo yo" : `Somos ${people}`}${pets ? ", y un perro." : ", sin mascotas."}`,
    askNeeds: "¿Alguien usa andadera o silla de ruedas, o necesita oxígeno u otro equipo médico?",
    askPlan: "Si tuviera que salir de prisa, ¿cómo saldría?",
    plan: (exitPlan, helper) =>
      exitPlan === "own_car" ? "Saldríamos en nuestro carro." : helper ? `${helper.name} vendría a recogerme.` : "Necesitaría que me lleven. No manejo.",
    askBedroom: "¿Dónde duerme, por si un equipo tiene que entrar por usted?",
    bedroom: (bedroom) =>
      bedroom ? `En ${FLOORS_ES[bedroom.floor]}${bedroom.side ? (bedroom.side === "front" ? ", al frente de la casa" : ", atrás de la casa") : ""}.` : "Prefiero no decir.",
    askNote: "¿Algo más que deba saber un equipo de rescate?",
    noNote: "No, es todo.",
    close: (name) => `Gracias, ${name}. Ya está registrado. Si hay una advertencia, le llamaremos primero.`,
  },
};

export function readyScript(
  household: Household,
  persona: Persona,
  profile: { record: RecordFields; ready: ReadyProfile },
  helper: Helper | undefined,
): ReadyStep[] {
  const p = READY_PHRASES[household.language as "en" | "es"] ?? READY_PHRASES.en;
  const { record, ready } = profile;
  const name = record.residentName ?? persona.name;
  return [
    { speaker: "agent", stage: "greet", text: p.greet(household.address) },
    { speaker: "resident", stage: "confirm_address", text: p.confirm(name), fields: { residentName: record.residentName } },
    { speaker: "agent", stage: "household", text: p.askHousehold },
    {
      speaker: "resident",
      stage: "household",
      text: p.household(persona.truth.peopleCount, persona.truth.pets),
      fields: { peopleCount: record.peopleCount, pets: record.pets },
    },
    { speaker: "agent", stage: "needs", text: p.askNeeds },
    {
      speaker: "resident",
      stage: "needs",
      text: needsLineFor(household.language, persona.truth),
      fields: { mobility: record.mobility, assistanceRequired: record.assistanceRequired, medical: record.medical },
    },
    { speaker: "agent", stage: "can_leave", text: p.askPlan },
    { speaker: "resident", stage: "can_leave", text: p.plan(ready.exitPlan, helper), fields: { hasCar: record.hasCar } },
    { speaker: "agent", stage: "readback", text: p.askBedroom },
    { speaker: "resident", stage: "readback", text: p.bedroom(ready.bedroom) },
    { speaker: "agent", stage: "readback", text: p.askNote },
    { speaker: "resident", stage: "readback", text: ready.note ? `${ready.note}.` : p.noNote },
    { speaker: "agent", stage: "close", text: p.close(name) },
  ];
}
