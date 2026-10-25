import type { FunctionArgs } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { NOBODY } from "./answerPatterns";
import { checkAsk, GoalPrompt } from "./askLine";
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
import { withoutRepeatedSentences } from "./sentences";

// The Ready check census call, made before any warning. It asks who lives in the home, what help
// they'd need getting out, where that person sleeps, care needs, and how they'd leave, then saves
// the profile through `ready:saveFromCall`. There is no ride talk: nothing is promised or booked.
// Code picks each question; Claude may word it (askLine.ts), and the templates below are the fallback.

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
  // A helper already on file, confirmed rather than asked for again.
  confirmHelperOnFile: (name: string, spokenDigits: string) => string;
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
  // Each question again in other words, so a resident asked twice never hears the same sentence.
  askAgain: {
    intro: string;
    confirmAddress: (address: string) => string;
    askAddress: string;
    people: string;
    needs: string;
    assistance: string;
    bedroom: string;
    care: string;
    exitPlan: string;
    helper: string;
    helperPhone: (name: string) => string;
    confirmPhone: (spokenDigits: string) => string;
    note: string;
    readback: string;
    fix: string;
  };
};

const EN_READY: ReadyLines = {
  intro:
    "This is 911 in Altadena, and there's no emergency. We're calling every household ahead of fire season so that if there's ever an evacuation, we already know who might need help. It takes about two minutes. Is now okay?",
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
  confirmHelperOnFile: (name, spokenDigits) => `We have ${name} at ${spokenDigits} down to pick you up. Is that still right?`,
  askNote: "Is there anything a crew should know, like a gate code or where a key is?",
  readbackIntro: "Let me read that back.",
  readbackQuestion: "Is that right?",
  whatToFix: "What should I change?",
  goodbye: "Thank you, that's everything. If there's ever an evacuation, we'll already have this on file. Goodbye.",
  sorry: "Sorry, I didn't catch that.",
  noRideToday: "Today's call only puts your details on file. If there's ever a warning, you can call this number.",
  emergency: "This call can only take your details. If this is an emergency, hang up and dial 911 so a dispatcher can send help.",
  voicemail:
    "This is 911 in Altadena, and there's no emergency. We're calling every household ahead of fire season to note who might need help in an evacuation. We'll try you again later.",
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
  askAgain: {
    intro: "Do you have two minutes to go over this now?",
    confirmAddress: (address) => `Just to check: is ${address} the home's address?`,
    askAddress: "Can you tell me the street address of the home?",
    people: "Counting yourself, how many people live in the home? Any dogs, cats or other pets?",
    needs: "Does anyone there have trouble walking, use a wheelchair, or need oxygen or dialysis?",
    assistance: "Could they get out with one person helping, or would it take two people to lift them?",
    bedroom: "Which floor is that person's bedroom on, and is it at the front or the back of the house?",
    care: "Is anyone hard of hearing or low vision, or forgetful? Does anyone rely on a medical device that plugs in, or a service animal?",
    exitPlan: "Say you had to leave in a hurry: would you drive, would a friend or family member come for you, or would you need a ride from us?",
    helper: "Is there a friend, relative or neighbor who would drive you out? What's their phone number?",
    helperPhone: (name) => `What number should we call to reach ${name}?`,
    confirmPhone: (spokenDigits) => `Just to check, the number is ${spokenDigits}?`,
    note: "Anything that would help firefighters get in, like a gate code or where a spare key is?",
    readback: "Did I get all of that right?",
    fix: "Tell me the part that's wrong, and I'll change it.",
  },
};

