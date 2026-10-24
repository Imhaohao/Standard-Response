import type { FunctionArgs } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { CallFlow, silentTurn } from "./callFlow";
import type { AgentTurn } from "./conversation";
import { guardAcknowledgment } from "./honesty";
import {
  BedroomFloor,
  BedroomSide,
  CareNeed,
  interpretReadyAnswer,
  ReadyHeard,
  ReadyInterpret,
  ReadyUpdates,
} from "./readyInterpreter";
import { Language, LINES } from "./script";

// The Ready check census call, made before any warning. It asks who lives in the home, what help
// they'd need getting out, where that person sleeps, care needs, and how they'd leave, then saves
// the profile through `ready:saveFromCall`. There is no ride talk: nothing is promised or booked.

export type ReadyProfileArgs = Omit<FunctionArgs<typeof api.ready.saveFromCall>, "householdId">;

type ReadyLines = {
  intro: string;
  notNow: string;
  confirmAddress: (address: string) => string;
  askAddress: string;
  askPeople: string;
  askNeeds: string;
  askAssistance: string;
  askBedroom: string;
  askCare: string;
  askExitPlan: string;
  askHelper: string;
  askHelperPhone: (name: string) => string;
  confirmPhone: (spokenDigits: string) => string;
  askNote: string;
  readbackIntro: string;
  readbackQuestion: string;
  whatToFix: string;
  goodbye: string;
  sorry: string;
  noRideToday: string;
  emergency: string;
  voicemail: string;
  dialysis: string;
  sleeps: (floor: BedroomFloor, side: BedroomSide | undefined) => string;
  care: Record<CareNeed, string>;
  ownCar: string;
  helperPlan: (name: string | undefined) => string;
  needsRide: string;
  addressNote: (address: string) => string;
};

const EN_READY: ReadyLines = {
  intro:
    "This is the Altadena evacuation line. We're calling every household ahead of fire season so that if there's ever an evacuation, we already know who might need help. It takes about two minutes. Is now okay?",
  notNow: "No problem. Thanks for your time. Goodbye.",
  confirmAddress: (address) => `First, I have ${address} on file. Is that right?`,
  askAddress: "What's the right address?",
  askPeople: "How many people live there, and are there any pets?",
  askNeeds: "Does anyone there use a walker or a wheelchair, stay in bed, or need oxygen or dialysis?",
  askAssistance: "How much help would they need getting out: none, one person helping, or two people to lift?",
  askBedroom: "Where does the person who'd need help sleep: on the ground floor, upstairs, or in the basement? And is it at the front or the back?",
  askCare: "Does anyone have trouble hearing, low vision, or memory loss? Does anyone depend on a powered medical device or have a service animal?",
  askExitPlan: "If an evacuation were ordered, how would you get out? In your own car, would someone pick you up, or would you need a ride?",
  askHelper: "Who would pick you up, and what's their phone number?",
  askHelperPhone: (name) => `What's ${name}'s phone number?`,
  confirmPhone: (spokenDigits) => `I have ${spokenDigits}. Is that right?`,
  askNote: "Is there anything a crew should know, like a gate code or where a key is?",
  readbackIntro: "Let me read that back.",
  readbackQuestion: "Is that right?",
  whatToFix: "What should I change?",
  goodbye: "Thank you, that's everything. If there's ever an evacuation, we'll already have this on file. Goodbye.",
  sorry: "Sorry, I didn't catch that.",
  noRideToday: "Today's call only puts your details on file. If there's ever a warning, you can call this number.",
  emergency: "If this is an emergency, please hang up and call 911.",
  voicemail:
    "This is the Altadena evacuation line. We're calling every household ahead of fire season to note who might need help in an evacuation. We'll try you again later.",
  dialysis: "on dialysis",
  sleeps: (floor, side) => `sleeps ${{ ground: "on the ground floor", upstairs: "upstairs", basement: "in the basement" }[floor]}${side ? ` at the ${side}` : ""}`,
  care: {
    hearing: "hard of hearing",
    sight: "low vision",
    memory: "memory loss",
    power_device: "a powered medical device",
    service_animal: "a service animal",
  },
  ownCar: "you'd leave in your own car",
  helperPlan: (name) => `${name ?? "someone"} would pick you up`,
  needsRide: "you'd need a ride",
  addressNote: (address) => `Address given on the call: ${address}`,
};

