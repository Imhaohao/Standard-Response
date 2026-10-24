import { privateUpdate } from "../mesh/federated";
import { privacySpent } from "../mesh/privacy";
import { IdSource, Random } from "../mesh/random";
import { AREA_INDEX } from "./areas";
import { ChannelPool, countsVector, isValidMix, Mix, SURVEY_CHANNEL, updateVector, UPLOAD_MIN_MASS } from "./mixing";
import { answeredCount, Answers, cleanAnswers, questionsFor, Topic, TOPICS } from "./survey";
import { Draws, TALLY_EPSILON, TALLY_ITEMS, tallyVector, truthOf } from "./tally";
import { exampleOf, initialModel, isValidSurveyModel, SURVEY_TRAINING, SurveyModel, TASK_IDS, TASKS, TaskId } from "./tasks";

// One household's phone in the readiness survey. Answers stay on it. With the household's consent,
// topic by topic and once the topic is fully answered, the phone adds a randomized-response count
// of its answers to the survey's counts once. For each new version of that topic's model, if the
// county's sample rate picks it, it adds a noised update, up to SURVEY_TRAINING.maxContributions.
// Both go into the push-sum pool and travel only as mixes.
//
// A meeting between phones: both send `hello` with their model versions and what they hold per
// channel. Each sends any newer model it has, and half of each channel the other holds more of
// (gateways count as heaviest). No answer, area or identifier is ever in a message: the hello's
// session id is fresh for every meeting.

export const PROTOCOL = 1;
export const MAX_HOPS = 32;
// A route to a gateway not heard of again for this long is forgotten (the gateway may be offline).
export const ROUTE_TTL_MS = 24 * 60 * 60_000;

export type Holding = { channel: string; mass: number };
export type Hello = {
  type: "hello";
  protocol: number;
  session: string;
  versions: Record<TaskId, number>;
  holding: Holding[];
  sink: boolean;
  // How many meetings away this phone thinks the nearest gateway is (MAX_HOPS when it doesn't know).
  hops: number;
};
export type ModelMessage = { type: "model"; task: TaskId; model: SurveyModel };
export type MixMessage = { type: "mix"; transfer: string; mix: Mix };
export type SurveyMessage = Hello | ModelMessage | MixMessage;

export type MeetingResult = { modelsUpdated: number; massReceived: number };
export const emptyResult = (): MeetingResult => ({ modelsUpdated: 0, massReceived: 0 });

export type Consent = Record<Topic, boolean>;
export const NO_CONSENT: Consent = { water: false, money: false, health: false };

export type PhoneOptions = { newId: IdSource; random: Random; now: () => number };

