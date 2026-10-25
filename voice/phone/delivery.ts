import type { Language } from "../agent/script";

// How urgently Sonic says a turn. Each level maps to a Sonic generation_config, which Cartesia
// applies to one request only, so every request carries its own.
// - routine: a Ready check, a pickup check or a callback, or a home with no warning on it.
// - warning: an evacuation warning covers the home, but the fire is not near yet.
// - imminent: the fire reaches the home within IMMINENT_WITHIN_MS on the night clock, or the
//   resident already reported flames or a medical emergency on this call.
// - emergency: a medical emergency or flames reported this turn, or the reassigning status line.
// slower: the resident asked to hear it again, or is hard of hearing on file.

export type Urgency = "routine" | "warning" | "imminent" | "emergency";
export type Delivery = { urgency: Urgency; slower: boolean };

// The emotion values Sonic documents; it ignores emotion outside English.
type Emotion = "calm" | "determined";
export type GenerationConfig = { speed: number; volume: number; emotion?: Emotion };

export const ROUTINE: Delivery = { urgency: "routine", slower: false };

export const IMMINENT_WITHIN_MS = 60 * 60_000;
const SLOWER_SPEED = 0.85;

const RANK: Record<Urgency, number> = { routine: 0, warning: 1, imminent: 2, emergency: 3 };

const BY_URGENCY: Record<Urgency, Required<GenerationConfig>> = {
  routine: { speed: 1.0, volume: 1.0, emotion: "calm" },
  warning: { speed: 1.05, volume: 1.05, emotion: "calm" },
  imminent: { speed: 1.1, volume: 1.25, emotion: "determined" },
  emergency: { speed: 1.1, volume: 1.4, emotion: "determined" },
};

// A slower delivery keeps the urgency's volume: a hard-of-hearing resident needs it louder too.
export function generationConfig(delivery: Delivery, language: Language): GenerationConfig {
  const { speed, volume, emotion } = BY_URGENCY[delivery.urgency];
  const config: GenerationConfig = { speed: delivery.slower ? SLOWER_SPEED : speed, volume };
  return language === "en" ? { ...config, emotion } : config;
}

export const higher = (a: Urgency, b: Urgency): Urgency => (RANK[a] >= RANK[b] ? a : b);

export const describeDelivery = (delivery: Delivery) => `${delivery.urgency}${delivery.slower ? "+slower" : ""}`;

// What the call knows about the home before anyone speaks.
export type CallSituation = { rescue: boolean; warningActive: boolean; fireArrivalAt?: number; now: number };

// The floor for every turn on this call. Only the rescue call (survey or inbound) can be urgent.
export function callUrgency({ rescue, warningActive, fireArrivalAt, now }: CallSituation): Urgency {
  if (!rescue || !warningActive) return "routine";
  const fireNear = fireArrivalAt !== undefined && fireArrivalAt - now <= IMMINENT_WITHIN_MS;
  return fireNear ? "imminent" : "warning";
}

// What this turn adds on top of the call's floor.
export type TurnSignals = { emergency: boolean; reassigning: boolean; threatEarlier: boolean; slower: boolean; hardOfHearing: boolean };

function turnUrgency(floor: Urgency, signals: TurnSignals): Urgency {
  if (signals.emergency || signals.reassigning) return "emergency";
  return signals.threatEarlier ? higher(floor, "imminent") : floor;
}

export function turnDelivery(floor: Urgency, signals: TurnSignals): Delivery {
  return { urgency: turnUrgency(floor, signals), slower: signals.slower || signals.hardOfHearing };
}
