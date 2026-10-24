import { cellIndex, Ground } from "../crowd/grid";
import { CrowdParams, CrowdSim, DEFAULT_CROWD, Household, STATE } from "../crowd/langevin";
import { Agency } from "../mesh/agency";
import { DEFAULT_OPTIMIZER, ROUND_MASS, ServerOptimizer } from "../mesh/rounds";
import { auc, DEFAULT_TRAINING, Example, fitCentrally, INITIAL_MODEL, logLoss, TrainingParams, UPLOAD_MIN_MASS } from "../mesh/federated";
import { meet, MeshNode } from "../mesh/node";
import { Random, seededIds, seededRandom } from "../mesh/random";
import { BlockageWorld } from "./blockage";

// A simulated night that ties the three pieces together. Households evacuate under the Langevin
// crowd model; their phones see the streets they pass, tell nearby phones over a short-range
// radio, and train the shared blockage model; phones that get internet (a few in the zone, and
// everyone who reaches safety) upload to the agency. Drivers route on what their phone knows.
// Everything here is simulation with stated assumptions, not a prediction about real people.

export const WARNING_AT = Date.UTC(2025, 0, 8, 11, 25);

export type WorldParams = {
  seed: number;
  // Phones talk to each other. Off: each phone knows only what it saw itself.
  mesh: boolean;
  phoneShare: number;
  participateShare: number;
  // Phones willing to act as a gateway (upload for others) when they have internet.
  gatewayShare: number;
  // Phones in the zone that sometimes have mobile data, and the chance they do at a given check.
  cellularShare: number;
  cellularUpChance: number;
  radioMeters: number;
  meetCooldownMinutes: number;
  meshTickSeconds: number;
  uploadEveryMinutes: number;
  homeObserveEveryMinutes: number;
  // Share of phones already at the shelter that meet another phone there each mesh tick.
  shelterMeetShare: number;
  roundMass: number;
  optimizer: ServerOptimizer;
  training: TrainingParams;
  crowd: CrowdParams;
};

export const DEFAULT_WORLD: WorldParams = {
  seed: 7,
  mesh: true,
  phoneShare: 0.92,
  participateShare: 0.8,
  gatewayShare: 0.25,
  cellularShare: 0.08,
  cellularUpChance: 0.3,
  radioMeters: 40,
  meetCooldownMinutes: 10,
  meshTickSeconds: 30,
  uploadEveryMinutes: 2,
  homeObserveEveryMinutes: 15,
  shelterMeetShare: 0.2,
  roundMass: ROUND_MASS,
  optimizer: DEFAULT_OPTIMIZER,
  training: DEFAULT_TRAINING,
  crowd: DEFAULT_CROWD,
};

export type Checkpoint = {
  minute: number;
  crowd: ReturnType<CrowdSim["stats"]>;
  trulyBlocked: number;
  agencyKnowsBlocked: number;
  agencyWrongBlocked: number;
  // Truly blocked streets that at least one phone believes blocked: what the agency could know.
  phonesKnowBlocked: number;
  phonesKnowingABlockage: number;
  reports: number;
  meetings: number;
  modelVersion: number;
  massUploaded: number;
  auc: { shared: number; initial: number; pooled: number };
  logLoss: { shared: number; pooled: number };
};

const HASH_METERS = 40;

export class FlowWorld {
  readonly crowd: CrowdSim;
  readonly blockage: BlockageWorld;
  readonly agency: Agency;
  readonly nodes: (MeshNode | null)[];
  readonly timeline: Checkpoint[] = [];
  meetings = 0;
  massUploaded = 0;
  private readonly random: Random;
  private readonly segmentIndex = new Map<string, number>();
  private readonly gateway: Uint8Array;
  private readonly cellular: Uint8Array;
  private readonly homeSegments: Int32Array[];
  private readonly lastPair = new Map<number, number>();
  private readonly beliefCache = new Map<number, { revision: number; blocked: Set<number> }>();
  private lastObserved: Map<number, number>[];
  private nextMesh = 0;
  private nextUpload = 0;
  private nextHomeObserve = 0;
  private agencyKnown = new Set<number>();
  private agencyWrong = 0;
  private agencyRevision = -1;

