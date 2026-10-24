import { Actor, log } from "apify";
import { buildDrillRecord, validDrillRing } from "./drill.js";
import { applyFilters, dedupeZones } from "./filters.js";
import { fetchClosures } from "./sources/caltrans.js";
import { fetchIncidents } from "./sources/incidents.js";
import { fetchZones } from "./sources/zones.js";
import { isStale } from "./status.js";
import { ALL_SOURCES, type ActorInput, type EvacuationRecord, type SourceName, type SourceResult } from "./types.js";
import { deliverWebhook, planWebhook, type SentState } from "./webhook.js";

const STATE_STORE = "california-evacuation-status-state";
const SENT_KEY = "webhook-sent";

// Zones come first so the Cal OES copy of a zone wins over the CAL FIRE copy when the two layers overlap.
const RECORD_SOURCE: Record<SourceName, string> = {
  calOesZones: "cal-oes",
  calFireZones: "cal-fire-zones",
  calFireIncidents: "cal-fire-incidents",
  caltransClosures: "caltrans-lcs",
};

const DEFAULT_INPUT: ActorInput = {
  sources: ALL_SOURCES,
  counties: [],
  closureDetail: "full",
  staleAfterHours: 72,
  drill: false,
  drillZoneName: "Drill zone",
  requestTimeoutSecs: 45,
};

const blankToUndefined = (text: string | undefined) => text?.trim() || undefined;

function withDefaults(raw: Partial<ActorInput> | null): ActorInput {
  const provided = Object.fromEntries(Object.entries(raw ?? {}).filter(([, value]) => value !== null && value !== undefined));
  const merged = { ...DEFAULT_INPUT, ...provided } as ActorInput;
  return {
    ...merged,
    sources: merged.sources.length > 0 ? merged.sources : ALL_SOURCES,
    webhookUrl: blankToUndefined(merged.webhookUrl),
    webhookSecret: merged.webhookSecret || undefined,
    drillZoneName: blankToUndefined(merged.drillZoneName) ?? DEFAULT_INPUT.drillZoneName,
  };
}

async function runSource(source: SourceName, input: ActorInput): Promise<SourceResult> {
  try {
    const records = await readSource(source, input);
    return { source, ok: true, records };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`Source ${source} is unavailable, continuing without it: ${message}`);
    return { source, ok: false, records: [], error: message };
  }
}

async function readSource(source: SourceName, input: ActorInput): Promise<EvacuationRecord[]> {
  if (source === "calOesZones" || source === "calFireZones") return await fetchZones(source, input.requestTimeoutSecs);
  if (source === "calFireIncidents") return await fetchIncidents(input.requestTimeoutSecs);
  const outcome = await fetchClosures(input.requestTimeoutSecs, input.closureDetail === "all");
  if (outcome.failedDistricts.length > 0) log.warning(`Caltrans districts skipped because their feeds failed: ${outcome.failedDistricts.join(", ")}`);
  return outcome.records;
}

function markStaleZones(records: EvacuationRecord[], staleAfterHours: number, now: number) {
  for (const record of records) {
    if (record.kind === "evacuation_zone" && record.stale === undefined) record.stale = isStale(record.updatedAt, now, staleAfterHours);
  }
}

function drillRecords(input: ActorInput, now: Date): EvacuationRecord[] {
  if (!input.drill) return [];
  if (!validDrillRing(input.drillPolygon)) {
    log.error("Drill mode is on but drillPolygon is not a ring of at least three [longitude, latitude] pairs. No drill record emitted.");
    return [];
  }
  return [buildDrillRecord(input.drillPolygon, input.drillZoneName, now)];
}

function countBy<T extends string>(items: T[]) {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

async function notify(input: ActorInput, records: EvacuationRecord[], fetched: Set<string>) {
  if (!input.webhookUrl) return null;
  const store = await Actor.openKeyValueStore(STATE_STORE);
  const previous = (await store.getValue<SentState>(SENT_KEY)) ?? {};
  const plan = planWebhook(records, previous, fetched);
  const outcome = await deliverWebhook(input.webhookUrl, input.webhookSecret, plan, input.requestTimeoutSecs);
  await store.setValue(SENT_KEY, outcome.state);
  if (outcome.error) log.error(`Webhook delivery failed after ${outcome.sent} zones; the rest will be retried next run: ${outcome.error}`);
  log.info(`Webhook: ${outcome.sent} zone(s) sent, ${outcome.failed} failed, ${plan.pending.length} were new or changed.`);
  return { sent: outcome.sent, failed: outcome.failed, error: outcome.error ?? null };
}

async function main() {
  await Actor.init();
  const input = withDefaults(await Actor.getInput<Partial<ActorInput>>());
  const now = new Date();

  const results = await Promise.all(input.sources.map((source) => runSource(source, input)));
  const ordered = ALL_SOURCES.flatMap((source) => results.filter((result) => result.source === source));
  const fetched = new Set(ordered.filter((result) => result.ok).map((result) => RECORD_SOURCE[result.source]));
  const perSource = Object.fromEntries(ordered.map((result) => [result.source, result.ok ? result.records.length : "failed"]));

  const real = dedupeZones(applyFilters(ordered.flatMap((result) => result.records), input.counties, input.boundingBox));
  markStaleZones(real, input.staleAfterHours, now.getTime());
  const records = [...real, ...drillRecords(input, now)];

  await Actor.pushData(records);
  const webhook = await notify(input, records, fetched);

  const summary = {
    ranAt: now.toISOString(),
    recordsBeforeFilters: perSource,
    recordsReturned: records.length,
    byKind: countBy(records.map((record) => record.kind)),
    byStatus: countBy(records.map((record) => record.status)),
    staleZones: records.filter((record) => record.stale).length,
    failedSources: ordered.filter((result) => !result.ok).map((result) => ({ source: result.source, error: result.error })),
    webhook,
  };
  log.info(`Run summary: ${JSON.stringify(summary)}`);
  await Actor.setValue("OUTPUT", summary);
  if (ordered.every((result) => !result.ok)) await Actor.fail("Every requested source failed. See the log for each error.");
  else await Actor.exit();
}

await main();