const ES_READY: ReadyLines = {
  intro:
    "Le llamamos de la línea de evacuación de Altadena. Estamos llamando a cada hogar antes de la temporada de incendios para que, si alguna vez hay una evacuación, ya sepamos quién podría necesitar ayuda. Toma unos dos minutos. ¿Es buen momento?",
  notNow: "No hay problema. Gracias por su tiempo. Adiós.",
  confirmAddress: (address) => `Primero, tengo ${address} registrada. ¿Es correcto?`,
  askAddress: "¿Cuál es la dirección correcta?",
  askPeople: "¿Cuántas personas viven ahí, y tienen mascotas?",
  askNeeds: "¿Alguien ahí usa andadera o silla de ruedas, está en cama, o necesita oxígeno o diálisis?",
  askAssistance: "¿Cuánta ayuda necesitaría para salir: ninguna, una persona que le ayude, o dos personas para levantarle?",
  askBedroom: "¿Dónde duerme la persona que necesitaría ayuda: en la planta baja, arriba o en el sótano? ¿Y es al frente o atrás?",
  askCare: "¿Alguien tiene problemas de audición, de vista o de memoria, depende de un aparato médico eléctrico, o tiene un animal de servicio?",
  askExitPlan: "Si se ordenara una evacuación, ¿cómo saldría? ¿En su propio carro, alguien pasaría por usted, o necesitaría transporte?",
  askHelper: "¿Quién pasaría por usted, y cuál es su número de teléfono?",
  askHelperPhone: (name) => `¿Cuál es el número de teléfono de ${name}?`,
  confirmPhone: (spokenDigits) => `Tengo ${spokenDigits}. ¿Es correcto?`,
  askNote: "¿Hay algo que un equipo debería saber, como el código de una reja o dónde hay una llave?",
  readbackIntro: "Le leo lo que tengo.",
  readbackQuestion: "¿Es correcto?",
  whatToFix: "¿Qué debo cambiar?",
  goodbye: "Gracias, eso es todo. Si alguna vez hay una evacuación, ya tendremos esto registrado. Adiós.",
  sorry: "Perdón, no le entendí.",
  noRideToday: "Esta llamada solo registra sus datos. Si alguna vez hay un aviso, puede llamar a este número.",
  emergency: "Si es una emergencia, cuelgue y llame al 911.",
  voicemail:
    "Le llamamos de la línea de evacuación de Altadena. Estamos llamando a cada hogar antes de la temporada de incendios para saber quién podría necesitar ayuda en una evacuación. Volveremos a llamar más tarde.",
  dialysis: "con diálisis",
  sleeps: (floor, side) => `duerme ${{ ground: "en la planta baja", upstairs: "arriba", basement: "en el sótano" }[floor]}${side ? (side === "front" ? " al frente" : " atrás") : ""}`,
  care: {
    hearing: "problemas de audición",
    sight: "problemas de vista",
    memory: "problemas de memoria",
    power_device: "un aparato médico eléctrico",
    service_animal: "un animal de servicio",
  },
  ownCar: "saldría en su propio carro",
  helperPlan: (name) => `${name ?? "alguien"} pasaría por usted`,
  needsRide: "necesitaría transporte",
  addressNote: (address) => `Dirección dada en la llamada: ${address}`,
};

export const READY_LINES: Partial<Record<Language, ReadyLines>> & { en: ReadyLines } = { en: EN_READY, es: ES_READY };

export const readyLanguage = (language: Language): Language => (READY_LINES[language] ? language : "en");

export interface ReadyCallEffects {
  save(profile: ReadyProfileArgs): void;
}

