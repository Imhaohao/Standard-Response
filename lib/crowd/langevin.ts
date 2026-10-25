import { gaussian, Random } from "../mesh/random";
import { DEFAULT_DEPARTURE, DepartureParams, stepDecision } from "./departure";
import { cellIndex, Ground, toXY } from "./grid";
import { blockedMask, isBurning, JAM_SPACING_METERS, MIN_SPEED_SHARE, Potential, RoadRouter } from "./navigation";

// Evacuating households as particles under underdamped Langevin dynamics, written in each car's
// frame: along its heading e(x) (subscript a) and across it (c):
//
//   dx   = v dt
//   dv_a = [ (v_des - v_a) / tau  +  lambda w (v_lead - v)_a  +  F_rep,a ] dt  +  sqrt(2 s T / tau) dW_a
//   dv_c = [ -v_c / tau_c  -  k_lane d_c  +  F_rep,c ] dt                     +  sqrt(2 s T_c / tau_c) dW_c
//
// e(x) aims at a point a little way ahead on the driver's street (pure pursuit; the route is in
// navigation.ts). v_des is the street's free speed slowed by the road ahead (Greenshields:
// v_free (1 - k / k_jam)), with k read from the gap to the nearest car ahead going the same way and
// k_jam the route choice's 7.5 m of lane per car; s = v_des / v_free is the driver's pace. lambda
// matches the speed of that car ahead (the full velocity difference model), weighted by how near
// it is (w). F_rep is a soft exponential repulsion between vehicles (Helbing and Molnar's social
// force), felt from the car ahead and barely from the car behind, settled by right of way where two
// cars' paths cross, kept only in part across the heading, capped at hard braking, and never
// strong enough to reverse a car. k_lane holds a car to its street's line, d_c being how far off
// it is. T is the variance of the velocity noise for a driver with open road: hesitation and the
// spread in how people drive. It scales with pace, so a car standing in a jam doesn't jitter.
// Integration is BAOAB splitting (Leimkuhler and Matthews 2013): friction and noise are solved
// exactly on each axis, so the half-second step is stable.
//
// So a queue's front car, with open road ahead, pulls away at speed, nobody is pushed along by the
// car behind, cars keep to their lane, and a lane discharges a queue at about 1,800 cars an hour,
// a real lane's saturation flow.
//
// Each driver routes on the blockages it knows about and on how crowded the streets were at the
// last refresh, and picks among near-equal streets at random (see navigation.ts). A driver that runs into a blocked street it
// didn't know about is stopped by it, learns it, turns back and re-routes. That knowledge is what
// the phone mesh spreads.

export const STATE = { home: 0, moving: 1, arrived: 2, overrun: 3, waiting: 4 } as const;
export type AgentState = (typeof STATE)[keyof typeof STATE];

export type Household = { lat: number; lng: number; peopleCount: number; canLeave: string; hasCar: boolean };

export type CrowdParams = {
  dt: number;
  // Relaxation time and velocity noise variance along the heading. The variance is for a driver
  // with open road; it scales with the share of free speed the driver wants, so a car standing in
  // a jam doesn't jitter (and the queue ahead can't ratchet that jitter into creeping backwards).
  tau: number;
  temperature: number;
  // The same across the heading: a driver holds its lane more tightly than its speed.
  lateralTau: number;
  lateralTemperature: number;
  // How far ahead on the street a driver steers for, in metres.
  pursuitMeters: number;
  // Pull back toward the street's line per metre off it, m/s² per m. Unlike steering, this holds a
  // car in its lane when it is standing still in a jam.
  laneStiffness: number;
  radius: number;
  repulsion: number;
  repulsionRange: number;
  // Weight of a car directly behind in the repulsion, against 1 for a car directly ahead, with
  // (1 + cos) / 2 between (Helbing and Molnar's anisotropy). Drivers brake for what they see
  // ahead; the car behind doesn't push them.
  repulsionBehind: number;
  // Share of the repulsion kept across the heading. Cars beside each other are in different lanes
  // and don't shove each other into the yards; along the heading the repulsion is kept whole.
  lateralRepulsion: number;
  // The largest acceleration repulsion can give, m/s²: about the hardest a car can brake.
  maxRepulsion: number;
  // Drivers match the speed of the car ahead (the full velocity difference model, Jiang, Wu and
  // Zhu 2001): this much acceleration per m/s of difference, s⁻¹. It damps the stop-and-go waves
  // that following on the gap alone sets off.
  speedMatching: number;
  // How far ahead a driver reads the road's density, in metres. Gaps past half of it count for
  // less, down to free flow at the full distance.
  lookAhead: number;
  refreshMinutes: number;
  // Logit spread of route choice in seconds: a street whose route is this much slower than the
  // fastest is taken 1/e as often. 0 always takes the fastest.
  routeSpreadSeconds: number;
  // Share of the previous count of cars on each street kept at each refresh, so routes don't all
  // swing to the same alternative at once.
  congestionMemory: number;
  safeLat: number;
  departure: DepartureParams;
};