const ES_READY: ReadyLines = {
  intro:
    "Le llamamos del 911 en Altadena, y no hay ninguna emergencia. Estamos llamando a cada hogar antes de la temporada de incendios para que, si alguna vez hay una evacuación, ya sepamos quién podría necesitar ayuda. Toma unos dos minutos. ¿Es buen momento?",
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
  confirmHelperOnFile: (name, spokenDigits) => `Tenemos a ${name}, al ${spokenDigits}, para pasar por usted. ¿Sigue siendo así?`,
  askNote: "¿Hay algo que un equipo debería saber, como el código de una reja o dónde hay una llave?",
  readbackIntro: "Le leo lo que tengo.",
  readbackQuestion: "¿Es correcto?",
  whatToFix: "¿Qué debo cambiar?",
  goodbye: "Gracias, eso es todo. Si alguna vez hay una evacuación, ya tendremos esto registrado. Adiós.",
  sorry: "Perdón, no le entendí.",
  noRideToday: "Esta llamada solo registra sus datos. Si alguna vez hay un aviso, puede llamar a este número.",
  emergency: "Esta llamada solo registra sus datos. Si es una emergencia, cuelgue y marque el 911 para que un despachador le mande ayuda.",
  voicemail:
    "Le llamamos del 911 en Altadena, y no hay ninguna emergencia. Estamos llamando a cada hogar antes de la temporada de incendios para saber quién podría necesitar ayuda en una evacuación. Volveremos a llamar más tarde.",
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
  askAgain: {
    intro: "¿Tiene dos minutos para repasar esto ahora?",
    confirmAddress: (address) => `Solo para confirmar: ¿la dirección de la casa es ${address}?`,
    askAddress: "¿Me puede decir la dirección de la casa?",
    people: "Contándole a usted, ¿cuántas personas viven en la casa? ¿Algún perro, gato u otra mascota?",
    needs: "¿Alguien ahí tiene dificultad para caminar, usa silla de ruedas, o necesita oxígeno o diálisis?",
    assistance: "¿Podría salir con una persona que le ayude, o harían falta dos personas para levantarle?",
    bedroom: "¿En qué piso está el cuarto de esa persona, y es al frente o atrás de la casa?",
    care: "¿Alguien oye poco, ve poco o tiene problemas de memoria? ¿Alguien depende de un aparato médico que se enchufa, o tiene un animal de servicio?",
    exitPlan: "Si tuviera que salir de prisa, ¿manejaría usted, vendría por usted un familiar o amigo, o necesitaría transporte de nosotros?",
    helper: "¿Hay un amigo, familiar o vecino que le sacaría en su carro? ¿Cuál es su número de teléfono?",
    helperPhone: (name) => `¿A qué número llamamos para hablar con ${name}?`,
    confirmPhone: (spokenDigits) => `Solo para confirmar, ¿el número es ${spokenDigits}?`,
    note: "¿Hay algo que ayude a los bomberos a entrar, como el código de una reja o dónde hay una llave?",
    readback: "¿Anoté todo bien?",
    fix: "Dígame qué parte está mal y la cambio.",
  },
};

export const READY_LINES: Partial<Record<Language, ReadyLines>> & { en: ReadyLines } = { en: EN_READY, es: ES_READY };

export const readyLanguage = (language: Language): Language => (READY_LINES[language] ? language : "en");

export interface ReadyCallEffects {
  save(profile: ReadyProfileArgs): void;
}

export type HelperOnFile = { name: string; phone: string; relation?: string };

export type ReadyCallOptions = {
  language: Language;
  addressOnFile?: string;
  residentName?: string;
  // Who already agreed to pick this home up. Without it, a call that didn't hear the number again
  // would save a profile with no helper and drop the arrangement.
  helperOnFile?: HelperOnFile;
  effects: ReadyCallEffects;
  interpret?: ReadyInterpret;
};

type Step =
  | "intro"
  | "confirm_address"
  | "ask_address"
  | "people"
  | "needs"
  | "chair_kind"
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
// `retry` asks the same question again, in other words.
type Transition = { step: Step; lines?: string[]; progress?: boolean; retry?: boolean };

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

