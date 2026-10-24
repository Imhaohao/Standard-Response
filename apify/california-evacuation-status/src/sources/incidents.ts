import { fetchJson } from "../http.js";
import type { EvacuationRecord } from "../types.js";

const INCIDENTS_URL = "https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false";

interface CalFireIncident {
  Name?: string;
  Final?: boolean;
  Updated?: string;
  Started?: string;
  County?: string;
  Location?: string;
  AcresBurned?: number | null;
  PercentContained?: number | null;
  Longitude?: number | null;
  Latitude?: number | null;
  Type?: string;
  UniqueId?: string;
  Url?: string;
  AdminUnit?: string;
  IsActive?: boolean;
}

const isNonZeroNumber = (value: unknown): value is number => typeof value === "number" && value !== 0;

const hasLocation = (item: CalFireIncident) => isNonZeroNumber(item.Longitude) && isNonZeroNumber(item.Latitude);

function isoFromText(text: string | undefined) {
  const time = Date.parse(text ?? "");
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

const isOngoing = (item: CalFireIncident) => item.IsActive !== false && !item.Final;

function detailsOf(item: CalFireIncident) {
  return {
    incidentType: item.Type ?? null,
    location: item.Location ?? null,
    acresBurned: item.AcresBurned ?? null,
    percentContained: item.PercentContained ?? null,
    startedAt: isoFromText(item.Started),
    adminUnit: item.AdminUnit ?? null,
  };
}

function incidentRecord(item: CalFireIncident): EvacuationRecord | null {
  if (!item.UniqueId || !hasLocation(item)) return null;
  return {
    source: "cal-fire-incidents",
    sourceUrl: item.Url || INCIDENTS_URL,
    kind: "incident",
    id: item.UniqueId,
    name: item.Name || item.UniqueId,
    county: item.County || null,
    status: "unknown",
    updatedAt: isoFromText(item.Updated),
    geometry: { type: "Point", coordinates: [item.Longitude as number, item.Latitude as number] },
    properties: detailsOf(item),
  };
}

export async function fetchIncidents(timeoutSecs: number) {
  const items = await fetchJson<CalFireIncident[]>(INCIDENTS_URL, timeoutSecs);
  if (!Array.isArray(items)) throw new Error("CAL FIRE incidents response was not a list");
  return items
    .filter(isOngoing)
    .map(incidentRecord)
    .filter((record): record is EvacuationRecord => record !== null);
}
