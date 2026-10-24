import { gaussian, Random } from "../mesh/random";
import { DEFAULT_DEPARTURE, DepartureParams, stepDecision } from "./departure";
import { cellIndex, Ground, toXY } from "./grid";
import { blockedMask, isBurning, Potential, RoadRouter } from "./navigation";

// Evacuating households as particles under underdamped Langevin dynamics:
//
//   dx = v dt
//   dv = [ (v_des(x, rho) e(x) - v) / tau  +  F_rep(x) ] dt  +  sqrt(2 T / tau) dW
//
// e(x) is the unit direction to the next point on the driver's route (see navigation.ts), v_des
// the street's free speed slowed by local density (Greenshields: v_free (1 - rho / rho_jam)),
// F_rep a soft exponential repulsion between vehicles (Helbing and Molnar's social force), and T
// the variance of the velocity noise: hesitation and the spread in how people drive. Integration
// is BAOAB splitting (Leimkuhler and Matthews 2013): friction and noise are solved exactly, so the
// half-second step is stable.
//
// Each driver routes on the blockages it knows about. A driver that runs into a blocked street it
// didn't know about is stopped by it, learns it, turns back and re-routes. That knowledge is what
// the phone mesh spreads.

export const STATE = { home: 0, moving: 1, arrived: 2, overrun: 3, waiting: 4 } as const;
export type AgentState = (typeof STATE)[keyof typeof STATE];

export type Household = { lat: number; lng: number; peopleCount: number; canLeave: string; hasCar: boolean };

export type CrowdParams = {
  dt: number;
  tau: number;
  temperature: number;
  radius: number;
  repulsion: number;
  repulsionRange: number;
  jamDensity: number;
  refreshMinutes: number;
  safeLat: number;
  departure: DepartureParams;
};

export const DEFAULT_CROWD: CrowdParams = {
  dt: 0.5,
  tau: 2,
  temperature: 0.6,
  radius: 2.5,
  repulsion: 3,
  repulsionRange: 1.5,
  jamDensity: 0.02,
  refreshMinutes: 5,
  safeLat: 34.152,
  departure: DEFAULT_DEPARTURE,
};

const HASH_CELL = 10;
const DECISION_EVERY_SECONDS = 30;
const MIN_SPEED_SHARE = 0.05;
const BOUNCE_DAMPING = -0.2;
// A route point counts as reached within this many metres.
const REACH_METERS = 9;

// The exact Ornstein-Uhlenbeck update for friction 1/tau and velocity variance T over dt:
// v <- c1 v + c2 xi, with stationary variance T. This is the O in BAOAB.
export function ouCoefficients(dt: number, tau: number, temperature: number) {
  const c1 = Math.exp(-dt / tau);
  return { c1, c2: Math.sqrt(temperature * (1 - c1 * c1)) };
}

export type Discovery = { agent: number; segments: number[]; at: number };

export type CrowdStats = {
  minute: number;
  home: number;
  moving: number;
  arrived: number;
  waiting: number;
  overrun: number;
  meanSpeed: number;
  jammedShare: number;
  noRoute: number;
  discoveries: number;
  people: { arrived: number; waiting: number; overrun: number };
};

export class CrowdSim {
  readonly count: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  readonly state: Uint8Array;
  readonly keen: Uint8Array;
  readonly people: Uint16Array;
  readonly decision: Float64Array;
  readonly departedAt: Float64Array;
  readonly arrivedAt: Float64Array;
  // Route: the edge being driven (-1 while heading to `goal`, an intersection) and the shape point next on it.
  readonly edge: Int32Array;
  readonly point: Int32Array;
  readonly goal: Int32Array;
  readonly stuck: Uint8Array;
  readonly known: Set<number>[];
  readonly discoveries: Discovery[] = [];
  readonly router: RoadRouter;
  seconds = 0;
  discovered = 0;
  // Flow by street: cars that entered each segment, and speed samples taken on it every 30 s.
  readonly segmentEntries: Uint32Array;
  readonly segmentSpeedSum: Float64Array;
  readonly segmentSpeedSamples: Uint32Array;
  // Driving seconds lost to crowding on each segment: every sample counts 30 s times the share of
  // the street's free-flow speed the car didn't get.
  readonly segmentLostSeconds: Float64Array;

