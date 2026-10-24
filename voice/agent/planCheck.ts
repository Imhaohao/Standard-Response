import type { HazardEscalation } from "../../convex/hazards";
import { CallFlow, silentTurn } from "./callFlow";
import type { AgentTurn } from "./conversation";
import { guardAcknowledgment } from "./honesty";
import { interpretPlanAnswer, PlanHeard, PlanInterpret, PlanRole } from "./planInterpreter";
import { Language, LINES, withSafety } from "./script";

// The pickup check, one short call. The helper hears "can you get to them now?" and, on a yes,
// "about how many minutes?"; the resident later hears "has your helper picked you up?". A neighbor
// who never agreed to anything is asked "could you pick them up on your way out?" instead. Claude
// only reads the answer. Two unclear answers count as no, because a van is the safer default.

type PlanCheckLines = {
  helperIntro: (helperName: string, residentName: string | undefined, address: string) => string;
  // A neighbor driving out who has no arrangement with the resident.
  recruitIntro: (residentName: string | undefined, address: string) => string;
  askComing: string;
  askCanPickUp: string;
  askMinutes: string;
  helperComing: (residentName: string | undefined) => string;
  helperNotComing: string;
  residentIntro: (residentName: string | undefined) => string;
  askPickedUp: (helperName: string) => string;
  pickedUp: string;
  findingVehicle: string;
  sorry: string;
  helperEmergency: string;
  helperVoicemail: (residentName: string | undefined, address: string) => string;
  residentVoicemail: (helperName: string) => string;
};

export const PLAN_CHECK_LINES: Partial<Record<Language, PlanCheckLines>> & { en: PlanCheckLines } = {
  en: {
    helperIntro: (helperName, residentName, address) =>
      `Hi ${helperName}, this is 911 calling for ${residentName ?? "your neighbor"} at ${address}. An evacuation warning now covers their street, and you're down to pick them up.`,
    recruitIntro: (residentName, address) =>
      `Hi, this is 911 calling about the evacuation in Altadena. ${residentName ? `Your neighbor ${residentName}` : "A neighbor of yours"} at ${address} can't get out on their own, and our crews may not reach them in time.`,
    askComing: "Can you get to them now?",
    askCanPickUp: "Could you pick them up on your way out?",
    askMinutes: "About how many minutes until you're there?",
    helperComing: (residentName) =>
      `Thank you. We'll check in with ${residentName ?? "them"} after that. If anything changes, call this number.`,
    helperNotComing: "Thanks for telling us. We'll find them another way.",
    residentIntro: (residentName) => `Hi${residentName ? ` ${residentName}` : ""}, it's 911 calling about your pickup.`,
    askPickedUp: (helperName) => `Has ${helperName} picked you up?`,
    pickedUp: "Good, I'm glad you're on your way. Goodbye.",
    findingVehicle: "We're finding you a vehicle now. I'll call you back as soon as a driver has said yes.",
    sorry: "Sorry, I didn't catch that.",
    helperEmergency: "If you're in danger, leave now, and don't go to them.",
    helperVoicemail: (residentName, address) =>
      `This is 911 calling about ${residentName ?? "your neighbor"} at ${address}. We'll try you again in a couple of minutes.`,
    residentVoicemail: (helperName) =>
      `This is 911 checking that ${helperName} picked you up. We'll call back in a couple of minutes. If you still need a ride, call this number.`,
  },
  es: {
    helperIntro: (helperName, residentName, address) =>
      `Hola ${helperName}, le llamamos del 911 por ${residentName ?? "su vecino"}, en ${address}. Ahora hay un aviso de evacuación en su calle, y usted quedó en recogerle.`,
    recruitIntro: (residentName, address) =>
      `Hola, le llamamos del 911 por la evacuación en Altadena. ${residentName ? `Su vecino ${residentName}` : "Un vecino suyo"}, en ${address}, no puede salir por su cuenta, y es posible que nuestros equipos no lleguen a tiempo.`,
    askComing: "¿Puede ir por esa persona ahora?",
    askCanPickUp: "¿Podría pasar por esa persona cuando salga?",
    askMinutes: "¿Más o menos en cuántos minutos llega?",
    helperComing: (residentName) =>
      `Gracias. Después hablaremos con ${residentName ?? "esa persona"}. Si algo cambia, llame a este número.`,
    helperNotComing: "Gracias por avisarnos. Buscaremos otra manera.",
    residentIntro: (residentName) => `Hola${residentName ? ` ${residentName}` : ""}, le llamamos del 911 por su transporte.`,
    askPickedUp: (helperName) => `¿Ya le recogió ${helperName}?`,
    pickedUp: "Qué bien, me alegra que ya haya salido. Adiós.",
    findingVehicle: "Estamos buscándole un vehículo ahora. Le llamo en cuanto un conductor diga que sí.",
    sorry: "Perdón, no le entendí.",
    helperEmergency: "Si está en peligro, salga ahora y no vaya por esa persona.",
    helperVoicemail: (residentName, address) =>
      `Le llamamos del 911 por ${residentName ?? "su vecino"}, en ${address}. Volveremos a llamar en un par de minutos.`,
    residentVoicemail: (helperName) =>
      `Le llamamos del 911 para confirmar que ${helperName} le recogió. Volveremos a llamar en un par de minutos. Si todavía necesita transporte, llame a este número.`,
  },
};

