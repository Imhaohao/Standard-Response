import { DEFAULT_TRAINING, GlobalModel, INITIAL_MODEL, isValidMix, Mix, UPLOAD_MIN_MASS } from "./federated";
import { consensusOf, Consensus, isValidReport, RoadReport } from "./reports";
import { addToRound, closeRound, DEFAULT_OPTIMIZER, emptyRound, freshOptimizerState, OpenRound, ROUND_MASS, roundIsReady, ServerOptimizer } from "./rounds";

// The government's side, in memory: what convex/mesh.ts stores in tables, for the simulation and
// tests. It sees anonymous reports and mixes of at least UPLOAD_MIN_MASS phones, never a phone id.

export type RoundRecord = { version: number; mass: number; uploads: number; staleMass: number; closedAt: number; stepNorm: number };

export class Agency {
  model: GlobalModel = INITIAL_MODEL;
  readonly rounds: RoundRecord[] = [];
  private open: OpenRound = emptyRound(0);
  private optimizerState = freshOptimizerState();
  private reports = new Map<string, RoadReport & { receivedAt: number }>();
  refusedMixes = 0;

  constructor(
    private readonly roundMass = ROUND_MASS,
    private readonly optimizer: ServerOptimizer = DEFAULT_OPTIMIZER,
  ) {}

  uploadReports(reports: RoadReport[], now: number) {
    let added = 0;
    for (const report of reports) {
      if (!isValidReport(report, now) || this.reports.has(report.id)) continue;
      this.reports.set(report.id, { ...report, receivedAt: now });
      added += 1;
    }
    return added;
  }

  uploadMix(mix: Mix, now: number) {
    if (!isValidMix(mix, DEFAULT_TRAINING) || mix.mass < UPLOAD_MIN_MASS - 1e-9) {
      this.refusedMixes += 1;
      return false;
    }
    const next = addToRound(this.open, mix);
    if (!next) {
      this.refusedMixes += 1;
      return false;
    }
    this.open = next;
    if (roundIsReady(this.open, this.roundMass)) this.close(now);
    return true;
  }

  private close(now: number) {
    const before = this.model.weights;
    const result = closeRound(this.model, this.open, now, this.optimizerState, this.optimizer);
    this.model = result.model;
    this.optimizerState = result.state;
    const stepNorm = Math.hypot(...this.model.weights.map((w, i) => w - before[i]));
    this.rounds.push({ version: this.model.version, mass: this.open.mass, uploads: this.open.uploads, staleMass: this.open.staleMass, closedAt: now, stepNorm });
    this.open = emptyRound(this.model.version);
  }

  openRound(): Readonly<OpenRound> {
    return this.open;
  }

  reportCount() {
    return this.reports.size;
  }

  receivedAt(id: string) {
    return this.reports.get(id)?.receivedAt;
  }

  allReports(): RoadReport[] {
    return [...this.reports.values()];
  }

  consensus(now: number): Map<string, Consensus> {
    const bySegment = new Map<string, RoadReport[]>();
    for (const report of this.reports.values()) bySegment.set(report.segment, [...(bySegment.get(report.segment) ?? []), report]);
    return new Map([...bySegment].map(([segment, reports]) => [segment, consensusOf(segment, reports, now)]));
  }
}
