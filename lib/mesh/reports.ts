import { IdSource } from "./random";

// Road reports that phones pass to each other. A report says one street segment was seen blocked
// or clear at about some minute. It carries no phone id, no name and no position of the person
// beyond the segment itself, and its time is rounded down to the minute. Its id is random, made
// per report, and exists only so a report that reaches a phone twice is counted once.

export type RoadStatus = "blocked" | "clear";
export const ROAD_CAUSES = ["fire", "debris", "traffic", "police", "power_line", "other"] as const;
export type RoadCause = (typeof ROAD_CAUSES)[number];

export type RoadReport = {
  id: string;
  segment: string;
  status: RoadStatus;
  cause?: RoadCause;
  observedAt: number;
  // How many phones it passed through after the one that made it.
  hops: number;
};

export const TIME_BUCKET_MS = 60_000;
export const REPORT_TTL_MS = 6 * 60 * 60_000;
export const MAX_HOPS = 64;
const MAX_REPORTS_PER_SEGMENT = 12;
export const MAX_REPORTS = 4000;
// Observations lose half their weight every half hour, so a road that reopens is seen as open.
const HALF_LIFE_MS = 30 * 60_000;
const MIN_CONSENSUS_WEIGHT = 0.5;
const MAX_CLOCK_SKEW_MS = 10 * 60_000;

export const coarsenTime = (at: number) => Math.floor(at / TIME_BUCKET_MS) * TIME_BUCKET_MS;

export function makeReport(
  input: { segment: string; status: RoadStatus; cause?: RoadCause; observedAt: number },
  newId: IdSource,
): RoadReport {
  const report: RoadReport = { id: newId(), segment: input.segment, status: input.status, observedAt: coarsenTime(input.observedAt), hops: 0 };
  if (input.cause) report.cause = input.cause;
  return report;
}

const ID_PATTERN = /^[0-9a-f]{8,32}$/;
const SEGMENT_PATTERN = /^[0-9]{1,15}-[0-9]{1,15}-[0-9]{1,3}$/;

function hasValidCause(value: Record<string, unknown>) {
  return value.cause === undefined || (ROAD_CAUSES as readonly unknown[]).includes(value.cause);
}

function hasValidShape(value: Record<string, unknown>) {
  return (
    typeof value.id === "string" &&
    ID_PATTERN.test(value.id) &&
    typeof value.segment === "string" &&
    SEGMENT_PATTERN.test(value.segment) &&
    (value.status === "blocked" || value.status === "clear") &&
    hasValidCause(value)
  );
}

// Everything a peer sends is untrusted. Reports from the future or the far past are refused.
export function isValidReport(value: unknown, now: number): value is RoadReport {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Record<string, unknown>;
  if (!hasValidShape(report)) return false;
  const { observedAt, hops } = report;
  if (typeof observedAt !== "number" || !Number.isFinite(observedAt) || observedAt % TIME_BUCKET_MS !== 0) return false;
  if (observedAt > now + MAX_CLOCK_SKEW_MS || observedAt < now - REPORT_TTL_MS) return false;
  return typeof hops === "number" && Number.isInteger(hops) && hops >= 0 && hops <= MAX_HOPS;
}

// Only the fields the protocol defines travel on; anything extra a peer attached is dropped.
function clean(report: RoadReport): RoadReport {
  const copy: RoadReport = { id: report.id, segment: report.segment, status: report.status, observedAt: report.observedAt, hops: report.hops };
  if (report.cause) copy.cause = report.cause;
  return copy;
}

export type Consensus = {
  segment: string;
  status: RoadStatus | "unknown";
  blockedWeight: number;
  clearWeight: number;
  reports: number;
  lastObservedAt: number;
  causes: RoadCause[];
};

export function weightOf(report: RoadReport, now: number) {
  return Math.pow(0.5, Math.max(0, now - report.observedAt) / HALF_LIFE_MS);
}