// "David" and "David Wu" are the same helper; a different first name is someone new.
const firstName = (name: string) => name.trim().split(/\s+/)[0].toLowerCase();
const sameName = (a: string, b: string) => firstName(a) === firstName(b);

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
  private unsureThisTurn = false;
  private declined = false;
  // Whether we've asked if a wheelchair has a motor: "wheelchair" alone doesn't tell a crew or a
  // neighbor whether it's a 400-pound battery chair.
  chairKindAsked = false;
  // Whether the helper being confirmed came from the file rather than from this call.
  private helperFromFile = false;
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

  questionAgain(): string {
    return QUESTIONS_AGAIN[this.step](this);
  }

  // The question again in other words, or as first put when the rephrasing was the last thing said.
  private askAgain() {
    const again = this.questionAgain();
    return this.lastAgentLine().includes(again) ? this.question() : again;
  }

  private lastAgentLine() {
    return this.history.findLast((line) => line.speaker === "agent")?.text ?? "";
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
    if (!heard) return this.say("", [LINES[this.language].repeatPrompt, this.askAgain()]);
    if (!heard.addressedToAgent && !heard.emergency) return this.ignore();
    const asides = this.asidesFor(heard);
    if (heard.wantsRepeat) return this.say("", [...asides, this.question()]);
    if (heard.wantsToEnd) return this.endEarly(asides);
    return this.advance(this.withNobody(heard, utterance), asides);
  }

  // "Nobody, nobody will." to the helper question set no field, so the same question came back four
  // times. Nobody to pick them up is an answer: they'd need a ride.
  private withNobody(heard: ReadyHeard, utterance: string): ReadyHeard {
    const { exitPlan, helperName, helperPhone } = heard.updates;
    const asked = this.step === "exit_plan" || this.step === "helper";
    if (!asked || !NOBODY.test(utterance) || helperName || helperPhone || (exitPlan && exitPlan !== "helper")) return heard;
    return { ...heard, updates: { ...heard.updates, exitPlan: "needs_ride" } };
  }

  private advance(heard: ReadyHeard, asides: string[]): AgentTurn {
    this.apply(heard.updates);
    this.unsureThisTurn = heard.unsure === true;
    const transition = this.pastAnswered(STEP_HANDLERS[this.step](this, heard));
    this.moveTo(transition);
    if (this.done && !this.declined) this.save();
    return this.reply(heard, transition, asides);
  }

  // A question whose answer an earlier one already gave is passed: "Me and my husband, he uses an
  // electric wheelchair" was then asked how many people live there and whether anyone uses a
  // wheelchair, and "upstairs, the back bedroom" was asked where they sleep. Each step's handler, run
  // with nothing new heard, moves on from a step that is answered.
  private pastAnswered(transition: Transition): Transition {
    let landed = transition;
    while (!landed.retry && landed.step !== this.step && PASSABLE.has(landed.step) && !STILL_OPEN[landed.step](this)) {
      landed = STEP_HANDLERS[landed.step](this, NOTHING_HEARD);
    }
    return landed;
  }

  // Said before the next question without changing where the call is.
  private asidesFor(heard: ReadyHeard) {
    const emergency = heard.emergency ? [this.lines.emergency] : [];
    return heard.asksAboutRide ? [...emergency, this.lines.noRideToday] : emergency;
  }

  // Claude's question carries its own acknowledgment, so the separate ack isn't said with it. A
  // question asked again is never the same sentence twice in a row.
  private reply(heard: ReadyHeard, transition: Transition, asides: string[]): AgentTurn {
    const extra = [...asides, ...(transition.lines ?? [])];
    if (this.done) return this.say("", [...extra, ...(this.declined ? [] : [this.lines.goodbye])]);
    const asked = extra.length === 0 ? this.claudeQuestion(heard) : null;
    if (asked) return this.say("", [asked]);
    if (transition.retry) return this.say("", [...extra, this.lines.sorry, this.askAgain()]);
    const askedLastTurn = this.lastAgentLine().includes(this.question());
    return this.say(this.freshAcknowledgment(heard), [...extra, askedLastTurn ? this.askAgain() : this.question()]);
  }

  // An opener said already ("Okay, ..." after "Okay, ...", or a second "Okay" in the call) is
  // dropped and the rest kept; with nothing after it, nothing is said.
  private freshAcknowledgment(heard: ReadyHeard) {
    const ack = guardAcknowledgment(heard.acknowledgment, "none", this.language).text;
    const opener = firstWord(ack);
    const agentLines = this.history.filter((line) => line.speaker === "agent").map((line) => firstWord(line.text));
    const repeated = opener === firstWord(this.lastAgentLine()) || (OKAY.test(opener) && agentLines.some((word) => OKAY.test(word)));
    if (/\bgot it\b/i.test(ack)) return "";
    if (!repeated) return ack;
    const rest = ack.replace(/^\S+?[,.!]\s+/u, "");
    return rest === ack ? "" : capitalize(rest);
  }

  // Claude's wording of the step the code just landed on, or null for the template.
  private claudeQuestion(heard: ReadyHeard) {
    if (!ASKABLE.has(this.step)) return null;
    return checkAsk(heard.ask, {
      goal: this.step,
      templates: [this.question(), this.questionAgain()],
      language: this.language,
      heldDigits: this.step === "confirm_address" ? this.options.addressOnFile : undefined,
      said: this.history.filter((line) => line.speaker === "agent").map((line) => line.text),
      opener: firstWord(this.lastAgentLine()),
    }).line;
  }

  // The goals Claude may word next, in the order the code asks them, from the current step on.
  private goalsAhead(): GoalPrompt[] {
    const from = this.step === "intro" ? 0 : GOAL_ORDER.indexOf(this.step);
    if (from < 0) return [];
    return GOAL_ORDER.slice(from)
      .filter((step) => step === this.step || STILL_OPEN[step](this))
      .map((step) => ({ goal: step, question: ASKABLE.has(step) ? QUESTIONS[step](this) : "", when: GOAL_WHEN[step], scripted: !ASKABLE.has(step) }));
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

  // Give up on a step after two tries rather than trap the resident in a loop. "I don't know" has no
  // better answer to wait for, so it moves on at once.
  retryOr(fallback: Step): Transition {
    if (!this.triesOnStepLeft() || this.unsureThisTurn) return { step: fallback };
    return { step: this.step, retry: true };
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
    if (this.answers.mobility === "manual_wheelchair" && !this.chairKindAsked) return "chair_kind";
    const limited = this.answers.mobility !== undefined && LIMITED_MOBILITY.has(this.answers.mobility);
    if (limited && this.answers.assistanceRequired === undefined) return "assistance";
    return this.needsHelpInside() ? "bedroom" : "care";
  }

  afterExitPlan(): Step {
    if (this.answers.exitPlan !== "helper") return "note";
    this.useHelperOnFile();
    return this.answers.helperPhone ? "confirm_phone" : "helper";
  }

  // The helper on file, when the resident names nobody new and gives no number: we read them back
  // to confirm rather than ask for them from scratch.
  private useHelperOnFile() {
    const onFile = this.options.helperOnFile;
    const named = this.answers.helperName;
    if (!onFile || this.answers.helperPhone || (named && !sameName(named, onFile.name))) return;
    this.answers = { ...this.answers, helperName: named ?? onFile.name, helperPhone: onFile.phone, helperRelation: this.answers.helperRelation ?? onFile.relation };
    this.helperFromFile = true;
  }

  // A number read back wrong is asked for again, twice at most.
  rejectPhone(): Step {
    this.phoneRejections += 1;
    this.helperFromFile = false;
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

  get addressOnFile() {
    return this.options.addressOnFile;
  }

  phoneQuestion() {
    const digits = spokenDigits(this.answers.helperPhone ?? "");
    const name = this.answers.helperName;
    return this.helperFromFile && name ? this.lines.confirmHelperOnFile(name, digits) : this.lines.confirmPhone(digits);
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
      goals: this.goalsAhead(),
      answers: { ...this.answers },
      recentTurns: this.history.slice(-HISTORY_TURNS),
      utterance,
    };
  }

  private say(said: string, lines: string[]): AgentTurn {
    const [acknowledgment, ...kept] = withoutRepeatedSentences([said, ...lines]);
    const sentences = kept.filter((line) => line !== "");
    this.history.push({ speaker: "agent", text: [acknowledgment, ...sentences].filter(Boolean).join(" ") });
    return { acknowledgment, sentences, stage: this.done ? "close" : "household", done: this.done, guardBlocked: false, ignored: false };
  }

  private ignore(): AgentTurn {
    this.history.pop();
    return silentTurn(this, "household");
  }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const OKAY = /^(okay|ok|vale)$/;
const firstWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim().split(" ")[0];

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
  return call.triesOnStepLeft() ? { step: "intro", retry: true } : call.decline();
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

// "Is it a power wheelchair?" A yes makes it one and a no keeps it manual. Asked once per call.
const chairKind: Handler = (call, heard) => {
  if (heard.answer === "yes" && call.answers.mobility === "manual_wheelchair") {
    call.answers = { ...call.answers, mobility: "power_wheelchair" };
  }
  const settled = heard.answer === "yes" || heard.answer === "no" || call.answers.mobility !== "manual_wheelchair";
  if (!settled && call.triesOnStepLeft()) return { step: "chair_kind", retry: true };
  call.chairKindAsked = true;
  return { step: call.afterNeeds() };
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

// Giving the name first and the number next is progress, not a failed try. "Nobody will pick me
// up" changes the plan away from a helper, which counted as progress too: a real caller said
// "nobody" three times and heard the helper question four.
const helper: Handler = (call) => {
  if (call.answers.exitPlan !== "helper") return { step: call.afterExitPlan() };
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
  return heard.answer === "yes" ? { step: "done" } : { step: "readback", retry: true };
};

const fix: Handler = (call) => (call.changed ? { step: "readback" } : call.retryOr("done"));

const STEP_HANDLERS: Record<Step, Handler> = {
  intro,
  confirm_address: confirmAddress,
  ask_address: askAddress,
  people,
  needs,
  chair_kind: chairKind,
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
  chair_kind: (call) => LINES[call.language].askChairKind,
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

const QUESTIONS_AGAIN: Record<Step, (call: ReadyCall) => string> = {
  intro: (call) => call.readyLines.askAgain.intro,
  confirm_address: (call) => call.readyLines.askAgain.confirmAddress(call.addressOnFile ?? ""),
  ask_address: (call) => call.readyLines.askAgain.askAddress,
  people: (call) => call.readyLines.askAgain.people,
  needs: (call) => call.readyLines.askAgain.needs,
  chair_kind: (call) => LINES[call.language].askAgain.chairKind,
  assistance: (call) => call.readyLines.askAgain.assistance,
  bedroom: (call) => call.readyLines.askAgain.bedroom,
  care: (call) => call.readyLines.askAgain.care,
  exit_plan: (call) => call.readyLines.askAgain.exitPlan,
  helper: (call) => (call.answers.helperName ? call.readyLines.askAgain.helperPhone(call.answers.helperName) : call.readyLines.askAgain.helper),
  confirm_phone: (call) => call.readyLines.askAgain.confirmPhone(spokenDigits(call.answers.helperPhone ?? "")),
  note: (call) => call.readyLines.askAgain.note,
  readback: (call) => call.readyLines.askAgain.readback,
  fix: (call) => call.readyLines.askAgain.fix,
  done: (call) => call.readyLines.goodbye,
};

// The steps Claude may word. The intro, the phone read-back, the read-back and the goodbye stay
// templates: they say back the record or what the call is.
const ASKABLE = new Set<Step>(["confirm_address", "ask_address", "people", "needs", "chair_kind", "assistance", "bedroom", "care", "exit_plan", "helper", "note"]);
const GOAL_ORDER: Step[] = ["confirm_address", "ask_address", "people", "needs", "chair_kind", "assistance", "bedroom", "care", "exit_plan", "helper", "confirm_phone", "note", "readback"];
const GOAL_WHEN: Partial<Record<Step, string>> = {
  confirm_address: "right after they agree to the call",
  ask_address: "only if they say the address on file is wrong",
  chair_kind: "only if mobility is manual_wheelchair and they didn't say whether it has a motor",
  assistance: "only if mobility is walker, a wheelchair or bedbound",
  bedroom: "only if mobility is walker, a wheelchair or bedbound, medical is set, or assistanceRequired isn't none",
  helper: "only if exitPlan is helper and there is no helperPhone yet; asks for that person's phone number",
  confirm_phone: "once helperPhone is given",
  readback: "after the note question",
};
// Whether a later goal is still to be asked, from the answers before this one.
// The questions passed when an earlier answer already gave theirs. The helper's number and the
// read-back are always asked: they confirm rather than collect.
const PASSABLE = new Set<Step>(["people", "needs", "chair_kind", "assistance", "bedroom", "care", "exit_plan"]);
const NOTHING_HEARD: ReadyHeard = { answer: null, updates: {}, emergency: false, asksAboutRide: false, wantsRepeat: false, wantsToEnd: false, addressedToAgent: true, acknowledgment: "" };

const STILL_OPEN: Record<Step, (call: ReadyCall) => boolean> = {
  intro: () => false,
  confirm_address: (call) => call.step === "intro" && call.addressOnFile !== undefined,
  ask_address: (call) => call.step === "confirm_address" || (call.step === "intro" && call.addressOnFile === undefined),
  people: (call) => call.answers.peopleCount === undefined,
  needs: (call) => call.answers.mobility === undefined && call.answers.medical === undefined,
  chair_kind: (call) => !call.chairKindAsked && (call.answers.mobility === undefined || call.answers.mobility === "manual_wheelchair"),
  assistance: (call) => call.answers.assistanceRequired === undefined,
  bedroom: (call) => call.answers.bedroomFloor === undefined,
  care: (call) => call.answers.care === undefined,
  exit_plan: (call) => call.answers.exitPlan === undefined,
  helper: (call) => call.answers.exitPlan !== "own_car" && call.answers.exitPlan !== "needs_ride" && !call.answers.helperPhone,
  confirm_phone: (call) => call.answers.exitPlan !== "own_car" && call.answers.exitPlan !== "needs_ride",
  note: (call) => call.answers.note === undefined,
  readback: () => true,
  fix: () => false,
  done: () => false,
};