  private trueShut: Uint8Array;
  private trueBlocked = new Set<number>();
  private potentials = new Map<string, Potential>();
  private agentPotential: (Potential | null)[];
  private lastRefresh = -Infinity;
  private nextDecision = 0;
  private hashHead = new Map<number, number>();
  private hashNext: Int32Array;
  private hashKey: Int32Array;
  private hashCols: number;

  constructor(
    readonly ground: Ground,
    households: Household[],
    private readonly random: Random,
    private readonly blockedTruth: (minutes: number) => Set<number>,
    readonly params: CrowdParams = DEFAULT_CROWD,
  ) {
    this.count = households.length;
    const n = this.count;
    [this.x, this.y, this.vx, this.vy, this.fx, this.fy] = Array.from({ length: 6 }, () => new Float64Array(n));
    this.state = new Uint8Array(n);
    this.keen = new Uint8Array(n);
    this.people = new Uint16Array(n);
    this.decision = new Float64Array(n);
    this.departedAt = new Float64Array(n).fill(NaN);
    this.arrivedAt = new Float64Array(n).fill(NaN);
    this.edge = new Int32Array(n).fill(-1);
    this.point = new Int32Array(n);
    this.goal = new Int32Array(n);
    this.stuck = new Uint8Array(n);
    this.known = Array.from({ length: n }, () => new Set<number>());
    this.agentPotential = Array(n).fill(null);
    this.hashNext = new Int32Array(n);
    this.hashKey = new Int32Array(n);
    this.hashCols = Math.ceil((ground.cols * ground.cell) / HASH_CELL) + 1;
    this.router = new RoadRouter(ground, params.safeLat);
    this.segmentEntries = new Uint32Array(ground.segments.length);
    this.segmentSpeedSum = new Float64Array(ground.segments.length);
    this.segmentSpeedSamples = new Uint32Array(ground.segments.length);
    this.segmentLostSeconds = new Float64Array(ground.segments.length);
    for (const [i, household] of households.entries()) {
      [this.x[i], this.y[i]] = toXY(household);
      this.people[i] = Math.max(1, household.peopleCount);
      this.keen[i] = random() < params.departure.keenShare ? 1 : 0;
      this.state[i] = household.canLeave === "yes" && household.hasCar ? STATE.home : STATE.waiting;
      this.goal[i] = this.router.nearestNode(this.x[i], this.y[i]);
    }
    this.trueShut = new Uint8Array(ground.speed.length);
  }

  get minutes() {
    return this.seconds / 60;
  }

  // Adds to what a driver believes is blocked, for example from reports its phone received.
  setKnown(agent: number, segments: Iterable<number>) {
    const known = this.known[agent];
    const before = known.size;
    for (const segment of segments) known.add(segment);
    if (known.size === before) return;
    this.agentPotential[agent] = null;
    const edge = this.edge[agent];
    if (edge >= 0 && known.has(this.router.edgeSegment[edge])) {
      // The street ahead is blocked: turn back to the last intersection and choose again there.
      this.edge[agent] = -1;
      this.goal[agent] = this.router.edgeStart(edge);
    }
  }

  trulyBlocked(): ReadonlySet<number> {
    return this.trueBlocked;
  }

  // Reads `blockedTruth` again on the next step instead of at the next scheduled refresh.
  refreshBlockages() {
    this.lastRefresh = -Infinity;
  }

  // A copy that carries on from exactly this state with its own noise, for running ahead of the
  // present: the copy and this simulation evolve independently from here. The ground, router,
  // parameters and cached route potentials are read-only and shared.
  fork(random: Random): CrowdSim {
    const copy = Object.create(CrowdSim.prototype) as CrowdSim;
    return Object.assign(copy, this, {
      random,
      x: this.x.slice(),
      y: this.y.slice(),
      vx: this.vx.slice(),
      vy: this.vy.slice(),
      fx: this.fx.slice(),
      fy: this.fy.slice(),
      state: this.state.slice(),
      decision: this.decision.slice(),
      departedAt: this.departedAt.slice(),
      arrivedAt: this.arrivedAt.slice(),
      edge: this.edge.slice(),
      point: this.point.slice(),
      goal: this.goal.slice(),
      stuck: this.stuck.slice(),
      known: this.known.map((segments) => new Set(segments)),
      discoveries: [...this.discoveries],
      segmentEntries: this.segmentEntries.slice(),
      segmentSpeedSum: this.segmentSpeedSum.slice(),
      segmentSpeedSamples: this.segmentSpeedSamples.slice(),
      segmentLostSeconds: this.segmentLostSeconds.slice(),
      trueShut: this.trueShut.slice(),
      trueBlocked: new Set(this.trueBlocked),
      potentials: new Map(this.potentials),
      agentPotential: [...this.agentPotential],
      hashHead: new Map<number, number>(),
      hashNext: new Int32Array(this.count),
      hashKey: new Int32Array(this.count),
    });
  }