  constructor(
    readonly ground: Ground,
    households: Household[],
    readonly params: WorldParams = DEFAULT_WORLD,
  ) {
    this.random = seededRandom(params.seed);
    this.blockage = new BlockageWorld(ground, seededRandom(params.seed + 1));
    ground.segments.forEach((segment, i) => this.segmentIndex.set(segment.key, i));
    this.crowd = new CrowdSim(ground, households, seededRandom(params.seed + 2), (minutes) => this.blockage.blockedAt(minutes), params.crowd);
    this.agency = new Agency(params.roundMass, params.optimizer);
    const ids = seededIds(seededRandom(params.seed + 3));
    this.nodes = households.map(() => {
      if (this.random() >= params.phoneShare) return null;
      const random = seededRandom(Math.floor(this.random() * 2 ** 31));
      return new MeshNode({ newId: ids, random, now: () => this.now(), participate: this.random() < params.participateShare, training: params.training });
    });
    this.gateway = Uint8Array.from(households, () => (this.random() < params.gatewayShare ? 1 : 0));
    this.cellular = Uint8Array.from(households, () => (this.random() < params.cellularShare ? 1 : 0));
    this.homeSegments = households.map((_, i) => this.segmentsAround(this.crowd.x[i], this.crowd.y[i]));
    this.lastObserved = households.map(() => new Map());
  }

  now() {
    return WARNING_AT + this.crowd.seconds * 1000;
  }

  get minutes() {
    return this.crowd.minutes;
  }

  segmentKey(index: number) {
    return this.ground.segments[index].key;
  }

  private segmentsAround(x: number, y: number) {
    const found = new Set<number>();
    const cell = this.ground.cell;
    for (const [dx, dy] of [[0, 0], [cell, 0], [-cell, 0], [0, cell], [0, -cell]]) {
      const index = cellIndex(this.ground, x + dx, y + dy);
      if (index >= 0) for (const s of this.ground.segmentsAt[index]) found.add(s);
    }
    return Int32Array.from(found);
  }

  // Segment indices this phone's reports say are blocked, cached per report-store revision.
  believedBlocked(agent: number): Set<number> {
    const node = this.nodes[agent];
    if (!node) return this.crowd.known[agent];
    const cached = this.beliefCache.get(agent);
    if (cached && cached.revision === node.reports.revision) return cached.blocked;
    const blocked = new Set<number>();
    for (const key of node.reports.blockedSegments(this.now())) {
      const index = this.segmentIndex.get(key);
      if (index !== undefined) blocked.add(index);
    }
    this.beliefCache.set(agent, { revision: node.reports.revision, blocked });
    return blocked;
  }

  step() {
    this.crowd.step();
    const seconds = this.crowd.seconds;
    if (seconds < this.nextMesh) return;
    this.nextMesh = seconds + this.params.meshTickSeconds;
    this.handleDiscoveries();
    this.observeFromVehicles();
    if (seconds >= this.nextHomeObserve) {
      this.observeFromHomes();
      this.nextHomeObserve = seconds + this.params.homeObserveEveryMinutes * 60;
    }
    if (this.params.mesh) {
      this.meetNearby();
      this.meetAtShelter();
    }
    if (seconds >= this.nextUpload) {
      this.uploadFromOnlinePhones();
      this.nextUpload = seconds + this.params.uploadEveryMinutes * 60;
    }
    this.shareBeliefsWithDrivers();
  }

  run(minutes: number, checkpointEvery = 15, onCheckpoint?: (checkpoint: Checkpoint) => void) {
    const steps = Math.round((minutes * 60) / this.params.crowd.dt);
    const every = Math.round((checkpointEvery * 60) / this.params.crowd.dt);
    for (let k = 1; k <= steps; k++) {
      this.step();
      if (k % every !== 0) continue;
      const checkpoint = this.checkpoint();
      onCheckpoint?.(checkpoint);
    }
  }

  // ---- What phones see ----

  private see(agent: number, segment: number, blocked: boolean) {
    const node = this.nodes[agent];
    if (!node) return;
    const minutes = this.minutes;
    const belief = this.believedBlocked(agent);
    const share = this.blockage.nearbyShare(segment, (s) => belief.has(s));
    node.observe({ x: this.blockage.features(segment, minutes, share), y: blocked ? 1 : 0 });
    const consensus = node.reports.consensus(this.segmentKey(segment), this.now()).status;
    const status = blocked ? "blocked" : "clear";
    if (consensus === status || (consensus === "unknown" && !blocked)) return;
    node.report(this.segmentKey(segment), status, blocked ? this.causeFor(segment) : undefined);
  }

