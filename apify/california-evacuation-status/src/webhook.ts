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

async function postBatch(url: string, secret: string | undefined, body: unknown, timeoutSecs: number) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers.authorization = `Bearer ${secret}`;
  await fetchWithRetry(url, timeoutSecs, { method: "POST", headers, body: JSON.stringify(body) });
}

export interface WebhookOutcome {
  sent: number;
  failed: number;
  state: SentState;
  error?: string;
}

// A fingerprint of null means "forget this key once the receiver has it", as for a lifted closure.
interface PendingEntry<T> {
  key: string;
  fingerprint: string | null;
  item: T;
}

// Entries are remembered only after the receiver answered 2xx, so a failed post is retried on the next run.
async function deliverBatches<T>(
  url: string,
  secret: string | undefined,
  wrap: (items: T[]) => unknown,
  pending: PendingEntry<T>[],
  retained: SentState,
  timeoutSecs: number,
): Promise<WebhookOutcome> {
  const state = { ...retained };
  let sent = 0;
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    try {
      await postBatch(url, secret, wrap(batch.map((entry) => entry.item)), timeoutSecs);
    } catch (error) {
      const message = error instanceof HttpStatusError ? error.message : String(error);
      return { sent, failed: pending.length - sent, state, error: message };
    }
    for (const entry of batch) {
      if (entry.fingerprint === null) delete state[entry.key];
      else state[entry.key] = entry.fingerprint;
    }
    sent += batch.length;
  }
  return { sent, failed: 0, state };
}

export function deliverWebhook(url: string, secret: string | undefined, plan: WebhookPlan, timeoutSecs: number): Promise<WebhookOutcome> {
  const pending = plan.pending.map(({ key, fingerprint, zone }) => ({ key, fingerprint, item: zone }));
  return deliverBatches(url, secret, (zones) => ({ zones }), pending, plan.retained, timeoutSecs);
}

// Full road closures for a second webhook: each one once when it starts, and once more as "lifted"
// when the source stops reporting it. A closure is only taken as lifted when the feed it came from
// (for Caltrans, its district) was read this run, so a feed that is down never reopens a road.
export interface WebhookClosure {
  source: string;
  // Lifted closures carry only what identifies them.
  sourceUrl?: string;
  kind: "road_closure";
  id: string;
  name: string;
  county: string | null;
  status: "closed" | "lifted";
  updatedAt: string | null;
  geometry?: EvacuationRecord["geometry"];
}

export interface ClosurePlan {
  pending: PendingEntry<WebhookClosure>[];
  retained: SentState;
}

const CLOSED = "closed";

// The feed a closure came from: its source, plus its Caltrans district when it has one.
export const feedOf = (source: string, district: string | null) => (district ? `${source}|d${district}` : source);

const districtOf = (record: EvacuationRecord) => {
  const district = record.properties.district;
  return typeof district === "string" && district !== "" ? district : null;
};

// Sent state is "closed|<feed>", so a later run knows which feed must have been read to call it lifted.
const closedFingerprint = (record: EvacuationRecord) => `${CLOSED}|${feedOf(record.source, districtOf(record))}`;
const feedOfFingerprint = (fingerprint: string) => fingerprint.slice(fingerprint.indexOf("|") + 1);

function liftedClosure(key: string): WebhookClosure {
  const split = key.indexOf(":");
  const id = key.slice(split + 1);
  return { source: key.slice(0, split), kind: "road_closure", id, name: id, county: null, status: "lifted", updatedAt: null };
}

function toWebhookClosure(record: EvacuationRecord): WebhookClosure {
  return {
    source: record.source,
    sourceUrl: record.sourceUrl,
    kind: "road_closure",
    id: record.id,
    name: record.name,
    county: record.county,
    status: "closed",
    updatedAt: record.updatedAt,
    geometry: record.geometry,
  };
}

const wasRead = (feed: string, fetchedSources: Set<string>, unreadFeeds: Set<string>) =>
  fetchedSources.has(feed.split("|")[0] as string) && !unreadFeeds.has(feed);

export function planClosureWebhook(
  records: EvacuationRecord[],
  previous: SentState,
  fetchedSources: Set<string>,
  unreadFeeds: Set<string>,
): ClosurePlan {
  const closed = records.filter((record) => record.kind === "road_closure" && record.status === "closed");
  const closedKeys = new Set(closed.map(keyOf));
  const retained: SentState = {};
  const pending: PendingEntry<WebhookClosure>[] = [];
  for (const [key, fingerprint] of Object.entries(previous)) {
    retained[key] = fingerprint;
    if (closedKeys.has(key) || !wasRead(feedOfFingerprint(fingerprint), fetchedSources, unreadFeeds)) continue;
    pending.push({ key, fingerprint: null, item: liftedClosure(key) });
  }
  for (const record of closed) {
    if (previous[keyOf(record)] === undefined) pending.push({ key: keyOf(record), fingerprint: closedFingerprint(record), item: toWebhookClosure(record) });
  }
  return { pending, retained };
}

export function deliverClosureWebhook(url: string, secret: string | undefined, plan: ClosurePlan, timeoutSecs: number): Promise<WebhookOutcome> {
  return deliverBatches(url, secret, (closures) => ({ closures }), plan.pending, plan.retained, timeoutSecs);
}