  step() {
    this.refreshIfDue();
    if (this.seconds >= this.nextDecision) {
      this.decideDepartures(DECISION_EVERY_SECONDS / 60);
      this.sampleFlow();
      this.nextDecision = this.seconds + DECISION_EVERY_SECONDS;
    }
    const { dt, tau, temperature } = this.params;
    const { c1, c2 } = ouCoefficients(dt, tau, temperature);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === STATE.moving) this.kickDriftNoiseDrift(i, dt, c1, c2);
    }
    this.computeForces();
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== STATE.moving) continue;
      this.vx[i] += (this.fx[i] * dt) / 2;
      this.vy[i] += (this.fy[i] * dt) / 2;
    }
    this.seconds += dt;
    this.settle();
  }

  // B, A, O, A of BAOAB, with a reflecting wall at cells a car actually can't enter.
  private kickDriftNoiseDrift(i: number, dt: number, c1: number, c2: number) {
    this.vx[i] += (this.fx[i] * dt) / 2;
    this.vy[i] += (this.fy[i] * dt) / 2;
    let x = this.x[i] + (this.vx[i] * dt) / 2;
    let y = this.y[i] + (this.vy[i] * dt) / 2;
    this.vx[i] = c1 * this.vx[i] + c2 * gaussian(this.random);
    this.vy[i] = c1 * this.vy[i] + c2 * gaussian(this.random);
    x += (this.vx[i] * dt) / 2;
    y += (this.vy[i] * dt) / 2;
    const cell = cellIndex(this.ground, x, y);
    if (cell < 0 || this.trueShut[cell] || isBurning(this.ground, cell, this.minutes)) {
      this.bounce(i, cell);
      return;
    }
    this.x[i] = x;
    this.y[i] = y;
  }

  private bounce(i: number, cell: number) {
    this.vx[i] *= BOUNCE_DAMPING;
    this.vy[i] *= BOUNCE_DAMPING;
    if (cell < 0 || !this.trueShut[cell]) return;
    const onCell = [...this.ground.segmentsAt[cell]].filter((s) => this.trueBlocked.has(s));
    const blocked = onCell.length > 0 ? onCell : this.blockedNear(cell);
    const unknown = blocked.filter((s) => !this.known[i].has(s));
    if (unknown.length === 0) return;
    this.discovered += 1;
    this.setKnown(i, unknown);
    this.discoveries.push({ agent: i, segments: unknown, at: this.seconds });
  }

  // An off-road cell is shut because a blocked street runs beside it; find that street.
  private blockedNear(cell: number) {
    const { cols } = this.ground;
    const found = new Set<number>();
    for (const offset of [-1, 1, -cols, cols, -cols - 1, -cols + 1, cols - 1, cols + 1]) {
      for (const s of this.ground.segmentsAt[cell + offset] ?? []) if (this.trueBlocked.has(s)) found.add(s);
    }
    return [...found];
  }

  private refreshIfDue() {
    if (this.minutes - this.lastRefresh < this.params.refreshMinutes) return;
    this.lastRefresh = this.minutes;
    this.trueBlocked = this.blockedTruth(this.minutes);
    this.trueShut = blockedMask(this.ground, this.trueBlocked);
    this.potentials = new Map();
    this.agentPotential.fill(null);
  }

  private potentialFor(i: number): Potential {
    const cached = this.agentPotential[i];
    if (cached) return cached;
    const known = this.known[i];
    const key = [...known].sort((a, b) => a - b).join(",");
    let potential = this.potentials.get(key);
    if (!potential) {
      potential = this.router.potential(this.minutes, known);
      this.potentials.set(key, potential);
    }
    this.agentPotential[i] = potential;
    return potential;
  }

  // ---- Following the route ----

  private target(i: number): [number, number] {
    const edge = this.edge[i];
    if (edge < 0) return [this.router.nodeX[this.goal[i]], this.router.nodeY[this.goal[i]]];
    const shape = this.router.edgeShape[edge];
    const p = Math.min(this.point[i], shape.length / 2 - 1);
    return [shape[2 * p], shape[2 * p + 1]];
  }

  private advanceRoute(i: number) {
    for (let hops = 0; hops < 4 && this.state[i] === STATE.moving; hops++) {
      const [tx, ty] = this.target(i);
      if (Math.hypot(tx - this.x[i], ty - this.y[i]) > REACH_METERS) return;
      const edge = this.edge[i];
      if (edge < 0) {
        this.chooseAt(i, this.goal[i]);
        if (this.stuck[i]) return;
        continue;
      }
      this.point[i] += 1;
      if (this.point[i] * 2 >= this.router.edgeShape[edge].length) this.chooseAt(i, this.router.edgeEnd(edge));
    }
  }

  private chooseAt(i: number, node: number) {
    if (this.router.safe[node]) {
      this.state[i] = STATE.arrived;
      this.arrivedAt[i] = this.seconds;
      this.vx[i] = 0;
      this.vy[i] = 0;
      return;
    }
    const next = this.router.nextEdge(node, this.potentialFor(i), this.known[i]);
    this.stuck[i] = next < 0 ? 1 : 0;
    if (next >= 0 && this.router.edgeSegment[next] >= 0) this.segmentEntries[this.router.edgeSegment[next]] += 1;
    this.edge[i] = next;
    this.goal[i] = node;
    this.point[i] = 1;
  }

  private sampleFlow() {
    for (let i = 0; i < this.count; i++) {
      const edge = this.edge[i];
      if (this.state[i] !== STATE.moving || edge < 0) continue;
      const segment = this.router.edgeSegment[edge];
      if (segment < 0) continue;
      const speed = Math.hypot(this.vx[i], this.vy[i]);
      this.segmentSpeedSum[segment] += speed;
      this.segmentSpeedSamples[segment] += 1;
      const freeSpeed = this.ground.segments[segment].kph / 3.6;
      if (freeSpeed > 0) this.segmentLostSeconds[segment] += DECISION_EVERY_SECONDS * Math.max(0, 1 - speed / freeSpeed);
    }
  }

  // Streets where the most driving time was lost to crowding: cars through it times the share of
  // free-flow speed they didn't get.
  bottlenecks(limit = 10) {
    const rows: { segment: number; entries: number; meanSpeed: number; freeSpeed: number; slowdown: number }[] = [];
    for (let segment = 0; segment < this.segmentEntries.length; segment++) {
      const samples = this.segmentSpeedSamples[segment];
      if (samples < 5) continue;
      const meanSpeed = this.segmentSpeedSum[segment] / samples;
      const freeSpeed = this.ground.segments[segment].kph / 3.6;
      const slowdown = Math.max(0, 1 - meanSpeed / freeSpeed);
      rows.push({ segment, entries: this.segmentEntries[segment], meanSpeed, freeSpeed, slowdown });
    }
    return rows.sort((a, b) => b.entries * b.slowdown - a.entries * a.slowdown).slice(0, limit);
  }

  private decideDepartures(minutes: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== STATE.home) continue;
      const toFire = this.fireMinutesAt(i) - this.minutes;
      this.decision[i] = stepDecision(this.decision[i], this.keen[i] === 1, toFire, minutes, this.params.departure, this.random);
      if (this.decision[i] < 1) continue;
      this.state[i] = STATE.moving;
      this.departedAt[i] = this.seconds;
    }
  }

  private fireMinutesAt(i: number) {
    const cell = cellIndex(this.ground, this.x[i], this.y[i]);
    return cell < 0 ? Infinity : this.ground.fireMinutes[cell];
  }

  // ---- Forces ----

  private hashOf(x: number, y: number) {
    const col = Math.max(0, Math.floor((x - this.ground.x0) / HASH_CELL));
    const row = Math.max(0, Math.floor((y - this.ground.y0) / HASH_CELL));
    return row * this.hashCols + col;
  }

  private rebuildHash() {
    this.hashHead.clear();
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== STATE.moving) continue;
      const key = this.hashOf(this.x[i], this.y[i]);
      this.hashKey[i] = key;
      this.hashNext[i] = this.hashHead.get(key) ?? -1;
      this.hashHead.set(key, i);
    }
  }

  private computeForces() {
    this.rebuildHash();
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== STATE.moving) continue;
      this.advanceRoute(i);
      if (this.state[i] === STATE.moving) this.forceOn(i);
    }
  }

  private repulsionOn(i: number): [number, number, number] {
    const { radius, repulsion, repulsionRange } = this.params;
    const reach = 2 * radius + 4 * repulsionRange;
    let rx = 0;
    let ry = 0;
    let neighbors = 0;
    const key = this.hashKey[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (let j = this.hashHead.get(key + dr * this.hashCols + dc) ?? -1; j !== -1; j = this.hashNext[j]) {
          if (j === i) continue;
          neighbors += 1;
          const dx = this.x[i] - this.x[j];
          const dy = this.y[i] - this.y[j];
          const d = Math.hypot(dx, dy);
          if (d >= reach || d < 1e-6) continue;
          const push = repulsion * Math.exp((2 * radius - d) / repulsionRange);
          rx += (push * dx) / d;
          ry += (push * dy) / d;
        }
      }
    }
    return [rx, ry, neighbors];
  }

  private forceOn(i: number) {
    const [rx, ry, neighbors] = this.repulsionOn(i);
    const density = (neighbors + 1) / (9 * HASH_CELL * HASH_CELL);
    const edge = this.edge[i];
    const cell = cellIndex(this.ground, this.x[i], this.y[i]);
    const free = this.stuck[i] ? 0 : edge >= 0 ? this.router.edgeSpeed[edge] : cell < 0 ? 0 : this.ground.speed[cell];
    const desired = free * Math.max(MIN_SPEED_SHARE, 1 - density / this.params.jamDensity);
    const [tx, ty] = this.target(i);
    const distance = Math.hypot(tx - this.x[i], ty - this.y[i]) || 1;
    this.fx[i] = (desired * (tx - this.x[i])) / distance / this.params.tau + rx;
    this.fy[i] = (desired * (ty - this.y[i])) / distance / this.params.tau + ry;
  }

  // Anyone the scenario fire reaches before they get out.
  private settle() {
    const minutes = this.minutes;
    for (let i = 0; i < this.count; i++) {
      const state = this.state[i];
      if (state === STATE.arrived || state === STATE.overrun) continue;
      const cell = cellIndex(this.ground, this.x[i], this.y[i]);
      if (cell >= 0 && isBurning(this.ground, cell, minutes)) this.state[i] = STATE.overrun;
    }
  }

  stats(): CrowdStats {
    const counts = [0, 0, 0, 0, 0];
    const people = [0, 0, 0, 0, 0];
    let speedSum = 0;
    let jammed = 0;
    let noRoute = 0;
    for (let i = 0; i < this.count; i++) {
      counts[this.state[i]] += 1;
      people[this.state[i]] += this.people[i];
      if (this.state[i] !== STATE.moving) continue;
      const speed = Math.hypot(this.vx[i], this.vy[i]);
      speedSum += speed;
      if (speed < 1) jammed += 1;
      if (this.stuck[i]) noRoute += 1;
    }
    const moving = counts[STATE.moving];
    return {
      minute: this.minutes,
      home: counts[STATE.home],
      moving,
      arrived: counts[STATE.arrived],
      waiting: counts[STATE.waiting],
      overrun: counts[STATE.overrun],
      meanSpeed: moving ? speedSum / moving : 0,
      jammedShare: moving ? jammed / moving : 0,
      noRoute,
      discoveries: this.discovered,
      people: { arrived: people[STATE.arrived], waiting: people[STATE.waiting], overrun: people[STATE.overrun] },
    };
  }

  // Minutes from leaving home to reaching safety, for every household that made it.
  travelMinutes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) if (this.state[i] === STATE.arrived) out.push((this.arrivedAt[i] - this.departedAt[i]) / 60);
    return out;
  }
}
