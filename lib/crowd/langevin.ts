import { gaussian, Random } from "../mesh/random";
import { DEFAULT_DEPARTURE, DepartureParams, stepDecision } from "./departure";
import { cellIndex, Ground, toXY } from "./grid";
import { blockedMask, isBurning, JAM_SPACING_METERS, logitChoice, MIN_SPEED_SHARE, Potential, RoadRouter, StreetPoint } from "./navigation";

// Evacuating households as particles under underdamped Langevin dynamics, written in each car's
// frame: along its heading e(x) (subscript a) and across it (c):
//
//   dx   = v dt
//   dv_a = [ (v_des - v_a) / tau  +  lambda w (v_lead - v)_a  +  F_rep,a ] dt  +  sqrt(2 s T / tau) dW_a
//   dv_c = [ -v_c / tau_c  -  k_lane d_c  +  F_rep,c ] dt                     +  sqrt(2 s T_c / tau_c) dW_c
//
// e(x) aims at a point a little way ahead in the driver's lane (pure pursuit; the route is in
// navigation.ts). Each car drives a lane, right of the centreline on a two-way street, and k_lane
// holds it to that lane's line, d_c being how far off it is. v_des is the street's free speed
// slowed by the road ahead (Greenshields: v_free (1 - k / k_jam)), with k read from the gap to the
// car ahead in the driver's lane and k_jam the route choice's 7.5 m of lane per car, and never so
// fast that the gap is under the jam spacing plus a safe time gap of driving (Newell). s = v_des /
// v_free is the driver's pace. Ahead of a corner v_des drops further, so the car brakes in time to
// take it at sqrt(a_lat R), R the turn's radius, and no faster than the street it turns onto (see
// `cornerBraking`). lambda matches the speed of the car ahead (the full velocity difference
// model), weighted by how near it is (w). F_rep is a soft exponential repulsion between vehicles
// (Helbing and Molnar's social force), felt from the car ahead and barely from the car behind,
// settled by right of way where two cars' paths cross, along the lane only between cars in one
// lane, nothing between cars a lane apart, kept only in part across the heading, capped at hard
// braking, and never strong enough to reverse a car. T is the variance of the velocity noise for a
// driver with open road: hesitation and the spread in how people drive. It scales with pace, so a
// car standing in a jam doesn't jitter. Integration is BAOAB splitting (Leimkuhler and Matthews
// 2013): friction and noise are solved exactly on each axis, so the half-second step is stable.
//
// So a queue's front car, with open road ahead, pulls away at speed, nobody is pushed along by the
// car behind, cars keep to their lane and queue in single file in it, and a lane discharges a
// queue at about 1,800 cars an hour in town and 2,100 on the freeway, as real lanes do.
//
// Each driver routes on the blockages it knows about and on how crowded the streets were at the
// last refresh, and picks among near-equal streets at random (see navigation.ts). A driver that
// runs into a blocked street it didn't know about is stopped by it, learns it, turns back and
// re-routes. That knowledge is what the phone mesh spreads.

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
  // Pull back toward the lane's line per metre off it, m/s² per m. Unlike steering, this holds a
  // car in its lane when it is standing still in a jam.
  laneStiffness: number;
  // Width of a lane, and of a car, in metres. Cars further apart across the heading than a lane
  // are in different lanes and neither push nor follow each other; within a car's width they are
  // in each other's way.
  laneWidth: number;
  carWidth: number;
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
  // The safe time gap, s: a driver keeps at least the jam spacing plus this many seconds of driving
  // to the car ahead in its lane, seen at any distance (Newell's car following). Greenshields alone
  // let a queue on a freeway lane go 3,600 cars an hour, 1 s apart; with this a town lane's queue
  // goes about 1,800 an hour and a freeway lane's 2,100, as real ones do.
  timeGap: number;
  // Lateral acceleration a driver takes a turn at, m/s², and how hard it brakes ahead of one,
  // m/s². A 90-degree turn comes out at about 20 km/h.
  turnAcceleration: number;
  comfortBraking: number;
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
  laneWidth: 3.5,
  carWidth: 2,
  radius: 2.5,
  repulsion: 3,
  repulsionRange: 1.5,
  repulsionBehind: 0.1,
  lateralRepulsion: 0.3,
  maxRepulsion: 8,
  speedMatching: 0.5,
  lookAhead: 20,
  timeGap: 1,
  turnAcceleration: 3,
  comfortBraking: 2,
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
// A house can pull out onto a street slower than this, m/s (72 km/h): not onto the freeway or its ramps.
const DRIVEWAY_MAX_SPEED = 20;

// The exact Ornstein-Uhlenbeck update for friction 1/tau and velocity variance T over dt:
// v <- c1 v + c2 xi, with stationary variance T. This is the O in BAOAB.
export function ouCoefficients(dt: number, tau: number, temperature: number) {
  const c1 = Math.exp(-dt / tau);
  return { c1, c2: Math.sqrt(temperature * (1 - c1 * c1)) };
}

// Greenshields on the road ahead: the share of free speed a driver wants with `gap` metres to the
// car ahead in its lane, k = 1 / gap against k_jam = 1 / 7.5 m. Past half the look-ahead the gap
// counts for less, reaching free flow at the look-ahead, so speed never jumps as a car comes into view.
export function speedShare(gap: number, lookAhead: number) {
  const weight = gapWeight(gap, lookAhead);
  if (weight <= 0) return 1;
  return Math.max(MIN_SPEED_SHARE, 1 - (JAM_SPACING_METERS / gap) * weight);
}