  private causeFor(segment: number) {
    return this.blockage.minutesToFire(segment, this.minutes) <= 0 ? "fire" : "debris";
  }

  private handleDiscoveries() {
    for (const discovery of this.crowd.discoveries.splice(0)) {
      for (const segment of discovery.segments) this.see(discovery.agent, segment, true);
    }
  }

  private observeFromVehicles() {
    const truth = this.crowd.trulyBlocked();
    for (let i = 0; i < this.crowd.count; i++) {
      if (this.crowd.state[i] !== STATE.moving || !this.nodes[i]) continue;
      const cell = cellIndex(this.ground, this.crowd.x[i], this.crowd.y[i]);
      if (cell < 0) continue;
      for (const segment of this.ground.segmentsAt[cell]) {
        const last = this.lastObserved[i].get(segment);
        if (last !== undefined && this.minutes - last < 30) continue;
        this.lastObserved[i].set(segment, this.minutes);
        this.see(i, segment, truth.has(segment));
      }
    }
  }

  private observeFromHomes() {
    const truth = this.crowd.trulyBlocked();
    for (let i = 0; i < this.crowd.count; i++) {
      const state = this.crowd.state[i];
      if ((state !== STATE.home && state !== STATE.waiting) || !this.nodes[i]) continue;
      for (const segment of this.homeSegments[i]) this.see(i, segment, truth.has(segment));
    }
  }

  // ---- Phones meeting phones ----

  private inZone(i: number) {
    const state = this.crowd.state[i];
    return state === STATE.home || state === STATE.moving || state === STATE.waiting;
  }

  private meetNearby() {
    const buckets = new Map<number, number[]>();
    const cols = Math.ceil((this.ground.cols * this.ground.cell) / HASH_METERS) + 1;
    const keyOf = (i: number) =>
      Math.floor((this.crowd.y[i] - this.ground.y0) / HASH_METERS) * cols + Math.floor((this.crowd.x[i] - this.ground.x0) / HASH_METERS);
    for (let i = 0; i < this.crowd.count; i++) {
      if (!this.nodes[i] || !this.inZone(i)) continue;
      const key = keyOf(i);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(i);
      else buckets.set(key, [i]);
    }
    for (const [key, members] of buckets) {
      for (const neighbourKey of [key, key + 1, key + cols - 1, key + cols, key + cols + 1]) {
        const others = neighbourKey === key ? members : buckets.get(neighbourKey);
        if (others) this.meetBetween(members, others, neighbourKey === key);
      }
    }
  }

  private meetBetween(members: number[], others: number[], same: boolean) {
    const cooldown = this.params.meetCooldownMinutes;
    const range = this.params.radioMeters;
    for (const [mi, i] of members.entries()) {
      for (let oj = same ? mi + 1 : 0; oj < others.length; oj++) {
        const j = others[oj];
        if (Math.hypot(this.crowd.x[i] - this.crowd.x[j], this.crowd.y[i] - this.crowd.y[j]) > range) continue;
        const pair = Math.min(i, j) * this.crowd.count + Math.max(i, j);
        const last = this.lastPair.get(pair);
        if (last !== undefined && this.minutes - last < cooldown) continue;
        this.lastPair.set(pair, this.minutes);
        this.meetPhones(i, j);
      }
    }
  }

  private meetPhones(i: number, j: number) {
    meet(this.nodes[i]!, this.nodes[j]!);
    this.meetings += 1;
  }

  // People who reached the shelter are in one room; a share of them meet someone each tick.
  private meetAtShelter() {
    const there: number[] = [];
    for (let i = 0; i < this.crowd.count; i++) if (this.nodes[i] && this.crowd.state[i] === STATE.arrived) there.push(i);
    const meetings = Math.floor((there.length * this.params.shelterMeetShare) / 2);
    for (let k = 0; k < meetings; k++) {
      const i = there[Math.floor(this.random() * there.length)];
      const j = there[Math.floor(this.random() * there.length)];
      if (i !== j) this.meetPhones(i, j);
    }
  }