export const planCheckLanguage = (language: Language): Language => (PLAN_CHECK_LINES[language] ? language : "en");

export interface PlanCheckEffects {
  helperAnswered(coming: boolean, etaMinutes?: number): void;
  residentAnswered(pickedUp: boolean): void;
  escalate(kind: "medical" | HazardEscalation): void;
  // The person hung up before giving an answer.
  unreached(): void;
}

export type PlanCheckOptions = {
  role: PlanRole;
  language: Language;
  helperName: string;
  residentName?: string;
  address: string;
  // The helper is a neighbor we found during the warning, not someone who agreed ahead of time.
  recruited?: boolean;
  effects: PlanCheckEffects;
  interpret?: PlanInterpret;
};

type Step = "ask_coming" | "ask_minutes" | "ask_picked_up" | "done";
type Transition = { step: Step; lines: string[] };

const MAX_UNCLEAR = 2;
const HISTORY_TURNS = 4;

export class PlanCheck implements CallFlow {
  readonly language: Language;
  readonly holding = false;
  step: Step;
  private readonly options: PlanCheckOptions;
  private readonly lines: PlanCheckLines;
  private readonly interpret: PlanInterpret;
  private unclearAnswers = 0;
  private reported = false;
  private escalated = false;
  private history: { speaker: "agent" | "resident"; text: string }[] = [];

  constructor(options: PlanCheckOptions) {
    this.options = options;
    this.language = planCheckLanguage(options.language);
    this.lines = PLAN_CHECK_LINES[this.language] ?? PLAN_CHECK_LINES.en;
    this.interpret = options.interpret ?? interpretPlanAnswer;
    this.step = options.role === "helper" ? "ask_coming" : "ask_picked_up";
  }

  get done() {
    return this.step === "done";
  }

  start(): AgentTurn {
    const intro = this.intro();
    return this.say("", [intro, this.question()]);
  }

  question(): string {
    return QUESTIONS[this.step](this.lines, this.options);
  }

  private intro() {
    const { role, recruited, helperName, residentName, address } = this.options;
    if (role === "resident") return this.lines.residentIntro(residentName);
    return recruited ? this.lines.recruitIntro(residentName, address) : this.lines.helperIntro(helperName, residentName, address);
  }

  endHold(): AgentTurn {
    return this.say("", []);
  }

  announce(): AgentTurn {
    return this.say("", [this.question()]);
  }

  voicemail(): string[] {
    const { role, helperName, residentName, address } = this.options;
    return [role === "helper" ? this.lines.helperVoicemail(residentName, address) : this.lines.residentVoicemail(helperName)];
  }

  lineClosed() {
    if (this.reported) return;
    this.reported = true;
    this.options.effects.unreached();
  }

  async hear(utterance: string): Promise<AgentTurn> {
    return (await this.read(utterance))();
  }

  // Nothing follows the closing line, so anything said after it is ignored.
  async read(utterance: string): Promise<() => AgentTurn> {
    if (this.done) return () => silentTurn(this, "close");
    let heard: PlanHeard | null = null;
    try {
      heard = await this.interpret(this.context(utterance));
    } catch (error) {
      console.error("[plan-check] interpreter failed", error);
    }
    return () => this.act(utterance, heard);
  }