export type ReadyCallOptions = {
  language: Language;
  addressOnFile?: string;
  residentName?: string;
  effects: ReadyCallEffects;
  interpret?: ReadyInterpret;
};

type Step =
  | "intro"
  | "confirm_address"
  | "ask_address"
  | "people"
  | "needs"
  | "assistance"
  | "bedroom"
  | "care"
  | "exit_plan"
  | "helper"
  | "confirm_phone"
  | "note"
  | "readback"
  | "fix"
  | "done";

// `progress` marks a partial answer (a name before the number) so it doesn't use up a try.
type Transition = { step: Step; lines?: string[]; progress?: boolean };

const MAX_TRIES_PER_STEP = 2;
const MAX_READBACKS = 2;
const MAX_PHONE_REJECTIONS = 2;
const HISTORY_TURNS = 4;
const LIMITED_MOBILITY = new Set(["walker", "manual_wheelchair", "power_wheelchair", "bedbound"]);

// "626 555 0123" read back digit by digit, so text-to-speech doesn't say "six hundred twenty-six".
export function spokenDigits(phone: string) {
  const digits = phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const groups = digits.length === 10 ? [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)] : [digits];
  return groups.map((group) => group.split("").join(" ")).join(", ");
}

export class ReadyCall implements CallFlow {
  readonly language: Language;
  readonly holding = false;
  step: Step = "intro";
  answers: ReadyUpdates = {};
  private readonly options: ReadyCallOptions;
  private readonly lines: ReadyLines;
  private readonly interpret: ReadyInterpret;
  private triesOnStep = 0;
  private readbacks = 0;
  private phoneRejections = 0;
  private changedThisTurn = false;
  private declined = false;
  private saved = false;
  private history: { speaker: "agent" | "resident"; text: string }[] = [];

  constructor(options: ReadyCallOptions) {
    this.options = options;
    this.language = readyLanguage(options.language);
    this.lines = READY_LINES[this.language] ?? READY_LINES.en;
    this.interpret = options.interpret ?? interpretReadyAnswer;
    if (options.residentName) this.answers.residentName = options.residentName;
  }

  get done() {
    return this.step === "done";
  }

  start(): AgentTurn {
    return this.say("", [this.lines.intro]);
  }

  question(): string {
    return QUESTIONS[this.step](this);
  }

  endHold(): AgentTurn {
    return this.say("", []);
  }

  announce(): AgentTurn {
    return this.say("", [this.question()]);
  }

  voicemail(): string[] {
    return [this.lines.voicemail];
  }

  // A resident who hung up partway still counts once they've told us how they'd get out.
  lineClosed() {
    if (this.answers.exitPlan) this.save();
  }

  async hear(utterance: string): Promise<AgentTurn> {
    return (await this.read(utterance))();
  }

  // Nothing follows the closing line, so anything said after it is ignored.
  async read(utterance: string): Promise<() => AgentTurn> {
    if (this.done) return () => silentTurn(this, "close");
    let heard: ReadyHeard | null = null;
    try {
      heard = await this.interpret(this.context(utterance));
    } catch (error) {
      console.error("[ready] interpreter failed", error);
    }
    return () => this.act(utterance, heard);
  }

  private act(utterance: string, heard: ReadyHeard | null): AgentTurn {
    this.history.push({ speaker: "resident", text: utterance });
    if (!heard) return this.say("", [LINES[this.language].repeatPrompt, this.question()]);
    if (!heard.addressedToAgent && !heard.emergency) return this.ignore();
    const asides = this.asidesFor(heard);
    if (heard.wantsRepeat) return this.say("", [...asides, this.question()]);
    if (heard.wantsToEnd) return this.endEarly(asides);
    return this.advance(heard, asides);
  }

  private advance(heard: ReadyHeard, asides: string[]): AgentTurn {
    this.apply(heard.updates);
    const transition = STEP_HANDLERS[this.step](this, heard);
    this.moveTo(transition);
    if (this.done && !this.declined) this.save();
    return this.reply(heard, [...asides, ...(transition.lines ?? [])]);
  }

