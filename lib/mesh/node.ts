import {
  DEFAULT_TRAINING,
  Example,
  GlobalModel,
  INITIAL_MODEL,
  isValidMix,
  isValidModel,
  MIN_EXAMPLES,
  Mix,
  MixPool,
  privateUpdate,
  TrainingParams,
  UPLOAD_MIN_MASS,
} from "./federated";
import { privacySpent } from "./privacy";
import { MAX_STALENESS } from "./rounds";
import { IdSource, Random } from "./random";
import { Digest, isValidReport, makeReport, MAX_REPORTS, ReportStore, RoadCause, RoadReport, RoadStatus, sameDigest } from "./reports";

// One phone on the mesh, independent of how it talks to other phones. A meeting is: both phones
// send `hello` with a digest of the reports they hold and their model version. If the digests
// differ, each sends the ids it holds and then the reports the other lacks. Each also sends its
// model if newer and half of its aggregation mass. Every message is untrusted input.

export const PROTOCOL = 1;
const MAX_REPORTS_PER_MESSAGE = 400;
const MAX_EXAMPLES = 400;

export type Holding = { version: number; mass: number };
export type Hello = {
  type: "hello";
  protocol: number;
  session: string;
  digest: Digest;
  modelVersion: number;
  // How much aggregation mass this phone holds per model version, and whether it is a gateway now.
  holding: Holding[];
  sink: boolean;
};
export type IdsMessage = { type: "ids"; have: string[] };
export type ReportsMessage = { type: "reports"; reports: RoadReport[] };
export type ModelMessage = { type: "model"; model: GlobalModel };
export type MixMessage = { type: "mix"; transfer: string; mix: Mix };
export type MeshMessage = Hello | IdsMessage | ReportsMessage | ModelMessage | MixMessage;

export type NodeOptions = {
  newId: IdSource;
  random: Random;
  now: () => number;
  // The person chose to help train the shared model. Off means no updates are made on this phone.
  participate?: boolean;
  training?: TrainingParams;
};

export type MeetingResult = { reportsReceived: number; modelUpdated: boolean; massReceived: number };

export type NodeSnapshot = {
  reports: RoadReport[];
  model: GlobalModel;
  mixes: Mix[];
  examples: Example[];
  contributedVersions: number[];
  observed: number;
  observedAtContribution: number;
  uploadedReportIds: string[];
  participate: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isValidDigest(value: unknown): value is Digest {
  if (!isRecord(value)) return false;
  return [value.count, value.a, value.b].every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0);
}

export function isValidHello(value: Record<string, unknown>): value is Hello {
  return (
    value.type === "hello" &&
    value.protocol === PROTOCOL &&
    typeof value.session === "string" &&
    value.session.length <= 64 &&
    typeof value.modelVersion === "number" &&
    isValidDigest(value.digest) &&
    isValidHolding(value.holding) &&
    typeof value.sink === "boolean"
  );
}

function isValidHolding(value: unknown): value is Holding[] {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every((h) => isRecord(h) && Number.isInteger(h.version) && typeof h.mass === "number" && Number.isFinite(h.mass) && h.mass >= 0)
  );
}

function isValidIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_REPORTS && value.every((id) => typeof id === "string" && id.length <= 32);
}

export class MeshNode {
  readonly reports = new ReportStore();
  model: GlobalModel = INITIAL_MODEL;
  readonly pool = new MixPool();
  examples: Example[] = [];
  participate: boolean;
  // Set while this phone has internet and its owner agreed to upload for others. Other phones
  // hand it their mass, and it uploads once it holds enough.
  sink = false;
  private session = "";
  private contributed = new Set<number>();
  // Observations made in total, and how many there were at the last contribution: a phone only
  // contributes again once it has seen something new, so nobody's old data is counted round after round.
  private observed = 0;
  private observedAtContribution = 0;
  private uploadedReports = new Set<string>();
  private readonly options: Required<NodeOptions>;

  constructor(options: NodeOptions) {
    this.options = { participate: true, training: DEFAULT_TRAINING, ...options };
    this.participate = this.options.participate;
  }

  // ---- What the person on this phone does ----

  report(segment: string, status: RoadStatus, cause?: RoadCause): RoadReport {
    const report = makeReport({ segment, status, cause, observedAt: this.options.now() }, this.options.newId);
    this.reports.add([report], this.options.now());
    return report;
  }

