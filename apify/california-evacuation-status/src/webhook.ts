import { fetchWithRetry, HttpStatusError } from "./http.js";
import type { EvacuationRecord } from "./types.js";

const BATCH_SIZE = 25;
const ALERT_STATUSES = new Set(["warning", "order"]);

export type SentState = Record<string, string>;

export interface WebhookZone {
  source: string;
  sourceUrl: string;
  kind: "evacuation_zone";
  id: string;
  name: string;
  county: string | null;
  status: "warning" | "order";
  updatedAt: string | null;
  geometry: EvacuationRecord["geometry"];
  drill?: true;
}

const keyOf = (record: EvacuationRecord) => `${record.source}:${record.id}`;
const fingerprintOf = (record: EvacuationRecord) => `${record.status}|${record.updatedAt ?? ""}`;

export const isAlertingZone = (record: EvacuationRecord) =>
  record.kind === "evacuation_zone" && ALERT_STATUSES.has(record.status) && record.stale !== true;

function toWebhookZone(record: EvacuationRecord): WebhookZone {
  const zone: WebhookZone = {
    source: record.source,
    sourceUrl: record.sourceUrl,
    kind: "evacuation_zone",
    id: record.id,
    name: record.name,
    county: record.county,
    status: record.status as "warning" | "order",
    updatedAt: record.updatedAt,
    geometry: record.geometry,
  };
  if (record.drill) zone.drill = true;
  return zone;
}

export interface WebhookPlan {
  pending: { key: string; fingerprint: string; zone: WebhookZone }[];
  // Entries to keep. Zones that left warning or order are dropped so a later return to warning sends again.
  retained: SentState;
}

export function planWebhook(records: EvacuationRecord[], previous: SentState, fetchedSources: Set<string>): WebhookPlan {
  const alerting = records.filter(isAlertingZone);
  const alertingKeys = new Set(alerting.map(keyOf));
  const retained: SentState = {};
  for (const [key, fingerprint] of Object.entries(previous)) {
    const source = key.slice(0, key.indexOf(":"));
    if (alertingKeys.has(key) || !fetchedSources.has(source)) retained[key] = fingerprint;
  }
  const pending = alerting
    .filter((record) => previous[keyOf(record)] !== fingerprintOf(record))
    .map((record) => ({ key: keyOf(record), fingerprint: fingerprintOf(record), zone: toWebhookZone(record) }));
  return { pending, retained };
}

async function postBatch(url: string, secret: string | undefined, zones: WebhookZone[], timeoutSecs: number) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  await fetchWithRetry(url, timeoutSecs, { method: "POST", headers, body: JSON.stringify({ zones }) });
}

export interface WebhookOutcome {
  sent: number;
  failed: number;
  state: SentState;
  error?: string;
}

// Zones are remembered only after the receiver answered 2xx, so a failed post is retried on the next run.
export async function deliverWebhook(url: string, secret: string | undefined, plan: WebhookPlan, timeoutSecs: number): Promise<WebhookOutcome> {
  const state = { ...plan.retained };
  let sent = 0;
  for (let start = 0; start < plan.pending.length; start += BATCH_SIZE) {
    const batch = plan.pending.slice(start, start + BATCH_SIZE);
    try {
      await postBatch(url, secret, batch.map((entry) => entry.zone), timeoutSecs);
    } catch (error) {
      const message = error instanceof HttpStatusError ? error.message : String(error);
      return { sent, failed: plan.pending.length - sent, state, error: message };
    }
    for (const entry of batch) state[entry.key] = entry.fingerprint;
    sent += batch.length;
  }
  return { sent, failed: 0, state };
}
