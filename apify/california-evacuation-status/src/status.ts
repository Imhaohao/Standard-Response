import type { Status } from "./types.js";

// Order matters: "Evacuation Order Lifted" must read as lifted, not order.
const STATUS_RULES: [RegExp, Status][] = [
  [/lift|clear|normal|rescind|repopulat/i, "lifted"],
  [/order/i, "order"],
  [/warning/i, "warning"],
  [/advisory|alert|watch/i, "advisory"],
];

// Shelter in place is a directive to stay put, not a warning to leave, so it is reported as an advisory.
const SHELTER_IN_PLACE = /shelter/i;

export function normalizeZoneStatus(raw: string | null | undefined): Status {
  if (!raw) return "unknown";
  if (SHELTER_IN_PLACE.test(raw)) return "advisory";
  const match = STATUS_RULES.find(([pattern]) => pattern.test(raw));
  return match ? match[1] : "unknown";
}

export const isoOrNull = (epochMs: number | null | undefined) => {
  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs <= 0) return null;
  return new Date(epochMs).toISOString();
};

export function isStale(updatedAt: string | null, now: number, staleAfterHours: number) {
  if (!updatedAt) return true;
  return now - Date.parse(updatedAt) > staleAfterHours * 3_600_000;
}