export const DEFAULT_CROWD: CrowdParams = {
  dt: 0.5,
  tau: 2,
  temperature: 0.6,
  lateralTau: 0.5,
  lateralTemperature: 0.15,
  pursuitMeters: 15,
  laneStiffness: 0.5,
  radius: 2.5,
  repulsion: 3,
  repulsionRange: 1.5,
  repulsionBehind: 0.1,
  lateralRepulsion: 0.3,
  maxRepulsion: 8,
  speedMatching: 0.5,
  lookAhead: 20,
  refreshMinutes: 5,
  routeSpreadSeconds: 60,
  congestionMemory: 0.5,
  safeLat: 34.152,
  departure: DEFAULT_DEPARTURE,
};

// At least the look-ahead, so the 3 x 3 cells around a car hold every car it reacts to.
const HASH_CELL = 20;
const DECISION_EVERY_SECONDS = 30;
const BOUNCE_DAMPING = -0.2;
// A route point counts as reached within this many metres.
const REACH_METERS = 9;

// The exact Ornstein-Uhlenbeck update for friction 1/tau and velocity variance T over dt:
// v <- c1 v + c2 xi, with stationary variance T. This is the O in BAOAB.
export function ouCoefficients(dt: number, tau: number, temperature: number) {
  const c1 = Math.exp(-dt / tau);
  return { c1, c2: Math.sqrt(temperature * (1 - c1 * c1)) };
}

// Greenshields on the road ahead: the share of free speed a driver wants with `gap` metres to the
// car ahead on a road of `lanes` lanes. Cars in this model don't keep to lanes, so the nearest car
// ahead stands for one in each lane: k = 1 / (lanes gap) per lane, against k_jam = 1 / 7.5 m. Past
// half the look-ahead the gap counts for less, reaching free flow at the look-ahead, so speed
// never jumps as a car comes into view.
export function speedShare(gap: number, lanes: number, lookAhead: number) {
  const weight = gapWeight(gap, lookAhead);
  if (weight <= 0) return 1;
  return Math.max(MIN_SPEED_SHARE, 1 - (JAM_SPACING_METERS / (lanes * gap)) * weight);
}

// How much the car `gap` metres ahead counts: fully within half the look-ahead, fading to nothing at it.
export const gapWeight = (gap: number, lookAhead: number) => Math.max(0, Math.min(1, 2 * (1 - gap / lookAhead)));