export type SurveySnapshot = {
  answers: Answers;
  area: string | null;
  consent: Consent;
  models: Partial<Record<TaskId, SurveyModel>>;
  mixes: Mix[];
  draws: Draws;
  contributed: Partial<Record<TaskId, number[]>>;
  asked: Partial<Record<TaskId, number[]>>;
  counted: Topic[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isValidHello(value: Record<string, unknown>): value is Hello {
  if (value.type !== "hello" || value.protocol !== PROTOCOL || typeof value.session !== "string" || value.session.length > 64) return false;
  if (typeof value.sink !== "boolean" || !isRecord(value.versions)) return false;
  if (!Number.isInteger(value.hops) || (value.hops as number) < 0 || (value.hops as number) > MAX_HOPS) return false;
  const versions = value.versions;
  if (!TASK_IDS.every((task) => Number.isInteger(versions[task]) && (versions[task] as number) >= 0)) return false;
  return (
    Array.isArray(value.holding) &&
    value.holding.length <= 16 &&
    value.holding.every((h) => isRecord(h) && typeof h.channel === "string" && typeof h.mass === "number" && Number.isFinite(h.mass) && h.mass >= 0)
  );
}

export class SurveyPhone {
  answers: Answers = {};
  area: string | null = null;
  consent: Consent = { ...NO_CONSENT };
  readonly models = {} as Record<TaskId, SurveyModel>;
  readonly pool = new ChannelPool();
  // Set while this phone has internet and its owner agreed to upload for others.
  sink = false;
  private draws: Draws = {};
  private contributed = {} as Record<TaskId, Set<number>>;
  // Versions this phone has drawn for at the county's sample rate, taking part or not. Drawn once.
  private asked = {} as Record<TaskId, Set<number>>;
  // Topics whose counts this phone has already added to the survey. Each is counted once.
  private counted = new Set<Topic>();
  private session = "";
  // The best route to a gateway this phone has heard of, and when.
  private route = { hops: MAX_HOPS, at: 0 };

  constructor(private readonly options: PhoneOptions) {
    for (const task of TASK_IDS) {
      this.models[task] = initialModel(task);
      this.contributed[task] = new Set();
      this.asked[task] = new Set();
    }
  }

  // ---- What the household does ----

  answer(answers: Answers) {
    this.answers = cleanAnswers({ ...this.answers, ...answers });
    this.share();
  }

  setArea(area: string | null) {
    if (area !== null && !AREA_INDEX.has(area)) return;
    // Counts already sent stay in the area they were sent for.
    this.area = area;
    this.share();
  }

  setConsent(topic: Topic, agreed: boolean) {
    this.consent = { ...this.consent, [topic]: agreed };
    if (agreed) this.share();
  }

  // A topic is shared only once every question in it is answered, so a half-filled topic never
  // sends counts or an update built on blanks. Every question has a "Not sure" or "No" to pick.
  isComplete(topic: Topic) {
    return answeredCount(this.answers, topic) === questionsFor(topic).length;
  }

  // Adds whatever the household has agreed to and not yet added.
  share() {
    for (const topic of TOPICS) this.countTopic(topic);
    for (const task of TASK_IDS) this.contribute(task);
  }

  private countTopic(topic: Topic) {
    if (!this.consent[topic] || !this.isComplete(topic) || this.counted.has(topic) || this.area === null) return false;
    const vector = tallyVector(AREA_INDEX.get(this.area)!, topic, this.answers, this.draws, this.options.random);
    if (!vector) return false;
    this.pool.contribute(SURVEY_CHANNEL, countsVector(vector));
    this.counted.add(topic);
    return true;
  }

  private contribute(task: TaskId) {
    const model = this.models[task];
    const done = this.contributed[task];
    const topic = TASKS[task].topic;
    if (!this.consent[topic] || !this.isComplete(topic) || done.has(model.version) || done.size >= SURVEY_TRAINING.maxContributions) return false;
    const example = exampleOf(task, this.answers);
    if (!example || this.asked[task].has(model.version)) return false;
    this.asked[task].add(model.version);
    if (this.options.random() >= model.sampleRate) return false;
    const update = privateUpdate(model, [example], SURVEY_TRAINING, this.options.random);
    this.pool.contribute(SURVEY_CHANNEL, updateVector(task, update, model.version));
    done.add(model.version);
    return true;
  }

  // ---- What the household has given away ----

  // Per topic: ε of its model updates (Gaussian, composed exactly in Gaussian differential
  // privacy) plus ε = ln 4 for each count it added, added up (basic composition, an upper bound).
  privacy(topic: Topic, delta = 1e-5) {
    const updates = TASK_IDS.filter((task) => TASKS[task].topic === topic).reduce((n, task) => n + this.contributed[task].size, 0);
    const model = privacySpent(SURVEY_TRAINING.noiseMultiplier, updates, delta).epsilon;
    const counts = this.counted.has(topic) ? TALLY_ITEMS.filter((item) => item.topic === topic && truthOf(item, this.answers) !== null).length : 0;
    return { epsilon: model + counts * TALLY_EPSILON, delta, updates, counts };
  }

  updates(task: TaskId) {
    return this.contributed[task].size;
  }

  isCounted(topic: Topic) {
    return this.counted.has(topic);
  }

  // ---- Meeting another phone ----

  emptyResult(): MeetingResult {
    return emptyResult();
  }

  hello(): Hello {
    this.session = this.options.newId();
    const versions = Object.fromEntries(TASK_IDS.map((task) => [task, this.models[task].version])) as Record<TaskId, number>;
    return { type: "hello", protocol: PROTOCOL, session: this.session, versions, holding: this.pool.holding(), sink: this.sink, hops: this.hops() };
  }

  // Meetings to the nearest gateway: 0 for a gateway, else one more than the best route heard of
  // in the last ROUTE_TTL_MS.
  hops() {
    if (this.sink) return 0;
    return this.options.now() - this.route.at > ROUTE_TTL_MS ? MAX_HOPS : this.route.hops;
  }

  private learnRoute(hello: Hello) {
    const hops = Math.min(hello.hops + 1, MAX_HOPS);
    if (hops < MAX_HOPS && hops <= this.hops()) this.route = { hops, at: this.options.now() };
  }

  // Mass flows downhill toward gateways, as in a sensor network's collection tree (Gnawali et al.
  // 2009): to a phone closer to a gateway, or as close and holding more, so it also gathers into
  // fewer, heavier mixes; ties go by session id. Without the distance, mass would pile up on
  // whichever ordinary phone happened to hold the most and stay there if no gateway passed by.
  private givesTo(hello: Hello) {
    const mine = this.hops();
    if (hello.hops !== mine) return hello.hops < mine;
    const held = this.pool.totalMass();
    const theirs = hello.holding.reduce((sum, h) => sum + h.mass, 0);
    return theirs > held || (theirs === held && hello.session > this.session);
  }

  receive(message: unknown, result?: MeetingResult): SurveyMessage[] {
    if (!isRecord(message)) return [];
    if (message.type === "hello") return isValidHello(message) ? this.answerHello(message) : [];
    if (message.type === "model" && TASK_IDS.includes(message.task as TaskId)) {
      if (this.adoptModel(message.task as TaskId, message.model) && result) result.modelsUpdated += 1;
    } else if (message.type === "mix") {
      const { transfer, mix } = message;
      if (typeof transfer === "string" && transfer.length <= 64 && isValidMix(mix) && this.pool.absorb(mix, transfer) && result) result.massReceived += mix.mass;
    }
    return [];
  }

  private answerHello(hello: Hello): SurveyMessage[] {
    const replies: SurveyMessage[] = [];
    this.learnRoute(hello);
    for (const task of TASK_IDS) if (this.models[task].version > hello.versions[task]) replies.push({ type: "model", task, model: this.models[task] });
    if (this.givesTo(hello)) for (const { transfer, mix } of this.pool.splitHalf(this.options.newId)) replies.push({ type: "mix", transfer, mix });
    return replies;
  }

  // A newer model from a peer or the county replaces this phone's, then the phone may contribute to it.
  adoptModel(task: TaskId, model: unknown) {
    if (!isValidSurveyModel(task, model) || model.version <= this.models[task].version) return false;
    const { version, weights, issuedAt, contributors, sampleRate } = model;
    this.models[task] = { version, weights: [...weights], issuedAt, contributors, sampleRate };
    this.contribute(task);
    return true;
  }

  // ---- Uploading, when this phone is a gateway with internet ----

  // Taking the mixes removes them from this phone, so call `restoreUpload` if the upload fails.
  takeUpload(minMass = UPLOAD_MIN_MASS) {
    return this.pool.drain(minMass);
  }

  restoreUpload(mixes: Mix[]) {
    for (const mix of mixes) this.pool.absorb(mix);
  }

  // ---- Keeping state across page loads ----

  snapshot(): SurveySnapshot {
    return {
      answers: this.answers,
      area: this.area,
      consent: this.consent,
      models: { ...this.models },
      mixes: this.pool.all(),
      draws: { ...this.draws },
      contributed: Object.fromEntries(TASK_IDS.map((task) => [task, [...this.contributed[task]]])),
      asked: Object.fromEntries(TASK_IDS.map((task) => [task, [...this.asked[task]]])),
      counted: [...this.counted],
    };
  }

  // What was already given comes back before any model, so restoring never contributes twice.
  restore(snapshot: Partial<SurveySnapshot>) {
    this.restoreAnswers(snapshot);
    this.restoreGiven(snapshot);
    for (const mix of snapshot.mixes ?? []) if (isValidMix(mix)) this.pool.absorb(mix);
    for (const task of TASK_IDS) this.adoptModel(task, snapshot.models?.[task]);
  }

  private restoreAnswers(snapshot: Partial<SurveySnapshot>) {
    this.answers = cleanAnswers(snapshot.answers);
    if (typeof snapshot.area === "string" && AREA_INDEX.has(snapshot.area)) this.area = snapshot.area;
    if (isRecord(snapshot.consent)) for (const topic of TOPICS) this.consent[topic] = snapshot.consent[topic] === true;
  }

  private restoreGiven(snapshot: Partial<SurveySnapshot>) {
    if (isRecord(snapshot.draws)) for (const [key, value] of Object.entries(snapshot.draws)) if (typeof value === "boolean") this.draws[key] = value;
    for (const task of TASK_IDS) {
      addVersions(this.contributed[task], snapshot.contributed?.[task]);
      addVersions(this.asked[task], snapshot.asked?.[task]);
    }
    for (const topic of snapshot.counted ?? []) if (TOPICS.includes(topic)) this.counted.add(topic);
  }
}

function addVersions(into: Set<number>, versions: unknown) {
  if (Array.isArray(versions)) for (const version of versions) if (Number.isInteger(version)) into.add(version);
}

// A whole meeting between two phones in memory, for the simulation and the tests.
export function meet(a: SurveyPhone, b: SurveyPhone) {
  const results = { a: emptyResult(), b: emptyResult() };
  let toB: SurveyMessage[] = [a.hello()];
  let toA: SurveyMessage[] = [b.hello()];
  for (let round = 0; round < 4 && (toA.length > 0 || toB.length > 0); round++) {
    const nextToA = toB.flatMap((message) => b.receive(message, results.b));
    const nextToB = toA.flatMap((message) => a.receive(message, results.a));
    toA = nextToA;
    toB = nextToB;
  }
  return results;
}