  // ---- Phones with internet ----

  private isOnline(i: number) {
    if (this.crowd.state[i] === STATE.arrived) return true;
    return this.cellular[i] === 1 && this.inZone(i) && this.random() < this.params.cellularUpChance;
  }

  private uploadFromOnlinePhones() {
    const now = this.now();
    for (let i = 0; i < this.crowd.count; i++) {
      const node = this.nodes[i];
      if (!node) continue;
      const online = this.isOnline(i);
      node.sink = online && this.gateway[i] === 1;
      if (!online) continue;
      // Only a gateway uploads mixes; any phone online uploads its road reports.
      const upload = node.takeUpload(node.sink ? UPLOAD_MIN_MASS : Infinity);
      this.agency.uploadReports(upload.reports, now);
      node.confirmUpload(upload.reports.map((r) => r.id));
      for (const mix of upload.mixes) if (this.agency.uploadMix(mix, now)) this.massUploaded += mix.mass;
      node.adoptModel(this.agency.model);
    }
  }

  private shareBeliefsWithDrivers() {
    for (let i = 0; i < this.crowd.count; i++) {
      if (this.crowd.state[i] !== STATE.moving && this.crowd.state[i] !== STATE.home) continue;
      if (this.nodes[i]) this.crowd.setKnown(i, this.believedBlocked(i));
    }
  }

  // ---- Measuring ----

  private refreshAgencyKnowledge() {
    const count = this.agency.reportCount();
    if (count === this.agencyRevision) return;
    this.agencyRevision = count;
    const truth = this.crowd.trulyBlocked();
    this.agencyKnown = new Set();
    this.agencyWrong = 0;
    for (const consensus of this.agency.consensus(this.now()).values()) {
      if (consensus.status !== "blocked") continue;
      const index = this.segmentIndex.get(consensus.segment);
      if (index === undefined) continue;
      if (truth.has(index)) this.agencyKnown.add(index);
      else this.agencyWrong += 1;
    }
  }

  // Held-out segments at this minute, with the nearby share the agency itself would use.
  holdout(size = 800): Example[] {
    const random = seededRandom(Math.floor(this.minutes) + 99);
    const truth = this.crowd.trulyBlocked();
    return Array.from({ length: size }, () => {
      const segment = Math.floor(random() * this.ground.segments.length);
      const share = this.blockage.nearbyShare(segment, (s) => this.agencyKnown.has(s));
      return { x: this.blockage.features(segment, this.minutes, share), y: truth.has(segment) ? 1 : 0 };
    });
  }

  // The same model trained centrally on every phone's raw examples, without privacy: the ceiling.
  pooledModel() {
    const examples = this.nodes.flatMap((node) => node?.examples ?? []);
    return fitCentrally(examples);
  }

  checkpoint(): Checkpoint {
    this.refreshAgencyKnowledge();
    const holdout = this.holdout();
    const pooled = this.pooledModel();
    const shared = this.agency.model.weights;
    let knowing = 0;
    const seen = new Set<number>();
    const truth = this.crowd.trulyBlocked();
    for (let i = 0; i < this.crowd.count; i++) {
      if (!this.nodes[i]) continue;
      const believed = this.believedBlocked(i);
      if (believed.size > 0) knowing += 1;
      for (const segment of believed) if (truth.has(segment)) seen.add(segment);
    }
    const checkpoint: Checkpoint = {
      minute: Math.round(this.minutes),
      crowd: this.crowd.stats(),
      trulyBlocked: this.crowd.trulyBlocked().size,
      agencyKnowsBlocked: this.agencyKnown.size,
      agencyWrongBlocked: this.agencyWrong,
      phonesKnowBlocked: seen.size,
      phonesKnowingABlockage: knowing,
      reports: this.agency.reportCount(),
      meetings: this.meetings,
      modelVersion: this.agency.model.version,
      massUploaded: this.massUploaded,
      auc: { shared: auc(shared, holdout), initial: auc(INITIAL_MODEL.weights, holdout), pooled: auc(pooled, holdout) },
      logLoss: { shared: logLoss(shared, holdout), pooled: logLoss(pooled, holdout) },
    };
    this.timeline.push(checkpoint);
    return checkpoint;
  }
}