  // A labelled observation kept on this phone for training. It is never sent anywhere.
  observe(example: Example) {
    this.examples.push(example);
    this.observed += 1;
    if (this.examples.length > MAX_EXAMPLES) this.examples.splice(Math.floor(this.options.random() * MAX_EXAMPLES), 1);
    this.maybeContribute();
  }

  setParticipation(participate: boolean) {
    this.participate = participate;
    if (participate) this.maybeContribute();
  }

  // Trains on local examples once per model version and mixes the private update in.
  maybeContribute() {
    if (!this.participate || this.contributed.has(this.model.version) || this.examples.length < MIN_EXAMPLES) return false;
    if (this.contributed.size >= this.options.training.maxContributions) return false;
    if (this.contributed.size > 0 && this.observed - this.observedAtContribution < MIN_EXAMPLES) return false;
    const update = privateUpdate(this.model, this.examples, this.options.training, this.options.random);
    this.pool.contribute(this.model.version, update);
    this.contributed.add(this.model.version);
    this.observedAtContribution = this.observed;
    return true;
  }

  privacy(delta = 1e-5) {
    return privacySpent(this.options.training.noiseMultiplier, this.contributed.size, delta);
  }

  contributions() {
    return this.contributed.size;
  }

  // ---- Meeting another phone ----

  // A fresh session id per meeting, so peers can't recognise this phone from one meeting to the next.
  hello(): Hello {
    this.session = this.options.newId();
    return {
      type: "hello",
      protocol: PROTOCOL,
      session: this.session,
      digest: this.reports.digest(),
      modelVersion: this.model.version,
      holding: this.pool.holding(),
      sink: this.sink,
    };
  }

  // Mass moves toward whoever holds more of a version, gateways first; ties go by session id.
  private givesTo(hello: Hello, version: number, mass: number) {
    const theirs = hello.holding.find((h) => h.version === version)?.mass ?? 0;
    const weigh = (sink: boolean, held: number) => (sink ? 1e9 : 0) + held;
    const mine = weigh(this.sink, mass);
    const peer = weigh(hello.sink, theirs);
    return peer > mine || (peer === mine && hello.session > this.session);
  }

  emptyResult(): MeetingResult {
    return emptyResult();
  }

  // Applies one message and returns the replies to send back.
  receive(message: unknown, result?: MeetingResult): MeshMessage[] {
    if (!isRecord(message)) return [];
    if (message.type === "hello") return isValidHello(message) ? this.answerHello(message) : [];
    if (message.type === "ids") return isValidIds(message.have) ? this.sendMissing(message.have) : [];
    if (message.type === "reports") this.receiveReports(message.reports, result);
    else if (message.type === "model") this.receiveModel(message.model, result);
    else if (message.type === "mix") this.receiveMix(message, result);
    return [];
  }

  private answerHello(hello: Hello): MeshMessage[] {
    const replies: MeshMessage[] = [];
    if (!sameDigest(hello.digest, this.reports.digest())) replies.push({ type: "ids", have: this.reports.ids() });
    if (this.model.version > hello.modelVersion) replies.push({ type: "model", model: this.model });
    const give = (version: number, mass: number) => this.givesTo(hello, version, mass);
    for (const { transfer, mix } of this.pool.splitHalf(this.options.newId, give)) replies.push({ type: "mix", transfer, mix });
    return replies;
  }

  private sendMissing(theirIds: string[]): MeshMessage[] {
    const missing = this.reports.missingFrom(theirIds);
    const replies: MeshMessage[] = [];
    for (let i = 0; i < missing.length; i += MAX_REPORTS_PER_MESSAGE) {
      replies.push({ type: "reports", reports: missing.slice(i, i + MAX_REPORTS_PER_MESSAGE) });
    }
    return replies;
  }

  private receiveReports(reports: unknown, result?: MeetingResult) {
    if (!Array.isArray(reports) || reports.length > MAX_REPORTS_PER_MESSAGE) return;
    const now = this.options.now();
    const added = this.reports.add(
      reports.filter((r) => isValidReport(r, now)),
      now,
      true,
    );
    if (result) result.reportsReceived += added.length;
  }

  private receiveModel(model: unknown, result?: MeetingResult) {
    if (!this.adoptModel(model)) return;
    if (result) result.modelUpdated = true;
  }

