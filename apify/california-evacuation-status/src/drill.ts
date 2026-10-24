import type { EvacuationRecord } from "./types.js";

const isPosition = (value: unknown): value is [number, number] =>
  Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";

export function validDrillRing(ring: unknown): ring is [number, number][] {
  return Array.isArray(ring) && ring.length >= 3 && ring.every(isPosition);
}

const closed = (ring: [number, number][]) => {
  const first = ring[0] as [number, number];
  const last = ring[ring.length - 1] as [number, number];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

// Drill mode never edits real data. It adds one explicitly labelled record that carries drill: true.
export function buildDrillRecord(ring: [number, number][], name: string, now: Date): EvacuationRecord {
  // Midnight UTC, so repeated drill runs on the same day look unchanged to the webhook de-duplication.
  const stamp = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
  return {
    source: "drill",
    sourceUrl: "apify://california-evacuation-status/drill",
    kind: "evacuation_zone",
    id: `drill-${stamp.slice(0, 10)}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    county: null,
    status: "warning",
    updatedAt: stamp,
    stale: false,
    drill: true,
    geometry: { type: "Polygon", coordinates: [closed(ring.map(([lng, lat]) => [lng, lat] as [number, number]))] },
    properties: { note: "Synthetic zone from drill mode. Not real data." },
  };
}