// Time-decayed vote over every report of one segment.
export function consensusOf(segment: string, reports: Iterable<RoadReport>, now: number): Consensus {
  let blockedWeight = 0;
  let clearWeight = 0;
  let count = 0;
  let lastObservedAt = 0;
  const causes = new Set<RoadCause>();
  for (const report of reports) {
    const weight = weightOf(report, now);
    if (report.status === "blocked") blockedWeight += weight;
    else clearWeight += weight;
    if (report.status === "blocked" && report.cause) causes.add(report.cause);
    count += 1;
    lastObservedAt = Math.max(lastObservedAt, report.observedAt);
  }
  const total = blockedWeight + clearWeight;
  const status = total < MIN_CONSENSUS_WEIGHT ? "unknown" : blockedWeight > clearWeight ? "blocked" : "clear";
  return { segment, status, blockedWeight, clearWeight, reports: count, lastObservedAt, causes: [...causes] };
}

// A grow-only set of reports keyed by id, which merges the same way in any order. Expired reports
// and the oldest reports of a crowded segment are dropped so the store stays small enough to sync.
export class ReportStore {
  private byId = new Map<string, RoadReport>();
  private bySegment = new Map<string, Set<string>>();

  get size() {
    return this.byId.size;
  }

  has(id: string) {
    return this.byId.has(id);
  }

  all(): RoadReport[] {
    return [...this.byId.values()];
  }

  // Ids newest first, for the digest a phone sends when it meets another.
  ids(limit = MAX_REPORTS): string[] {
    return this.all()
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, limit)
      .map((report) => report.id);
  }

  missingFrom(theirIds: Iterable<string>): RoadReport[] {
    const theirs = new Set(theirIds);
    return this.all().filter((report) => !theirs.has(report.id));
  }

  // Adds reports this phone made or received. Received ones count one more hop.
  add(reports: Iterable<RoadReport>, now: number, received = false): RoadReport[] {
    const added: RoadReport[] = [];
    for (const incoming of reports) {
      if (!isValidReport(incoming, now)) continue;
      const report = clean(received ? { ...incoming, hops: Math.min(incoming.hops + 1, MAX_HOPS) } : incoming);
      const existing = this.byId.get(report.id);
      if (existing) {
        existing.hops = Math.min(existing.hops, report.hops);
        continue;
      }
      this.byId.set(report.id, report);
      const ids = this.bySegment.get(report.segment) ?? new Set<string>();
      ids.add(report.id);
      this.bySegment.set(report.segment, ids);
      added.push(report);
      this.trimSegment(report.segment);
    }
    if (this.byId.size > MAX_REPORTS) this.trimOldest(this.byId.size - MAX_REPORTS);
    return added.filter((report) => this.byId.has(report.id));
  }

  forSegment(segment: string): RoadReport[] {
    return [...(this.bySegment.get(segment) ?? [])].map((id) => this.byId.get(id)!);
  }

  segments(): string[] {
    return [...this.bySegment.keys()];
  }

  consensus(segment: string, now: number) {
    return consensusOf(segment, this.forSegment(segment), now);
  }

  blockedSegments(now: number): string[] {
    return this.segments().filter((segment) => this.consensus(segment, now).status === "blocked");
  }

  expire(now: number) {
    for (const report of this.all()) if (report.observedAt < now - REPORT_TTL_MS) this.remove(report.id);
  }

  private remove(id: string) {
    const report = this.byId.get(id);
    if (!report) return;
    this.byId.delete(id);
    const ids = this.bySegment.get(report.segment);
    ids?.delete(id);
    if (ids?.size === 0) this.bySegment.delete(report.segment);
  }

  private trimSegment(segment: string) {
    const reports = this.forSegment(segment);
    if (reports.length <= MAX_REPORTS_PER_SEGMENT) return;
    reports.sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id));
    for (const report of reports.slice(0, reports.length - MAX_REPORTS_PER_SEGMENT)) this.remove(report.id);
  }

  private trimOldest(count: number) {
    const oldest = this.all().sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id));
    for (const report of oldest.slice(0, count)) this.remove(report.id);
  }
}
