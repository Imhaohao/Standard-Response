import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hazard } from "../../convex/hazards";
import type { Language } from "../../convex/languages";

// What each scripted call is built from. The facts (who is home, what they need, what goes wrong) are
// drawn here, reproducibly from the script number; the caller's voice comes from a real 911 call in
// spikecodes/911-call-transcripts (518 calls, MIT license), whose facts are never reused.

export const REAL_CALLS_URL = "https://huggingface.co/datasets/spikecodes/911-call-transcripts/resolve/main/calls.jsonl";
const REAL_CALLS_CACHE = ".cache/911-call-transcripts.jsonl";
const EXCERPT_LINES = 6;

export type Seed = {
  id: string;
  hazard: Hazard;
  language: Language;
  inbound: boolean;
  address: string;
  caller: string;
  mood: string;
  household: string;
  twists: string[];
  seedCall: number;
  callerExcerpt: string[];
};

const HAZARDS: [Hazard, number][] = [["wildfire", 0.55], ["flood", 0.15], ["earthquake", 0.15], ["hurricane", 0.15]];
const LANGUAGES: [Language, number][] = [["en", 0.7], ["es", 0.3]];

const STREETS = [
  "West Mariposa Street", "North Lincoln Avenue", "West Altadena Drive", "North Marengo Avenue", "Lake Avenue",
  "East Woodbury Road", "Calaveras Street", "Loma Alta Drive", "Mendocino Street", "North Allen Avenue",
  "Catherine Road", "Ewing Street", "Terrace Street", "La Canada Verdugo Road", "Fair Oaks Avenue", "Palm Street",
];

const CALLERS = [
  "an older adult living alone", "an adult child calling about a parent at home", "a caregiver for a bedbound spouse",
  "a parent whose child uses a power wheelchair", "a person on home oxygen", "a dialysis patient",
  "a hard-of-hearing caller who mishears questions", "a caller whose first language is not the call language",
  "a teenager home alone with a grandparent", "a neighbor who walked over to help", "a group home staff member",
  "a tenant on the third floor of an apartment building", "a person with a walker and a large dog",
  "a couple, one of them recovering from hip surgery", "a person who lives in an RV", "a person just home from the hospital",
];

const MOODS = [
  "calm and matter-of-fact", "frightened and talking fast", "panicking and cutting in", "angry at the county",
  "confused and slow", "stoic and terse", "chatty and wandering off topic", "sarcastic", "crying and hard to follow",
];

const TWISTS = [
  "corrects an earlier answer partway through the call",
  "demands to know exactly when help will arrive",
  "asks whether this is a robot or a real person",
  "refuses to leave without their pet",
  "refuses to leave without a family member who isn't home",
  "the hazard reaches the home during the call",
  "someone in the home has a medical emergency during the call",
  "mentions a neighbor who may need help, and gives the address",
  "asks the agent to hold on while they check with someone",
  "asks what to bring or do while waiting",
  "talks to someone else in the room mid-call",
  "background noise (a TV, a dog, an alarm) is transcribed as words",
  "says the house number one digit at a time",
  "gives only the street at first, with no house number",
  "is away from the home, calling about someone who is there",
  "asks why the agent needs to know something",
  "can't hear well and asks the agent to repeat",
  "says goodbye early, then adds a late correction",
  "says they're already leaving by car",
  "asks to switch language",
  "packs two answers into one long run-on sentence",
  "isn't sure whether they can leave",
  "says it's just them, then remembers someone else is home",
  "speech-to-text garbles a word or two",
];

const MOBILITY = ["walks", "walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"];
const MEDICAL = ["none", "none", "none", "oxygen", "dialysis", "other"];
const ASSISTANCE = ["none", "one_person_assist", "two_person_lift"];

// mulberry32: the same script number always draws the same call.
function randomFrom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;
const pick = <T>(random: Random, items: readonly T[]) => items[Math.floor(random() * items.length)];

function weighted<T>(random: Random, choices: [T, number][]): T {
  let roll = random();
  for (const [value, weight] of choices) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return choices[choices.length - 1][0];
}

function distinct<T>(random: Random, items: readonly T[], count: number): T[] {
  const chosen = new Set<T>();
  while (chosen.size < count) chosen.add(pick(random, items));
  return [...chosen];
}

function householdFrom(random: Random) {
  const people = 1 + Math.floor(random() * 4);
  const mobility = pick(random, MOBILITY);
  const limited = mobility !== "walks";
  const facts = [
    `${people} ${people === 1 ? "person" : "people"} home`,
    `most limited mobility: ${mobility}`,
    `medical: ${pick(random, MEDICAL)}`,
    `help getting out: ${limited ? pick(random, ASSISTANCE) : "none"}`,
    random() < 0.4 ? "has pets" : "no pets",
    random() < 0.35 ? "has a car" : "no car",
  ];
  return facts.join("; ");
}

// Every resident line of every real call, grouped by call, downloaded once.
export async function realCallerLines(): Promise<string[][]> {
  if (!existsSync(REAL_CALLS_CACHE)) {
    const response = await fetch(REAL_CALLS_URL);
    if (!response.ok) throw new Error(`Couldn't download the 911 call transcripts (${response.status})`);
    mkdirSync(dirname(REAL_CALLS_CACHE), { recursive: true });
    writeFileSync(REAL_CALLS_CACHE, await response.text());
  }
  return readFileSync(REAL_CALLS_CACHE, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => (JSON.parse(line) as { messages: { role: string; content: string }[] }).messages)
    .map((messages) => messages.filter((message) => message.role === "user").map((message) => message.content));
}

export function seedFor(index: number, calls: string[][]): Seed {
  const random = randomFrom(index + 1);
  const seedCall = Math.floor(random() * calls.length);
  return {
    id: `s${String(index).padStart(4, "0")}`,
    hazard: weighted(random, HAZARDS),
    language: weighted(random, LANGUAGES),
    inbound: random() < 0.25,
    address: `${100 + Math.floor(random() * 3800)} ${pick(random, STREETS)}`,
    caller: pick(random, CALLERS),
    mood: pick(random, MOODS),
    household: householdFrom(random),
    twists: distinct(random, TWISTS, 1 + Math.floor(random() * 3)),
    seedCall,
    callerExcerpt: calls[seedCall].slice(0, EXCERPT_LINES),
  };
}