// How much the car `gap` metres ahead counts: fully within half the look-ahead, fading to nothing at it.
export const gapWeight = (gap: number, lookAhead: number) => Math.max(0, Math.min(1, 2 * (1 - gap / lookAhead)));

type Ou = ReturnType<typeof ouCoefficients>;

// The share of `open` (open-road speed, or a sum of them) that `speed` falls short of, 0 to 1.
// Speeds are along each car's route, so a stalled car's can dip below 0; the share stops at 1.
export const crowdingShare = (speed: number, open: number) => (open > 0 ? Math.min(1, Math.max(0, 1 - speed / open)) : 0);

// Sorts order[from..to) by `along`, largest first.
function sortByAlong(order: Int32Array, from: number, to: number, along: Float64Array) {
  for (let k = from + 1; k < to; k++) {
    const item = order[k];
    let m = k - 1;
    while (m >= from && along[order[m]] < along[item]) {
      order[m + 1] = order[m];
      m -= 1;
    }
    order[m + 1] = item;
  }
}

// The lanes an edge has in its direction, as a whole number.
const laneCount = (router: RoadRouter, edge: number) => Math.max(1, Math.round(router.edgeLanes[edge]));

// The angle in radians between two directions, 0 for straight on and pi for a U-turn.
function turnAngle(ax: number, ay: number, bx: number, by: number) {
  const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by);
  return lengths < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / lengths)));
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
  // The street the driver will turn onto at the end of `edge`, chosen as it enters `edge` so it can
  // slow for the turn (-1 for none yet), and the route potential it was chosen on.
  readonly next: Int32Array;
  private plannedOn: (Potential | null)[];
  // The lane of `edge` the car drives, 0 the leftmost.
  readonly lane: Uint8Array;
  // Where each household's driveway meets the street in front of it, in each direction the street
  // can be driven, and whether the car is still on its driveway heading there.
  private entry: StreetPoint[][];
  readonly onDriveway: Uint8Array;
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
  //
  // Crowding is measured against each car's open-road speed (`openSpeed`): how fast the same car
  // would be driving at the same point of its route with nobody else on the road, slowing for the
  // same corners and pulling away from them the same way. Measured against the street's free speed
  // instead, every corner and every car pulling away from its driveway would count as traffic.
  readonly segmentEntries: Uint32Array;
  readonly segmentSpeedSum: Float64Array;
  readonly segmentOpenSpeedSum: Float64Array;
  readonly segmentSpeedSamples: Uint32Array;
  // Driving seconds lost to crowding on each segment: every sample counts 30 s times the share of
  // its open-road speed the car didn't get.
  readonly segmentLostSeconds: Float64Array;
  // The same speed samples by directed edge, so each direction of a street has its own speed: an
  // outbound jam says nothing about the empty lanes heading into the zone. The dispatcher's drive
  // times read these (convex/traffic.ts).
  readonly edgeSpeedSum: Float64Array;
  readonly edgeOpenSpeedSum: Float64Array;
  readonly edgeSpeedSamples: Uint32Array;
  // Each moving car's open-road speed along its heading, m/s: its along-heading dynamics with the
  // noise and every other car taken away.
  readonly openSpeed: Float64Array;

  private trueShut: Uint8Array;
  private trueBlocked = new Set<number>();
  // Cars on each edge as of the last refresh, smoothed over refreshes, and the congestion
  // multipliers routes are planned on.
  private edgeCars: Float64Array;
  private delay: Float64Array | null = null;
  private potentials = new Map<string, Potential>();
  private agentPotential: (Potential | null)[];
  // For a driver with no route to safety: the refuge it drives to (-1 until it needs one) and the
  // potential toward it, null once there. Both are chosen again whenever its potential is.
  private refugeNode: Int32Array;
  private refugePotential: (Potential | null)[];
  private lastRefresh = -Infinity;
  private nextDecision = 0;
  // Head of each hash cell's list of moving cars (-1 for none), and the next car in each list.
  private hashHead: Int32Array;
  private hashNext: Int32Array;
  private hashKey: Int32Array;
  private hashCols: number;
  // Per step: how far along its edge each car is, the cars on each edge from the front back
  // (edge e's are laneOrder[laneStart[e]] to laneOrder[laneStart[e + 1] - 1]), and the car ahead of
  // each in its lane (see `orderLanes`) and the gap to it.
  private edgeAt: Float64Array;
  private laneStart: Int32Array;
  private laneOrder: Int32Array;
  private laneLeader: Int32Array;
  private laneGap: Float64Array;
  // The cars moving at the start of the step (see `collectMoving`), and when the fire reaches each
  // household's home.
  private moving: Int32Array;
  private movingCount = 0;
  private fireAtHome: Float64Array;
  // What `neighborsOf` gathers from the cars around one car: their push, and the car it follows.
  private near = { rx: 0, ry: 0, gap: Infinity, leader: -1 };
  // Each edge's distance along it to each shape point, and the speed its bend at each interior
  // shape point can be taken at (Infinity at the ends).
  private pointAlong: Float64Array[];
  private bendSpeed: Float64Array[];

  constructor(
    readonly ground: Ground,
    households: Household[],
    private readonly random: Random,
    private readonly blockedTruth: (minutes: number) => Set<number>,
    readonly params: CrowdParams = DEFAULT_CROWD,
  ) {
    this.count = households.length;
    const n = this.count;
    [this.x, this.y, this.vx, this.vy, this.fx, this.fy, this.hx, this.hy, this.pace, this.openSpeed] = Array.from({ length: 10 }, () => new Float64Array(n));
    this.state = new Uint8Array(n);
    this.keen = new Uint8Array(n);
    this.people = new Uint16Array(n);
    this.decision = new Float64Array(n);
    this.departedAt = new Float64Array(n).fill(NaN);
    this.arrivedAt = new Float64Array(n).fill(NaN);
    this.edge = new Int32Array(n).fill(-1);
    this.point = new Int32Array(n);
    this.goal = new Int32Array(n);
    this.next = new Int32Array(n).fill(-1);
    this.lane = new Uint8Array(n);
    this.onDriveway = new Uint8Array(n);
    this.plannedOn = Array(n).fill(null);
    this.stuck = new Uint8Array(n);
    this.known = Array.from({ length: n }, () => new Set<number>());
    this.agentPotential = Array(n).fill(null);
    this.refugeNode = new Int32Array(n).fill(-1);
    this.refugePotential = Array(n).fill(null);
    this.hashNext = new Int32Array(n);
    this.hashKey = new Int32Array(n);
    this.edgeAt = new Float64Array(n);
    this.moving = new Int32Array(n);
    this.laneOrder = new Int32Array(n);
    this.laneLeader = new Int32Array(n);
    this.laneGap = new Float64Array(n);
    this.hashCols = Math.ceil((ground.cols * ground.cell) / HASH_CELL) + 1;
    this.hashHead = new Int32Array(this.hashCols * (Math.ceil((ground.rows * ground.cell) / HASH_CELL) + 1));
    if (params.lookAhead > HASH_CELL) throw new Error(`lookAhead ${params.lookAhead} m is past the ${HASH_CELL} m neighbour search`);
    this.router = new RoadRouter(ground, params.safeLat);
    this.laneStart = new Int32Array(this.router.edgeShape.length + 1);
    this.segmentEntries = new Uint32Array(ground.segments.length);
    this.segmentSpeedSum = new Float64Array(ground.segments.length);
    this.segmentOpenSpeedSum = new Float64Array(ground.segments.length);
    this.segmentSpeedSamples = new Uint32Array(ground.segments.length);
    this.segmentLostSeconds = new Float64Array(ground.segments.length);
    this.edgeSpeedSum = new Float64Array(this.router.edgeSpeed.length);
    this.edgeOpenSpeedSum = new Float64Array(this.router.edgeSpeed.length);
    this.edgeSpeedSamples = new Uint32Array(this.router.edgeSpeed.length);
    this.pointAlong = this.router.edgeShape.map((shape) => {
      const along = new Float64Array(shape.length / 2);
      for (let p = 1; p < along.length; p++) along[p] = along[p - 1] + Math.hypot(shape[2 * p] - shape[2 * p - 2], shape[2 * p + 1] - shape[2 * p - 1]);
      return along;
    });
    this.bendSpeed = this.router.edgeShape.map((shape, e) => {
      const speeds = new Float64Array(shape.length / 2).fill(Infinity);
      for (let p = 1; p < speeds.length - 1; p++) {
        const turn = turnAngle(shape[2 * p] - shape[2 * p - 2], shape[2 * p + 1] - shape[2 * p - 1], shape[2 * p + 2] - shape[2 * p], shape[2 * p + 3] - shape[2 * p + 1]);
        speeds[p] = Math.min(this.router.edgeSpeed[e], this.turnSpeed(turn));
      }
      return speeds;
    });
    for (const [i, household] of households.entries()) {
      [this.x[i], this.y[i]] = toXY(household);
      this.people[i] = Math.max(1, household.peopleCount);
      this.keen[i] = random() < params.departure.keenShare ? 1 : 0;
      this.state[i] = household.canLeave === "yes" && household.hasCar ? STATE.home : STATE.waiting;
      this.goal[i] = this.router.nearestNode(this.x[i], this.y[i]);
    }
    this.fireAtHome = Float64Array.from({ length: n }, (_, i) => this.fireMinutesAt(i));
    const drivewayOnto = (edge: number) => this.router.edgeSpeed[edge] < DRIVEWAY_MAX_SPEED;
    this.entry = Array.from({ length: n }, (_, i) => this.router.streetPoints(this.x[i], this.y[i], drivewayOnto));
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
    this.refugeNode[agent] = -1;
    const edge = this.edge[agent];
    if (edge >= 0 && known.has(this.router.edgeSegment[edge])) {
      // The street ahead is blocked: turn back to the last intersection and choose again there.
      this.edge[agent] = -1;
      this.goal[agent] = this.router.edgeStart(edge);
    }
    const next = this.next[agent];
    if (this.edge[agent] < 0 || (next >= 0 && known.has(this.router.edgeSegment[next]))) this.next[agent] = -1;
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
      openSpeed: this.openSpeed.slice(),
      state: this.state.slice(),
      decision: this.decision.slice(),
      departedAt: this.departedAt.slice(),
      arrivedAt: this.arrivedAt.slice(),
      edge: this.edge.slice(),
      point: this.point.slice(),
      goal: this.goal.slice(),
      next: this.next.slice(),
      lane: this.lane.slice(),
      onDriveway: this.onDriveway.slice(),
      plannedOn: [...this.plannedOn],
      stuck: this.stuck.slice(),
      known: this.known.map((segments) => new Set(segments)),
      discoveries: [...this.discoveries],
      segmentEntries: this.segmentEntries.slice(),
      segmentSpeedSum: this.segmentSpeedSum.slice(),
      segmentOpenSpeedSum: this.segmentOpenSpeedSum.slice(),
      segmentSpeedSamples: this.segmentSpeedSamples.slice(),
      segmentLostSeconds: this.segmentLostSeconds.slice(),
      edgeSpeedSum: this.edgeSpeedSum.slice(),
      edgeOpenSpeedSum: this.edgeOpenSpeedSum.slice(),
      edgeSpeedSamples: this.edgeSpeedSamples.slice(),
      trueShut: this.trueShut.slice(),
      trueBlocked: new Set(this.trueBlocked),
      edgeCars: this.edgeCars.slice(),
      potentials: new Map(this.potentials),
      agentPotential: [...this.agentPotential],
      refugeNode: this.refugeNode.slice(),
      refugePotential: [...this.refugePotential],
      hashHead: new Int32Array(this.hashHead.length),
      hashNext: new Int32Array(this.count),
      hashKey: new Int32Array(this.count),
      edgeAt: new Float64Array(this.count),
      moving: new Int32Array(this.count),
      laneStart: new Int32Array(this.laneStart.length),
      laneOrder: new Int32Array(this.count),
      laneLeader: new Int32Array(this.count),
      laneGap: new Float64Array(this.count),
      near: { rx: 0, ry: 0, gap: Infinity, leader: -1 },
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
    this.collectMoving();
    for (let k = 0; k < this.movingCount; k++) this.kickDriftNoiseDrift(this.moving[k], dt, along, across);
    this.computeForces();
    for (let k = 0; k < this.movingCount; k++) {
      const i = this.moving[k];
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
    this.refugeNode.fill(-1);
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
    if (edge < 0 && this.onDriveway[i]) return [this.entry[i][0].x, this.entry[i][0].y];
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

  // Where the driver steers for: pursuitMeters further along its lane from the point nearest the
  // car on the stretch it is driving, and no further than the stretch's end. Steering for the
  // stretch's far end instead would leave a car that drifted sideways driving parallel to the street.
  private aim(i: number): [number, number] {
    const stretch = this.stretch(i);
    if (!stretch) return this.target(i);
    const [ax, ay, ux, uy, length] = stretch;
    const shift = this.laneShift(this.edge[i], this.lane[i]);
    const along = Math.min(length, Math.max(0, (this.x[i] - ax) * ux + (this.y[i] - ay) * uy) + this.params.pursuitMeters);
    return [ax + ux * along + uy * shift, ay + uy * along - ux * shift];
  }

  // How far right of the centreline of `edge` the middle of lane `lane` is, in metres: a two-way
  // street's lanes are right of it, a one-way street's spread across it.
  private laneShift(edge: number, lane: number) {
    const width = this.params.laneWidth;
    const first = this.router.edgeTwoWay[edge] ? width / 2 : (-(laneCount(this.router, edge) - 1) * width) / 2;
    return first + lane * width;
  }

  // How far car i is off the line of its lane, as a vector across it.
  private laneOffset(i: number): [number, number] {
    const stretch = this.stretch(i);
    if (!stretch) return [0, 0];
    const [ax, ay, ux, uy] = stretch;
    const dx = this.x[i] - ax;
    const dy = this.y[i] - ay;
    // How far right of the centreline the car is, less how far its lane is.
    const off = dx * uy - dy * ux - this.laneShift(this.edge[i], this.lane[i]);
    return [off * uy, -off * ux];
  }

  // The lane car i takes as it enters `edge` (as `edge` and `point` already say): the one with the
  // most room ahead, the nearest to where the car is among equals.
  private chooseLane(i: number, edge: number) {
    const lanes = laneCount(this.router, edge);
    const stretch = this.stretch(i);
    if (lanes === 1 || !stretch) return 0;
    const [ax, ay, ux, uy] = stretch;
    const room = new Float64Array(lanes).fill(this.params.lookAhead);
    const key = this.hashKey[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (let j = this.hashHead[key + dr * this.hashCols + dc] ?? -1; j !== -1; j = this.hashNext[j]) {
          if (j === i || this.edge[j] !== edge || this.state[j] !== STATE.moving) continue;
          const ahead = (this.x[j] - this.x[i]) * ux + (this.y[j] - this.y[i]) * uy;
          if (ahead > -this.params.radius) room[this.lane[j]] = Math.min(room[this.lane[j]], Math.max(0, ahead));
        }
      }
    }
    const right = (this.x[i] - ax) * uy - (this.y[i] - ay) * ux;
    let best = 0;
    for (let lane = 1; lane < lanes; lane++) {
      const nearer = Math.abs(this.laneShift(edge, lane) - right) < Math.abs(this.laneShift(edge, best) - right);
      if (room[lane] > room[best] || (room[lane] === room[best] && nearer)) best = lane;
    }
    return best;
  }

  // Whether car i has reached the route point it is driving for: within REACH_METERS of it, or past
  // the end of the stretch of street it is driving. Without the second test a fast car that steps
  // over the reach circle in one step (14 m a step at 50 km/h and a 1 s step) turns back for the
  // point it missed, into the cars behind it. A car heading for an intersection off the street is
  // leaving home or turning back, slowly, and aims straight at it, so the circle is enough there.
  private reached(i: number) {
    const [tx, ty] = this.target(i);
    const dx = tx - this.x[i];
    const dy = ty - this.y[i];
    if (Math.hypot(dx, dy) <= REACH_METERS) return true;
    const stretch = this.stretch(i);
    return stretch !== null && dx * stretch[2] + dy * stretch[3] < 0;
  }

  private advanceRoute(i: number) {
    for (let hops = 0; hops < 4 && this.state[i] === STATE.moving; hops++) {
      if (!this.reached(i)) return;
      const edge = this.edge[i];
      if (edge < 0 && this.onDriveway[i]) {
        this.joinStreet(i);
        continue;
      }
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
    const potential = this.potentialFor(i);
    // The street planned on entering the last one, unless what the driver knows has changed since.
    const planned = this.next[i];
    const next =
      planned >= 0 && this.plannedOn[i] === potential && this.router.edgeStart(planned) === node
        ? planned
        : this.router.chooseEdge(node, potential, this.known[i], this.params.routeSpreadSeconds, this.random);
    if (next >= 0) {
      this.stuck[i] = 0;
      this.enterEdge(i, next, 1, potential);
      return;
    }
    // No route to safety: away from the fire, to the refuge, and wait there.
    const refuge = this.towardRefuge(i, node);
    this.stuck[i] = refuge < 0 ? 1 : 0;
    if (refuge >= 0) {
      this.enterEdge(i, refuge, 1, this.refugePotential[i]!);
      return;
    }
    this.edge[i] = -1;
    this.goal[i] = node;
    this.next[i] = -1;
  }

  // The street out of `node` toward car i's refuge, the intersection it can reach that the fire
  // reaches last, or -1 at the refuge. Without this a driver with no route to safety stood where it
  // was until the fire came, though open streets led away from it.
  private towardRefuge(i: number, node: number) {
    if (this.refugeNode[i] < 0) {
      const refuge = this.router.refuge(node, this.minutes, this.known[i], this.delay);
      this.refugeNode[i] = refuge;
      this.refugePotential[i] = refuge === node ? null : this.router.potential(this.minutes, this.known[i], this.delay, [refuge]);
    }
    const potential = this.refugePotential[i];
    if (node === this.refugeNode[i] || !potential) return -1;
    return this.router.nextEdge(node, potential, this.known[i]);
  }

  // Pulling out of the driveway onto the street in front of the house, in whichever direction it
  // drives (logit odds on the time to safety from there, as at an intersection). If neither
  // direction leads to safety as far as the driver knows, it heads for the nearest intersection
  // instead. Before, every car crossed the yards to the nearest intersection (a median 67 m off,
  // against 31 m to the street) at walking pace.
  private joinStreet(i: number) {
    this.onDriveway[i] = 0;
    const potential = this.potentialFor(i);
    const options = this.entry[i];
    const seconds = options.map((point) => this.router.joinSeconds(point, potential, this.known[i]));
    const choice = logitChoice(seconds, this.params.routeSpreadSeconds, this.random);
    if (choice >= 0) this.enterEdge(i, options[choice].edge, options[choice].stretch + 1, potential);
  }

  // Car i starts down `edge`, steering for shape point `point` of it: picks its lane and the street
  // it will turn onto at the end.
  private enterEdge(i: number, edge: number, point: number, potential: Potential) {
    if (this.router.edgeSegment[edge] >= 0) this.segmentEntries[this.router.edgeSegment[edge]] += 1;
    this.edge[i] = edge;
    this.goal[i] = this.router.edgeStart(edge);
    this.point[i] = point;
    this.lane[i] = this.chooseLane(i, edge);
    const end = this.router.edgeEnd(edge);
    this.next[i] = this.router.safe[end] ? -1 : this.router.chooseEdge(end, potential, this.known[i], this.params.routeSpreadSeconds, this.random);
    this.plannedOn[i] = potential;
  }

  // The speed a turn through `angle` radians can be taken at: sqrt(a_lat R), with R the radius of
  // the arc a driver steering pursuitMeters ahead cuts the corner on, pursuitMeters / (2 sin(angle / 2)).
  private turnSpeed(angle: number) {
    const { turnAcceleration, pursuitMeters } = this.params;
    const half = Math.sin(angle / 2);
    return half < 1e-6 ? Infinity : Math.sqrt((turnAcceleration * pursuitMeters) / (2 * half));
  }

  // The speed car i can take the corner at the end of its edge at: the turn onto the street it
  // plans to take, no faster than that street's free speed. Infinity with no street planned.
  private junctionSpeed(i: number, edge: number) {
    const next = this.next[i];
    if (next < 0) return Infinity;
    const a = this.router.edgeShape[edge];
    const b = this.router.edgeShape[next];
    const n = a.length;
    const turn = turnAngle(a[n - 2] - a[n - 4], a[n - 1] - a[n - 3], b[2] - b[0], b[3] - b[1]);
    return Math.min(this.router.edgeSpeed[next], this.turnSpeed(turn));
  }

  // The deceleration car i needs, going `forward` m/s along its street, to slow to each corner
  // ahead of it by the time it starts the turn, REACH_METERS short of the corner: the largest
  // (v^2 - v_corner^2) / 2d over the corners within comfortable braking distance, capped at hard
  // braking. 0 with no corner to slow for.
  private cornerBraking(i: number, forward: number) {
    const edge = this.edge[i];
    const { comfortBraking, maxRepulsion, dt } = this.params;
    if (edge < 0 || forward <= 0) return 0;
    const last = this.router.edgeShape[edge].length / 2 - 1;
    const p = Math.min(this.point[i], last);
    const along = this.pointAlong[edge];
    const at = this.edgeAt[i];
    const horizon = (forward * forward) / (2 * comfortBraking);
    let need = 0;
    for (let q = p; q <= last; q++) {
      const distance = along[q] - at - REACH_METERS;
      if (distance > horizon) break;
      const corner = q < last ? this.bendSpeed[edge][q] : this.junctionSpeed(i, edge);
      if (corner >= forward) continue;
      need = Math.max(need, (forward * forward - corner * corner) / (2 * Math.max(distance, forward * dt)));
    }
    return Math.min(need, maxRepulsion);
  }

  private sampleFlow() {
    for (let i = 0; i < this.count; i++) {
      const edge = this.edge[i];
      if (this.state[i] !== STATE.moving || edge < 0) continue;
      const speed = this.routeSpeed(i);
      const open = this.openSpeed[i];
      this.edgeSpeedSum[edge] += speed;
      this.edgeOpenSpeedSum[edge] += open;
      this.edgeSpeedSamples[edge] += 1;
      const segment = this.router.edgeSegment[edge];
      if (segment < 0) continue;
      this.segmentSpeedSum[segment] += speed;
      this.segmentOpenSpeedSum[segment] += open;
      this.segmentSpeedSamples[segment] += 1;
      if (open > 0) this.segmentLostSeconds[segment] += DECISION_EVERY_SECONDS * crowdingShare(speed, open);
    }
  }

  // How fast car i is making way along its route, m/s: its velocity along its heading. Negative
  // while it is pushed back, so for a stopped car the noise averages out to 0.
  routeSpeed(i: number) {
    return this.vx[i] * this.hx[i] + this.vy[i] * this.hy[i];
  }

  // Streets where the most driving time was lost to crowding: cars through it times the share of
  // open-road speed they didn't get.
  bottlenecks(limit = 10) {
    const rows: { segment: number; entries: number; meanSpeed: number; freeSpeed: number; slowdown: number }[] = [];
    for (let segment = 0; segment < this.segmentEntries.length; segment++) {
      const samples = this.segmentSpeedSamples[segment];
      if (samples < 5) continue;
      const meanSpeed = this.segmentSpeedSum[segment] / samples;
      const freeSpeed = this.ground.segments[segment].kph / 3.6;
      const slowdown = crowdingShare(this.segmentSpeedSum[segment], this.segmentOpenSpeedSum[segment]);
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
      this.openSpeed[i] = 0;
      this.onDriveway[i] = this.entry[i].length > 0 ? 1 : 0;
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

  // The cars moving at the start of this step, in index order: each step's loops go over these
  // rather than every household, most of which are at home or out of the zone.
  private collectMoving() {
    this.movingCount = 0;
    for (let i = 0; i < this.count; i++) if (this.state[i] === STATE.moving) this.moving[this.movingCount++] = i;
  }

  private rebuildHash() {
    this.hashHead.fill(-1);
    for (let k = 0; k < this.movingCount; k++) {
      const i = this.moving[k];
      const key = this.hashOf(this.x[i], this.y[i]);
      this.hashKey[i] = key;
      this.hashNext[i] = this.hashHead[key];
      this.hashHead[key] = i;
    }
  }

  private computeForces() {
    this.rebuildHash();
    for (let k = 0; k < this.movingCount; k++) {
      const i = this.moving[k];
      this.advanceRoute(i);
      const [tx, ty] = this.aim(i);
      const distance = Math.hypot(tx - this.x[i], ty - this.y[i]) || 1;
      this.hx[i] = (tx - this.x[i]) / distance;
      this.hy[i] = (ty - this.y[i]) / distance;
      if (this.edge[i] >= 0) this.edgeAt[i] = this.alongEdge(i);
    }
    this.orderLanes();
    for (let k = 0; k < this.movingCount; k++) {
      const i = this.moving[k];
      if (this.state[i] === STATE.moving) this.forceOn(i);
    }
  }

  // How far car i is along its edge, metres from the edge's start: to the start of the stretch it
  // is on, and its projection on that stretch from there.
  private alongEdge(i: number) {
    const edge = this.edge[i];
    const shape = this.router.edgeShape[edge];
    const p = Math.min(this.point[i], shape.length / 2 - 1);
    const along = this.pointAlong[edge];
    const stretch = along[p] - along[p - 1];
    if (stretch < 1e-6) return along[p - 1];
    return along[p - 1] + ((this.x[i] - shape[2 * p - 2]) * (shape[2 * p] - shape[2 * p - 2]) + (this.y[i] - shape[2 * p - 1]) * (shape[2 * p + 1] - shape[2 * p - 1])) / stretch;
  }

  // The car ahead of each car in its lane, at any distance, for the look-ahead past the 20 m the
  // neighbour search covers: the next car forward in its lane of its street, or with none, the last
  // car on the street it turns onto. The moving cars on each edge are sorted from the front back
  // (a counting sort by edge, then insertion sort, quick on lists this short and nearly in order).
  private orderLanes() {
    const start = this.laneStart;
    start.fill(0);
    const onStreet = (i: number) => this.state[i] === STATE.moving && this.edge[i] >= 0;
    const moving = this.moving.subarray(0, this.movingCount);
    for (const i of moving) if (onStreet(i)) start[this.edge[i] + 1] += 1;
    for (let e = 1; e < start.length; e++) start[e] += start[e - 1];
    const fill = start.slice(0, -1);
    for (const i of moving) if (onStreet(i)) this.laneOrder[fill[this.edge[i]]++] = i;
    this.linkLanes();
    for (const i of moving) if (onStreet(i) && this.laneLeader[i] < 0) this.linkAcrossJunction(i);
  }

  // Each car's leader in its lane on its own edge: the next car forward in it.
  private linkLanes() {
    const start = this.laneStart;
    const ahead: number[] = [];
    for (let e = 0; e + 1 < start.length; e++) {
      const [from, to] = [start[e], start[e + 1]];
      if (from === to) continue;
      sortByAlong(this.laneOrder, from, to, this.edgeAt);
      ahead.length = 0;
      for (let k = from; k < to; k++) {
        const i = this.laneOrder[k];
        const j = ahead[this.lane[i]] ?? -1;
        this.laneLeader[i] = j;
        this.laneGap[i] = j >= 0 ? this.edgeAt[j] - this.edgeAt[i] : Infinity;
        ahead[this.lane[i]] = i;
      }
    }
  }

  // The leader of a car with no car ahead in its lane: the last car on the street it turns onto.
  private linkAcrossJunction(i: number) {
    const start = this.laneStart;
    const next = this.next[i];
    if (next < 0 || start[next] === start[next + 1]) return;
    const j = this.laneOrder[start[next + 1] - 1];
    const along = this.pointAlong[this.edge[i]];
    this.laneLeader[i] = j;
    this.laneGap[i] = along[along.length - 1] - this.edgeAt[i] + this.edgeAt[j];
  }

  // Repulsion on car i, and the nearest car ahead of it going its way and the gap to it (-1 and
  // Infinity if none): within the 20 m around it, or further on in its lane (see `orderLanes`).
  private neighborsOf(i: number): [number, number, number, number] {
    const { lateralRepulsion, maxRepulsion } = this.params;
    const hx = this.hx[i];
    const hy = this.hy[i];
    const near = this.near;
    near.rx = 0;
    near.ry = 0;
    near.gap = Infinity;
    near.leader = -1;
    const key = this.hashKey[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (let j = this.hashHead[key + dr * this.hashCols + dc] ?? -1; j !== -1; j = this.hashNext[j]) this.meet(i, j);
      }
    }
    let { rx, ry, gap, leader } = near;
    const along = rx * hx + ry * hy;
    rx = along * hx + lateralRepulsion * (rx - along * hx);
    ry = along * hy + lateralRepulsion * (ry - along * hy);
    const magnitude = Math.hypot(rx, ry);
    const scale = magnitude > maxRepulsion ? maxRepulsion / magnitude : 1;
    if (this.edge[i] >= 0 && this.laneGap[i] < gap) [leader, gap] = [this.laneLeader[i], this.laneGap[i]];
    return [rx * scale, ry * scale, leader, gap];
  }

  // How car j bears on car i, added to `near`: its push, and whether it is the nearest car ahead
  // that i follows.
  private meet(i: number, j: number) {
    const near = this.near;
    const { lookAhead } = this.params;
    const dx = this.x[j] - this.x[i];
    const dy = this.y[j] - this.y[i];
    // Most cars in the nine cells are past the look-ahead: skip them before the square root.
    if (j === i || dx * dx + dy * dy >= lookAhead * lookAhead || !this.streetsMeet(i, j)) return;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) return;
    const hx = this.hx[i];
    const hy = this.hy[i];
    const forward = dx * hx + dy * hy;
    if (forward < near.gap && this.follows(i, j, dx, dy, forward)) {
      near.gap = forward;
      near.leader = j;
    }
    if (this.sameLane(i, j)) {
      // In one lane cars are in single file: pushed along the lane, by the distance along it.
      // Pushed across it, a car creeping up a queue would be squeezed out beside the car it
      // queues behind (the car can't be pushed back, so the push across is all that's left), and
      // a jammed lane would fill two or three abreast.
      const ahead = this.edgeAt[j] - this.edgeAt[i] || (i > j ? 1e-6 : -1e-6);
      const push = this.pushFrom(i, j, dx, dy, Math.abs(ahead), ahead) * Math.sign(ahead);
      near.rx -= push * hx;
      near.ry -= push * hy;
      return;
    }
    const push = this.pushFrom(i, j, dx, dy, d, forward);
    near.rx -= (push * dx) / d;
    near.ry -= (push * dy) / d;
  }

  // Whether car i follows car j, at (dx, dy) from it and `forward` metres along its heading: a car
  // on another street or in another lane going i's way, within half a lane of i's heading, that i
  // gives way to. Cars in i's own lane are ordered by the lane (see `orderLanes`). Without right of
  // way two cars at a merge could each follow the other and wait for each other for ever.
  private follows(i: number, j: number, dx: number, dy: number, forward: number) {
    if (this.sameLane(i, j)) return false;
    const hx = this.hx[i];
    const hy = this.hy[i];
    const inLane = Math.abs(dx * hy - dy * hx) < this.params.laneWidth / 2;
    return forward > 0 && inLane && this.hx[j] * hx + this.hy[j] * hy > 0 && this.yieldsTo(i, j, dx, dy, forward);
  }

  // Right of way: of two cars, the one further into the other's path goes first, and the other
  // gives way to it. Exactly one of any two gives way.
  private yieldsTo(i: number, j: number, dx: number, dy: number, forward: number) {
    const theirs = -(dx * this.hx[j] + dy * this.hy[j]);
    return forward > theirs || (forward === theirs && i > j);
  }

  // Whether cars i and j can meet: either is off the streets, or their streets are the same or share
  // an intersection. Streets that cross with no intersection between them cross on a bridge, and
  // the cars on one don't meet the cars on the other (the street graph has 182 such crossings,
  // most of them at the freeway).
  private streetsMeet(i: number, j: number) {
    const a = this.edge[i];
    const b = this.edge[j];
    if (a < 0 || b < 0 || a === b) return true;
    const router = this.router;
    const [au, av, bu, bv] = [router.edgeStart(a), router.edgeEnd(a), router.edgeStart(b), router.edgeEnd(b)];
    return au === bu || au === bv || av === bu || av === bv;
  }

  // Whether cars i and j drive the same lane of the same street. They are in each other's way
  // however far apart across it the noise or a turn has put them, so a car can't pull up beside the
  // one it is queued behind.
  private sameLane(i: number, j: number) {
    return this.edge[i] >= 0 && this.edge[j] === this.edge[i] && this.lane[j] === this.lane[i];
  }

  // How hard car j, d metres away, pushes car i. Right of way: of two cars, the one further into the
  // other's path goes first, and the other brakes for it; without it two cars meeting at a corner
  // both brake for each other and neither moves. The car that yields feels 1 for a car straight
  // ahead, repulsionBehind straight behind, (1 + cos) / 2 between; the other feels repulsionBehind.
  private pushFrom(i: number, j: number, dx: number, dy: number, d: number, forward: number) {
    const { radius, repulsion, repulsionRange, repulsionBehind } = this.params;
    if (d >= 2 * radius + 4 * repulsionRange) return 0;
    const sight = this.yieldsTo(i, j, dx, dy, forward) ? repulsionBehind + ((1 - repulsionBehind) * (1 + forward / d)) / 2 : repulsionBehind;
    return sight * this.inTheWay(i, j, dx, dy) * repulsion * Math.exp((2 * radius - d) / repulsionRange);
  }

  // How much car j, at (dx, dy) from car i, is in its way: 1 in i's lane, and otherwise by how far
  // across i's heading it is, 1 within a car's width and 0 a lane or more away, so cars side by
  // side in two lanes don't shove each other.
  private inTheWay(i: number, j: number, dx: number, dy: number) {
    if (this.sameLane(i, j)) return 1;
    const { laneWidth, carWidth } = this.params;
    const across = Math.abs(dx * this.hy[i] - dy * this.hx[i]);
    return Math.min(1, Math.max(0, (laneWidth - across) / (laneWidth - carWidth)));
  }

  private forceOn(i: number) {
    const { tau, speedMatching, laneStiffness } = this.params;
    const [rx, ry, leader, gap] = this.neighborsOf(i);
    const edge = this.edge[i];
    const cell = cellIndex(this.ground, this.x[i], this.y[i]);
    const free = this.stuck[i] ? 0 : edge >= 0 ? this.router.edgeSpeed[edge] : cell < 0 ? 0 : this.ground.speed[cell];
    const hx = this.hx[i];
    const hy = this.hy[i];
    const { lookAhead, timeGap } = this.params;
    // Greenshields on the road ahead, and no faster than leaves the safe time gap to the car ahead.
    const safe = Math.max(0, gap - JAM_SPACING_METERS) / timeGap;
    this.pace[i] = this.stuck[i] || free <= 0 ? 0 : Math.min(speedShare(gap, lookAhead), safe / free);
    const forward = this.vx[i] * hx + this.vy[i] * hy;
    let drive = Math.min((free * this.pace[i]) / tau, this.cornerDrive(i, forward));
    // The open-road car relaxes the same way, exactly over the step, and brakes as hard for a corner.
    const open = this.openSpeed[i];
    const openBraking = this.cornerBraking(i, open);
    const relaxed = open + (free - open) * (1 - Math.exp(-this.params.dt / tau));
    this.openSpeed[i] = openBraking > 0 ? Math.min(relaxed, open - openBraking * this.params.dt) : relaxed;
    if (leader >= 0) {
      const closing = (this.vx[leader] - this.vx[i]) * hx + (this.vy[leader] - this.vy[i]) * hy;
      drive += speedMatching * gapWeight(gap, lookAhead) * closing;
    }
    // Braking, for the car ahead or to match its speed, can bring this car to a stop within the
    // step but not drive it backwards. Without this a packed queue pushes its back end ever
    // further back.
    const excess = Math.max(0, -Math.max(0, forward) / this.params.dt - (drive + rx * hx + ry * hy));
    const [ox, oy] = this.laneOffset(i);
    this.fx[i] = drive * hx + rx + excess * hx - laneStiffness * ox;
    this.fy[i] = drive * hy + ry + excess * hy - laneStiffness * oy;
  }

  // The force along the heading that slows car i, going `forward` m/s, at the rate the corner ahead
  // needs over this step (Infinity with no corner to slow for). The step's friction is exact and its
  // force comes in two half kicks around it, so a force of v / tau - need slows the car by only
  // (1 + c1) / 2 of need: 80% at a 1 s step, and cars took right-angle turns at 30 km/h.
  private cornerDrive(i: number, forward: number) {
    const need = this.cornerBraking(i, forward);
    if (need <= 0) return Infinity;
    const { dt, tau } = this.params;
    const c1 = Math.exp(-dt / tau);
    return ((forward * (1 - c1)) / dt - need) * (2 / (1 + c1));
  }

  // Anyone the scenario fire reaches before they get out. A household still at home is where it
  // started, so the fire reaches it when it reaches its home.
  private settle() {
    const minutes = this.minutes;
    for (let i = 0; i < this.count; i++) {
      const state = this.state[i];
      if (state === STATE.arrived || state === STATE.overrun) continue;
      if (state !== STATE.moving) {
        if (this.fireAtHome[i] <= minutes) this.state[i] = STATE.overrun;
        continue;
      }
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