  private receiveMix(message: Record<string, unknown>, result?: MeetingResult) {
    const { transfer, mix } = message;
    if (typeof transfer !== "string" || transfer.length > 64 || !isValidMix(mix, this.options.training)) return;
    if (this.pool.absorb(mix, transfer) && result) result.massReceived += mix.mass;
  }

  // A newer model from a peer or the server replaces this phone's, then this phone may contribute to it.
  adoptModel(model: unknown) {
    if (!isValidModel(model) || model.version <= this.model.version) return false;
    this.model = { version: model.version, weights: [...model.weights], issuedAt: model.issuedAt, contributors: model.contributors };
    this.pool.prune(model.version, MAX_STALENESS);
    this.maybeContribute();
    return true;
  }

  // ---- Sharing with the government, when this phone has internet ----

  // Reports this phone has not uploaded yet, and mixes heavy enough to upload. Taking the mixes
  // removes them from this phone, so call `restoreUpload` if the upload fails.
  takeUpload(minMass = UPLOAD_MIN_MASS) {
    const reports = this.reports.all().filter((report) => !this.uploadedReports.has(report.id));
    return { reports, mixes: this.pool.drain(minMass) };
  }

  confirmUpload(reportIds: Iterable<string>) {
    for (const id of reportIds) this.uploadedReports.add(id);
    for (const id of this.uploadedReports) if (!this.reports.has(id)) this.uploadedReports.delete(id);
  }

  restoreUpload(mixes: Mix[]) {
    for (const mix of mixes) this.pool.absorb(mix);
  }

  // ---- Keeping state across page loads ----

  snapshot(): NodeSnapshot {
    return {
      reports: this.reports.all(),
      model: this.model,
      mixes: this.pool.all(),
      examples: this.examples,
      contributedVersions: [...this.contributed],
      observed: this.observed,
      observedAtContribution: this.observedAtContribution,
      uploadedReportIds: [...this.uploadedReports],
      participate: this.participate,
    };
  }

  restore(snapshot: Partial<NodeSnapshot>) {
    const now = this.options.now();
    if (Array.isArray(snapshot.reports)) this.reports.add(snapshot.reports, now);
    if (isValidModel(snapshot.model)) this.model = snapshot.model;
    for (const mix of snapshot.mixes ?? []) if (isValidMix(mix, this.options.training)) this.pool.absorb(mix);
    if (Array.isArray(snapshot.examples)) this.examples = snapshot.examples.filter(isValidExample).slice(-MAX_EXAMPLES);
    this.restoreCounters(snapshot);
  }

  private restoreCounters(snapshot: Partial<NodeSnapshot>) {
    for (const version of snapshot.contributedVersions ?? []) if (Number.isInteger(version)) this.contributed.add(version);
    for (const id of snapshot.uploadedReportIds ?? []) if (typeof id === "string") this.uploadedReports.add(id);
    if (typeof snapshot.participate === "boolean") this.participate = snapshot.participate;
    if (Number.isInteger(snapshot.observed)) this.observed = snapshot.observed!;
    if (Number.isInteger(snapshot.observedAtContribution)) this.observedAtContribution = snapshot.observedAtContribution!;
  }
}

function isValidExample(value: unknown): value is Example {
  if (!isRecord(value)) return false;
  return (value.y === 0 || value.y === 1) && Array.isArray(value.x) && value.x.every((x) => typeof x === "number" && Number.isFinite(x));
}

// Runs a whole meeting between two phones held in memory: both say hello, then every reply is
// delivered until neither has anything left to say. Used by the simulation and the tests.
export function meet(a: MeshNode, b: MeshNode) {
  const results = { a: emptyResult(), b: emptyResult() };
  let toB: MeshMessage[] = [a.hello()];
  let toA: MeshMessage[] = [b.hello()];
  for (let round = 0; round < 4 && (toA.length > 0 || toB.length > 0); round++) {
    const nextToA = toB.flatMap((message) => b.receive(message, results.b));
    const nextToB = toA.flatMap((message) => a.receive(message, results.a));
    toA = nextToA;
    toB = nextToB;
  }
  return results;
}

export const emptyResult = (): MeetingResult => ({ reportsReceived: 0, modelUpdated: false, massReceived: 0 });