  private act(utterance: string, heard: PlanHeard | null): AgentTurn {
    this.history.push({ speaker: "resident", text: utterance });
    if (!heard) return this.say("", [LINES[this.language].repeatPrompt, this.question()]);
    if (!heard.addressedToAgent && heard.emergency === "none") return this.ignore();
    const urgent = this.handleEmergency(heard);
    if (heard.wantsRepeat) return this.say("", [...urgent, this.question()]);
    const transition = this.advance(heard);
    this.moveTo(transition.step);
    // The closing line already thanks them, so a parting acknowledgment would say it twice.
    const ack = this.done ? "" : guardAcknowledgment(heard.acknowledgment, "none", this.language).text;
    const next = this.done ? [] : [this.question()];
    return this.say(ack, [...urgent, ...transition.lines, ...next]);
  }

  private moveTo(step: Step) {
    if (step !== this.step) this.unclearAnswers = 0;
    this.step = step;
  }

  private advance(heard: PlanHeard): Transition {
    if (this.step === "ask_coming") return this.askComing(heard);
    if (this.step === "ask_minutes") return this.askMinutes(heard);
    if (this.step === "ask_picked_up") return this.askPickedUp(heard);
    return { step: "done", lines: [] };
  }

  private askComing(heard: PlanHeard): Transition {
    if (heard.answer === "yes" && heard.minutes !== null) return this.helperComing(heard.minutes);
    if (heard.answer === "yes") return { step: "ask_minutes", lines: [] };
    if (heard.answer === "no" || this.secondUnclear()) return this.helperNotComing();
    return { step: this.step, lines: [this.lines.sorry] };
  }

  // A helper who can't say how long gets the backend's default rather than a number we made up.
  private askMinutes(heard: PlanHeard): Transition {
    if (heard.minutes !== null) return this.helperComing(heard.minutes);
    if (heard.answer === "no") return this.helperNotComing();
    if (this.secondUnclear()) return this.helperComing(undefined);
    return { step: this.step, lines: [this.lines.sorry] };
  }

  private askPickedUp(heard: PlanHeard): Transition {
    if (heard.answer === "yes") return this.residentAnswered(true);
    if (heard.answer === "no" || this.secondUnclear()) return this.residentAnswered(false);
    return { step: this.step, lines: [this.lines.sorry] };
  }

  private secondUnclear() {
    this.unclearAnswers += 1;
    return this.unclearAnswers >= MAX_UNCLEAR;
  }

  private helperComing(minutes: number | undefined): Transition {
    this.report(() => this.options.effects.helperAnswered(true, minutes));
    return { step: "done", lines: [this.lines.helperComing(this.options.residentName)] };
  }

  private helperNotComing(): Transition {
    this.report(() => this.options.effects.helperAnswered(false));
    return { step: "done", lines: [this.lines.helperNotComing] };
  }

  // The honesty rule: no pickup and no time is promised, only that a driver's yes comes first.
  private residentAnswered(pickedUp: boolean): Transition {
    this.report(() => this.options.effects.residentAnswered(pickedUp));
    if (pickedUp) return { step: "done", lines: [this.lines.pickedUp] };
    return { step: "done", lines: [withSafety(this.lines.findingVehicle, this.language), LINES[this.language].goodbye] };
  }

  private report(write: () => void) {
    if (this.reported) return;
    this.reported = true;
    write();
  }

  // Only the resident's home is ours to escalate; a helper in trouble is told to leave and not go to them.
  private handleEmergency(heard: PlanHeard): string[] {
    if (heard.emergency === "none" || this.escalated) return [];
    this.escalated = true;
    if (this.options.role === "helper") return [this.lines.helperEmergency];
    this.options.effects.escalate(heard.emergency);
    return [LINES[this.language].emergency];
  }

  private context(utterance: string) {
    return {
      language: this.language,
      role: this.options.role,
      question: this.question(),
      recentTurns: this.history.slice(-HISTORY_TURNS),
      utterance,
    };
  }

  private say(acknowledgment: string, sentences: string[]): AgentTurn {
    this.history.push({ speaker: "agent", text: [acknowledgment, ...sentences].filter(Boolean).join(" ") });
    return { acknowledgment, sentences, stage: this.done ? "close" : "greet", done: this.done, guardBlocked: false, ignored: false };
  }

  private ignore(): AgentTurn {
    this.history.pop();
    return silentTurn(this, "greet");
  }
}

const QUESTIONS: Record<Step, (lines: PlanCheckLines, options: PlanCheckOptions) => string> = {
  ask_coming: (lines, { recruited }) => (recruited ? lines.askCanPickUp : lines.askComing),
  ask_minutes: (lines) => lines.askMinutes,
  ask_picked_up: (lines, { helperName }) => lines.askPickedUp(helperName),
  done: () => "",
};