  // Said before the next question without changing where the call is.
  private asidesFor(heard: ReadyHeard) {
    const emergency = heard.emergency ? [this.lines.emergency] : [];
    return heard.asksAboutRide ? [...emergency, this.lines.noRideToday] : emergency;
  }

  private reply(heard: ReadyHeard, extra: string[]): AgentTurn {
    const ack = this.done ? "" : guardAcknowledgment(heard.acknowledgment, "none", this.language).text;
    return this.say(ack, [...extra, ...this.closingLines()]);
  }

  private closingLines() {
    if (!this.done) return [this.question()];
    return this.declined ? [] : [this.lines.goodbye];
  }

  private endEarly(asides: string[]): AgentTurn {
    this.step = "done";
    this.lineClosed();
    return this.say("", [...asides, this.lines.notNow].filter((line) => line !== ""));
  }

  private apply(updates: ReadyUpdates) {
    const before = JSON.stringify(this.answers);
    this.answers = { ...this.answers, ...updates };
    if (updates.exitPlan === "own_car") this.answers.hasCar = true;
    this.changedThisTurn = JSON.stringify(this.answers) !== before;
  }

  private moveTo({ step, progress }: Transition) {
    this.triesOnStep = step === this.step && !progress ? this.triesOnStep + 1 : 0;
    this.step = step;
  }

  triesOnStepLeft() {
    return this.triesOnStep + 1 < MAX_TRIES_PER_STEP;
  }

  // Give up on a step after two tries rather than trap the resident in a loop.
  retryOr(fallback: Step): Transition {
    if (!this.triesOnStepLeft()) return { step: fallback };
    return { step: this.step, lines: [this.lines.sorry] };
  }

  get changed() {
    return this.changedThisTurn;
  }

  decline(): Transition {
    this.declined = true;
    return { step: "done", lines: [this.lines.notNow] };
  }

  firstQuestion(): Step {
    return this.options.addressOnFile ? "confirm_address" : "ask_address";
  }

  needsHelpInside() {
    const { mobility, medical, assistanceRequired } = this.answers;
    const limited = mobility !== undefined && LIMITED_MOBILITY.has(mobility);
    return limited || (medical?.length ?? 0) > 0 || (assistanceRequired !== undefined && assistanceRequired !== "none");
  }

  afterNeeds(): Step {
    const limited = this.answers.mobility !== undefined && LIMITED_MOBILITY.has(this.answers.mobility);
    if (limited && this.answers.assistanceRequired === undefined) return "assistance";
    return this.needsHelpInside() ? "bedroom" : "care";
  }

  afterExitPlan(): Step {
    if (this.answers.exitPlan !== "helper") return "note";
    return this.answers.helperPhone ? "confirm_phone" : "helper";
  }

  // A number read back wrong is asked for again, twice at most.
  rejectPhone(): Step {
    this.phoneRejections += 1;
    this.answers = { ...this.answers, helperPhone: undefined };
    return this.phoneRejections >= MAX_PHONE_REJECTIONS ? "note" : "helper";
  }

  readbackDone() {
    this.readbacks += 1;
    return this.readbacks >= MAX_READBACKS;
  }

  readbackQuestion() {
    return `${this.lines.readbackIntro} ${capitalize(readbackParts(this.answers, this.language).join(", "))}. ${this.lines.readbackQuestion}`;
  }

  helperQuestion() {
    const name = this.answers.helperName;
    return name ? this.lines.askHelperPhone(name) : this.lines.askHelper;
  }

  addressQuestion() {
    return this.lines.confirmAddress(this.options.addressOnFile ?? "");
  }

  phoneQuestion() {
    return this.lines.confirmPhone(spokenDigits(this.answers.helperPhone ?? ""));
  }

  get readyLines() {
    return this.lines;
  }

  private save() {
    if (this.saved) return;
    this.saved = true;
    this.options.effects.save(profileFrom(this.answers, this.lines));
  }

  private context(utterance: string) {
    return {
      language: this.language,
      step: this.step,
      question: this.question(),
      answers: { ...this.answers },
      recentTurns: this.history.slice(-HISTORY_TURNS),
      utterance,
    };
  }