type Ou = ReturnType<typeof ouCoefficients>;

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
  // Unit direction the car steers for (see `aim`), for every moving car, as of the last step, and
  // the share of its street's free speed it wants.
  readonly hx: Float64Array;
  readonly hy: Float64Array;
  readonly pace: Float64Array;
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
  // Flow by street: cars that entered each segment, and speed samples taken on it every 30 s. A
  // speed sample is how fast the car is making way along its route, not |v|: the velocity noise
  // alone gives a stopped car an |v| of about 1 m/s, and a car turning a corner isn't moving along
  // the street it is on.
  readonly segmentEntries: Uint32Array;
  readonly segmentSpeedSum: Float64Array;
  readonly segmentSpeedSamples: Uint32Array;
  // Driving seconds lost to crowding on each segment: every sample counts 30 s times the share of
  // the street's free-flow speed the car didn't get.
  readonly segmentLostSeconds: Float64Array;
  // The same speed samples by directed edge, so each direction of a street has its own speed: an
  // outbound jam says nothing about the empty lanes heading into the zone. The dispatcher's drive
  // times read these (convex/traffic.ts).
  readonly edgeSpeedSum: Float64Array;
  readonly edgeSpeedSamples: Uint32Array;

  private trueShut: Uint8Array;
  private trueBlocked = new Set<number>();
  // Cars on each edge as of the last refresh, smoothed over refreshes, and the congestion
  // multipliers routes are planned on.
  private edgeCars: Float64Array;
  private delay: Float64Array | null = null;
  private potentials = new Map<string, Potential>();
  private agentPotential: (Potential | null)[];
  private lastRefresh = -Infinity;
  private nextDecision = 0;
  // Head of each hash cell's list of moving cars (-1 for none), and the next car in each list.
  private hashHead: Int32Array;
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
    [this.x, this.y, this.vx, this.vy, this.fx, this.fy, this.hx, this.hy, this.pace] = Array.from({ length: 9 }, () => new Float64Array(n));
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
    this.hashHead = new Int32Array(this.hashCols * (Math.ceil((ground.rows * ground.cell) / HASH_CELL) + 1));
    if (params.lookAhead > HASH_CELL) throw new Error(`lookAhead ${params.lookAhead} m is past the ${HASH_CELL} m neighbour search`);
    this.router = new RoadRouter(ground, params.safeLat);
    this.segmentEntries = new Uint32Array(ground.segments.length);
    this.segmentSpeedSum = new Float64Array(ground.segments.length);
    this.segmentSpeedSamples = new Uint32Array(ground.segments.length);
    this.segmentLostSeconds = new Float64Array(ground.segments.length);
    this.edgeSpeedSum = new Float64Array(this.router.edgeSpeed.length);
    this.edgeSpeedSamples = new Uint32Array(this.router.edgeSpeed.length);
    for (const [i, household] of households.entries()) {
      [this.x[i], this.y[i]] = toXY(household);
      this.people[i] = Math.max(1, household.peopleCount);
      this.keen[i] = random() < params.departure.keenShare ? 1 : 0;
      this.state[i] = household.canLeave === "yes" && household.hasCar ? STATE.home : STATE.waiting;
      this.goal[i] = this.router.nearestNode(this.x[i], this.y[i]);
    }
    this.trueShut = new Uint8Array(ground.speed.length);
    this.edgeCars = new Float64Array(this.router.edgeSpeed.length);
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
      hx: this.hx.slice(),
      hy: this.hy.slice(),
      pace: this.pace.slice(),
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
      edgeSpeedSum: this.edgeSpeedSum.slice(),
      edgeSpeedSamples: this.edgeSpeedSamples.slice(),
      trueShut: this.trueShut.slice(),
      trueBlocked: new Set(this.trueBlocked),
      edgeCars: this.edgeCars.slice(),
      potentials: new Map(this.potentials),
      agentPotential: [...this.agentPotential],
      hashHead: new Int32Array(this.hashHead.length),
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
    const { dt, tau, temperature, lateralTau, lateralTemperature } = this.params;
    const along = ouCoefficients(dt, tau, temperature);
    const across = ouCoefficients(dt, lateralTau, lateralTemperature);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === STATE.moving) this.kickDriftNoiseDrift(i, dt, along, across);
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

  // B, A, O, A of BAOAB, with a reflecting wall at cells a car actually can't enter. The O step
  // is exact on each axis of the car's heading frame; a car with no heading yet (just leaving
  // home) gets the along-heading coefficients on both. The noise is scaled to the car's pace.
  private kickDriftNoiseDrift(i: number, dt: number, along: Ou, across: Ou) {
    this.vx[i] += (this.fx[i] * dt) / 2;
    this.vy[i] += (this.fy[i] * dt) / 2;
    let x = this.x[i] + (this.vx[i] * dt) / 2;
    let y = this.y[i] + (this.vy[i] * dt) / 2;
    const hx = this.hx[i];
    const hy = this.hy[i];
    const spread = Math.sqrt(this.pace[i]);
    if (hx * hx + hy * hy < 0.5) {
      this.vx[i] = along.c1 * this.vx[i] + spread * along.c2 * gaussian(this.random);
      this.vy[i] = along.c1 * this.vy[i] + spread * along.c2 * gaussian(this.random);
    } else {
      const forward = along.c1 * (this.vx[i] * hx + this.vy[i] * hy) + spread * along.c2 * gaussian(this.random);
      const sideways = across.c1 * (this.vy[i] * hx - this.vx[i] * hy) + spread * across.c2 * gaussian(this.random);
      this.vx[i] = forward * hx - sideways * hy;
      this.vy[i] = forward * hy + sideways * hx;
    }
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
    this.measureCongestion();
    this.potentials = new Map();
    this.agentPotential.fill(null);
  }

  private measureCongestion() {
    const now = new Float64Array(this.edgeCars.length);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === STATE.moving && this.edge[i] >= 0) now[this.edge[i]] += 1;
    }
    const memory = this.params.congestionMemory;
    for (let e = 0; e < now.length; e++) this.edgeCars[e] = memory * this.edgeCars[e] + (1 - memory) * now[e];
    this.delay = this.router.delays(this.edgeCars);
  }

  private potentialFor(i: number): Potential {
    const cached = this.agentPotential[i];
    if (cached) return cached;
    const known = this.known[i];
    const key = [...known].sort((a, b) => a - b).join(",");
    let potential = this.potentials.get(key);
    if (!potential) {
      potential = this.router.potential(this.minutes, known, this.delay);
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

  // The straight stretch of street car i is driving, as its start, unit direction and length, or
  // null while it heads for an intersection off the street.
  private stretch(i: number): [number, number, number, number, number] | null {
    const edge = this.edge[i];
    if (edge < 0) return null;
    const shape = this.router.edgeShape[edge];
    const p = Math.min(this.point[i], shape.length / 2 - 1);
    const [ax, ay, bx, by] = [shape[2 * p - 2], shape[2 * p - 1], shape[2 * p], shape[2 * p + 1]];
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) return null;
    return [ax, ay, (bx - ax) / length, (by - ay) / length, length];
  }

  // Where the driver steers for: pursuitMeters further along the street from the point nearest the
  // car on the stretch it is driving, and no further than the stretch's end. Steering for the
  // stretch's far end instead would leave a car that drifted sideways driving parallel to the street.
  private aim(i: number): [number, number] {
    const stretch = this.stretch(i);
    if (!stretch) return this.target(i);
    const [ax, ay, ux, uy, length] = stretch;
    const along = Math.max(0, (this.x[i] - ax) * ux + (this.y[i] - ay) * uy) + this.params.pursuitMeters;
    return along >= length ? this.target(i) : [ax + ux * along, ay + uy * along];
  }

  // How far car i is off the line of its stretch of street, as a vector across it.
  private laneOffset(i: number): [number, number] {
    const stretch = this.stretch(i);
    if (!stretch) return [0, 0];
    const [ax, ay, ux, uy] = stretch;
    const dx = this.x[i] - ax;
    const dy = this.y[i] - ay;
    const along = dx * ux + dy * uy;
    return [dx - along * ux, dy - along * uy];
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
    const next = this.router.chooseEdge(node, this.potentialFor(i), this.known[i], this.params.routeSpreadSeconds, this.random);
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
      const speed = this.routeSpeed(i);
      this.edgeSpeedSum[edge] += speed;
      this.edgeSpeedSamples[edge] += 1;
      const segment = this.router.edgeSegment[edge];
      if (segment < 0) continue;
      this.segmentSpeedSum[segment] += speed;
      this.segmentSpeedSamples[segment] += 1;
      const freeSpeed = this.ground.segments[segment].kph / 3.6;
      if (freeSpeed > 0) this.segmentLostSeconds[segment] += DECISION_EVERY_SECONDS * Math.min(1, Math.max(0, 1 - speed / freeSpeed));
    }
  }

  // How fast car i is making way along its route, m/s: its velocity along its heading. Negative
  // while it is pushed back, so for a stopped car the noise averages out to 0.
  routeSpeed(i: number) {
    return this.vx[i] * this.hx[i] + this.vy[i] * this.hy[i];
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
      const slowdown = Math.min(1, Math.max(0, 1 - meanSpeed / freeSpeed));
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
    this.hashHead.fill(-1);
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== STATE.moving) continue;
      const key = this.hashOf(this.x[i], this.y[i]);
      this.hashKey[i] = key;
      this.hashNext[i] = this.hashHead[key];
      this.hashHead[key] = i;
    }
  }

  private computeForces() {
    this.rebuildHash();
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] !== STATE.moving) continue;
      this.advanceRoute(i);
      const [tx, ty] = this.aim(i);
      const distance = Math.hypot(tx - this.x[i], ty - this.y[i]) || 1;
      this.hx[i] = (tx - this.x[i]) / distance;
      this.hy[i] = (ty - this.y[i]) / distance;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.state[i] === STATE.moving) this.forceOn(i);
    }
  }

  // Repulsion on car i, and the nearest car ahead of it going its way and the gap to it (-1 and
  // Infinity if none within the look-ahead).
  private neighborsOf(i: number): [number, number, number, number] {
    const { lateralRepulsion, maxRepulsion, lookAhead } = this.params;
    const hx = this.hx[i];
    const hy = this.hy[i];
    let rx = 0;
    let ry = 0;
    let gap = Infinity;
    let leader = -1;
    const key = this.hashKey[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (let j = this.hashHead[key + dr * this.hashCols + dc] ?? -1; j !== -1; j = this.hashNext[j]) {
          const dx = this.x[j] - this.x[i];
          const dy = this.y[j] - this.y[i];
          // Most cars in the nine cells are past the look-ahead: skip them before the square root.
          if (j === i || dx * dx + dy * dy >= lookAhead * lookAhead) continue;
          const d = Math.hypot(dx, dy);
          if (d < 1e-6 || d >= lookAhead) continue;
          const forward = dx * hx + dy * hy;
          if (forward < gap && this.follows(i, j, dx, dy, forward)) {
            gap = forward;
            leader = j;
          }
          const push = this.pushFrom(i, j, dx, dy, d, forward);
          rx -= (push * dx) / d;
          ry -= (push * dy) / d;
        }
      }
    }
    const along = rx * hx + ry * hy;
    rx = along * hx + lateralRepulsion * (rx - along * hx);
    ry = along * hy + lateralRepulsion * (ry - along * hy);
    const magnitude = Math.hypot(rx, ry);
    const scale = magnitude > maxRepulsion ? maxRepulsion / magnitude : 1;
    return [rx * scale, ry * scale, leader, gap];
  }

  // Whether car j, at (dx, dy) from car i and `forward` metres along i's heading, is ahead of i in
  // its lane and going its way.
  private follows(i: number, j: number, dx: number, dy: number, forward: number) {
    const hx = this.hx[i];
    const hy = this.hy[i];
    return forward > 0 && Math.abs(dx * hy - dy * hx) < 2 * this.params.radius && this.hx[j] * hx + this.hy[j] * hy > 0;
  }

  // How hard car j, d metres away, pushes car i. Right of way: of two cars, the one further into the
  // other's path goes first, and the other brakes for it; without it two cars meeting at a corner
  // both brake for each other and neither moves. The car that yields feels 1 for a car straight
  // ahead, repulsionBehind straight behind, (1 + cos) / 2 between; the other feels repulsionBehind.
  private pushFrom(i: number, j: number, dx: number, dy: number, d: number, forward: number) {
    const { radius, repulsion, repulsionRange, repulsionBehind } = this.params;
    if (d >= 2 * radius + 4 * repulsionRange) return 0;
    const theirs = -(dx * this.hx[j] + dy * this.hy[j]);
    const yields = forward > theirs || (forward === theirs && i > j);
    const sight = yields ? repulsionBehind + ((1 - repulsionBehind) * (1 + forward / d)) / 2 : repulsionBehind;
    return sight * repulsion * Math.exp((2 * radius - d) / repulsionRange);
  }

  private forceOn(i: number) {
    const { tau, lookAhead, speedMatching, laneStiffness } = this.params;
    const [rx, ry, leader, gap] = this.neighborsOf(i);
    const edge = this.edge[i];
    const cell = cellIndex(this.ground, this.x[i], this.y[i]);
    const free = this.stuck[i] ? 0 : edge >= 0 ? this.router.edgeSpeed[edge] : cell < 0 ? 0 : this.ground.speed[cell];
    const lanes = edge >= 0 ? Math.max(1, this.router.edgeLanes[edge]) : 1;
    const hx = this.hx[i];
    const hy = this.hy[i];
    this.pace[i] = this.stuck[i] ? 0 : speedShare(gap, lanes, lookAhead);
    let drive = (free * this.pace[i]) / tau;
    if (leader >= 0) {
      const closing = (this.vx[leader] - this.vx[i]) * hx + (this.vy[leader] - this.vy[i]) * hy;
      drive += speedMatching * gapWeight(gap, lookAhead) * closing;
    }
    // Braking, for the car ahead or to match its speed, can bring this car to a stop within the
    // step but not drive it backwards. Without this a packed queue pushes its back end ever
    // further back.
    const forward = this.vx[i] * hx + this.vy[i] * hy;
    const excess = Math.max(0, -Math.max(0, forward) / this.params.dt - (drive + rx * hx + ry * hy));
    const [ox, oy] = this.laneOffset(i);
    this.fx[i] = drive * hx + rx + excess * hx - laneStiffness * ox;
    this.fy[i] = drive * hy + ry + excess * hy - laneStiffness * oy;
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
      const speed = this.routeSpeed(i);
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
