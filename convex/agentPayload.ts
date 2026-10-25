import type { Point } from "./model";
import { isSpokenLanguage } from "./languages";

// Reads the bodies the Fetch.ai agent posts to /agent/ready-signup and /agent/status.
// Pure functions only, so the HTTP action and its tests share one definition of a usable request.

const MAX_TEXT = 300;
const MAX_PEOPLE = 20;
const MIN_PHONE_DIGITS = 8;
const MAX_PHONE_DIGITS = 15;
const MOBILITY = ["walks", "walker", "manual_wheelchair", "power_wheelchair", "bedbound"] as const;
const ASSISTANCE = ["none", "one_person_assist", "two_person_lift"] as const;
const MEDICAL = ["oxygen", "dialysis", "other"] as const;
const CARE = ["hearing", "sight", "memory", "power_device", "service_animal"] as const;
const EXIT_PLANS = ["own_car", "helper", "needs_ride"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function oneOf<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

function listOf<T extends string>(options: readonly T[], value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return options.filter((option) => value.includes(option));
}

function shortText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, MAX_TEXT);
}

// "(626) 555-0101" and "626-555-0101" become "+16265550101". Anything that is not a plausible number is refused.
export function normalizePhone(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  const plausible = digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
  return raw.trim().startsWith("+") && plausible ? `+${digits}` : undefined;
}

export function parsePoint(raw: unknown): Point | undefined {
  if (!isRecord(raw)) return undefined;
  const { lat, lng } = raw;
  if (typeof lat !== "number" || typeof lng !== "number") return undefined;
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
}

function peopleCountOf(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return value >= 1 && value <= MAX_PEOPLE ? value : undefined;
}

const booleanOf = (value: unknown) => (typeof value === "boolean" ? value : undefined);

function optionalFields(body: Record<string, unknown>) {
  return {
    residentName: shortText(body.residentName),
    mobility: oneOf(MOBILITY, body.mobility),
    assistanceRequired: oneOf(ASSISTANCE, body.assistanceRequired),
    medical: listOf(MEDICAL, body.medical),
    pets: booleanOf(body.pets),
    hasCar: booleanOf(body.hasCar),
    peopleCount: peopleCountOf(body.peopleCount),
    note: shortText(body.note),
  };
}

export function parseSignUp(raw: unknown) {
  if (!isRecord(raw)) return undefined;
  const phone = normalizePhone(raw.phone);
  const address = shortText(raw.address);
  const place = parsePoint(raw);
  const exitPlan = oneOf(EXIT_PLANS, raw.exitPlan);
  if (!phone || !address || !place || !exitPlan) return undefined;
  const language = typeof raw.language === "string" && isSpokenLanguage(raw.language) ? raw.language : "en";
  return { phone, address, ...place, language, exitPlan, care: listOf(CARE, raw.care), ...optionalFields(raw) };
}

export function parseStatusQuery(raw: unknown): { place?: Point } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.lat === undefined && raw.lng === undefined) return {};
  const place = parsePoint(raw);
  return place ? { place } : undefined;
}

// Everything the status route says. It is the same for every caller and names no person.
export function statusAnswer(warningActive: boolean, coversPlace: boolean | null, evacuationLine: string | undefined) {
  const guidance = warningActive
    ? "An evacuation warning is active. If you can leave safely, leave now. If fire reaches your home, call 911."
    : "No evacuation warning is active right now. Sign up for the Ready check so help can find you early if one is issued.";
  return { warningActive, coversPlace, guidance, ...(evacuationLine ? { evacuationLine } : {}) };
}