  private say(acknowledgment: string, sentences: string[]): AgentTurn {
    this.history.push({ speaker: "agent", text: [acknowledgment, ...sentences].filter(Boolean).join(" ") });
    return { acknowledgment, sentences, stage: this.done ? "close" : "household", done: this.done, guardBlocked: false, ignored: false };
  }

  private ignore(): AgentTurn {
    this.history.pop();
    return silentTurn(this, "household");
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function needsParts(answers: ReadyUpdates, language: Language) {
  const lines = LINES[language];
  const ready = READY_LINES[language] ?? READY_LINES.en;
  return [
    answers.mobility ? lines.mobility[answers.mobility] : undefined,
    answers.medical?.includes("oxygen") ? lines.oxygen : undefined,
    answers.medical?.includes("dialysis") ? ready.dialysis : undefined,
    answers.assistanceRequired && answers.assistanceRequired !== "none" ? lines.assistance[answers.assistanceRequired] : undefined,
    answers.bedroomFloor ? ready.sleeps(answers.bedroomFloor, answers.bedroomSide) : undefined,
    ...(answers.care ?? []).map((need) => ready.care[need]),
  ];
}

function exitPlanPart(answers: ReadyUpdates, ready: ReadyLines) {
  if (answers.exitPlan === "own_car") return ready.ownCar;
  if (answers.exitPlan === "helper") return ready.helperPlan(answers.helperName);
  return answers.exitPlan === "needs_ride" ? ready.needsRide : undefined;
}

function readbackParts(answers: ReadyUpdates, language: Language) {
  const lines = LINES[language];
  const ready = READY_LINES[language] ?? READY_LINES.en;
  return [
    answers.peopleCount !== undefined ? lines.people(answers.peopleCount) : undefined,
    answers.pets ? lines.pets : undefined,
    ...needsParts(answers, language),
    exitPlanPart(answers, ready),
  ].filter((part): part is string => part !== undefined);
}

// A helper without a confirmed phone can't be called on the night, so it stays a note for a person.
function helperFrom(answers: ReadyUpdates) {
  if (answers.exitPlan !== "helper" || !answers.helperName || !answers.helperPhone) return undefined;
  return { name: answers.helperName, phone: answers.helperPhone, relation: answers.helperRelation };
}

function noteFrom(answers: ReadyUpdates, lines: ReadyLines) {
  const unreachableHelper = answers.exitPlan === "helper" && answers.helperName && !answers.helperPhone
    ? `Helper ${answers.helperName}, no phone number confirmed`
    : undefined;
  const parts = [answers.address ? lines.addressNote(answers.address) : undefined, unreachableHelper, answers.note];
  const note = parts.filter((part): part is string => Boolean(part)).join(". ");
  return note === "" ? undefined : note;
}

// A household that never said how it would leave is treated as needing a ride: the safer default.
export function profileFrom(answers: ReadyUpdates, lines: ReadyLines): ReadyProfileArgs {
  return {
    residentName: answers.residentName,
    peopleCount: answers.peopleCount,
    mobility: answers.mobility,
    assistanceRequired: answers.assistanceRequired,
    medical: answers.medical,
    pets: answers.pets,
    hasCar: answers.hasCar,
    exitPlan: answers.exitPlan ?? "needs_ride",
    bedroom: answers.bedroomFloor ? { floor: answers.bedroomFloor, side: answers.bedroomSide } : undefined,
    care: answers.care ?? [],
    note: noteFrom(answers, lines),
    helper: helperFrom(answers),
  };
}

type Handler = (call: ReadyCall, heard: ReadyHeard) => Transition;

const intro: Handler = (call, heard) => {
  if (heard.answer === "yes" || call.changed) return { step: call.firstQuestion() };
  if (heard.answer === "no") return call.decline();
  return call.triesOnStepLeft() ? { step: "intro", lines: [call.readyLines.sorry] } : call.decline();
};

const confirmAddress: Handler = (call, heard) => {
  if (heard.answer === "yes" || heard.updates.address) return { step: "people" };
  if (heard.answer === "no") return { step: "ask_address" };
  return call.retryOr("people");
};

const askAddress: Handler = (call, heard) => (heard.updates.address ? { step: "people" } : call.retryOr("people"));

const people: Handler = (call) => (call.answers.peopleCount !== undefined ? { step: "needs" } : call.retryOr("needs"));

const needs: Handler = (call, heard) => {
  if (heard.answer === "no" && call.answers.mobility === undefined) {
    call.answers = { ...call.answers, mobility: "walks", medical: call.answers.medical ?? [] };
  }
  const answered = call.answers.mobility !== undefined || call.answers.medical !== undefined;
  return answered ? { step: call.afterNeeds() } : call.retryOr("care");
};

const assistance: Handler = (call, heard) => {
  if (heard.answer === "no" && call.answers.assistanceRequired === undefined) {
    call.answers = { ...call.answers, assistanceRequired: "none" };
  }
  return call.answers.assistanceRequired !== undefined ? { step: "bedroom" } : call.retryOr("bedroom");
};

const bedroom: Handler = (call) => (call.answers.bedroomFloor ? { step: "care" } : call.retryOr("care"));

const care: Handler = (call, heard) => {
  if (heard.answer === "no" && call.answers.care === undefined) call.answers = { ...call.answers, care: [] };
  return call.answers.care !== undefined ? { step: "exit_plan" } : call.retryOr("exit_plan");
};

const exitPlan: Handler = (call) => (call.answers.exitPlan ? { step: call.afterExitPlan() } : call.retryOr("note"));

// Giving the name first and the number next is progress, not a failed try.
const helper: Handler = (call) => {
  if (call.answers.helperPhone) return { step: "confirm_phone" };
  if (call.changed) return { step: "helper", progress: true };
  return call.retryOr("note");
};

const confirmPhone: Handler = (call, heard) => {
  if (heard.updates.helperPhone) return { step: "confirm_phone" };
  if (heard.answer === "yes") return { step: "note" };
  if (heard.answer === "no") return { step: call.rejectPhone() };
  return call.retryOr("note");
};

const note: Handler = (call, heard) => {
  if (heard.answer === "no" || call.answers.note) return { step: "readback" };
  return call.retryOr("readback");
};

const readback: Handler = (call, heard) => {
  if (call.readbackDone()) return { step: "done" };
  if (call.changed) return { step: "readback" };
  if (heard.answer === "no") return { step: "fix" };
  return heard.answer === "yes" ? { step: "done" } : { step: "readback" };
};

const fix: Handler = (call) => (call.changed ? { step: "readback" } : call.retryOr("done"));

const STEP_HANDLERS: Record<Step, Handler> = {
  intro,
  confirm_address: confirmAddress,
  ask_address: askAddress,
  people,
  needs,
  assistance,
  bedroom,
  care,
  exit_plan: exitPlan,
  helper,
  confirm_phone: confirmPhone,
  note,
  readback,
  fix,
  done: () => ({ step: "done" }),
};

const QUESTIONS: Record<Step, (call: ReadyCall) => string> = {
  intro: (call) => call.readyLines.intro,
  confirm_address: (call) => call.addressQuestion(),
  ask_address: (call) => call.readyLines.askAddress,
  people: (call) => call.readyLines.askPeople,
  needs: (call) => call.readyLines.askNeeds,
  assistance: (call) => call.readyLines.askAssistance,
  bedroom: (call) => call.readyLines.askBedroom,
  care: (call) => call.readyLines.askCare,
  exit_plan: (call) => call.readyLines.askExitPlan,
  helper: (call) => call.helperQuestion(),
  confirm_phone: (call) => call.phoneQuestion(),
  note: (call) => call.readyLines.askNote,
  readback: (call) => call.readbackQuestion(),
  fix: (call) => call.readyLines.whatToFix,
  done: (call) => call.readyLines.goodbye,
};
