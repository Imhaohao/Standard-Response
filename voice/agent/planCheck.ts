import type { Doc } from "../../convex/_generated/dataModel";
import type { HazardEscalation } from "../../convex/hazards";
import { CallFlow, silentTurn } from "./callFlow";
import type { AgentTurn } from "./conversation";
import { guardAcknowledgment } from "./honesty";
import { interpretPlanAnswer, PlanHeard, PlanInterpret, PlanRole } from "./planInterpreter";
import { spokenDigits } from "./readyCall";
import { Language, LINES, withSafety } from "./script";

// The pickup check, a few short calls. Both sides confirm before anyone is told it's settled:
//   ask      the helper hears "can you get to them now?" and, on a yes, "about how many minutes?";
//            later the resident hears "has your helper picked you up?"
//   confirm  once the helper says yes, the resident hears the offer and "will you go with them?"
//   notice   a status update with nothing to answer: the helper hears the resident is ready, or that
//            the pickup is off; the resident hears their helper can't come
// A neighbor who never agreed to anything is asked "could you pick them up and drive them out?"
// instead. Claude only reads the answer. Two unclear answers to the helper count as no, because a
// van is the safer default; two unclear answers to "will you go with them?" leave the helper coming.

type Household = Doc<"households">;
// What a pickup call is for. The same values as `Purpose` in convex/pickups.ts.
export type PlanPurpose = "ask" | "confirm" | "notice";
// The status updates a side can be owed, as `helperNotice` and `residentNotice` in convex/schema.ts.
export type PlanNotice = "resident_ready" | "called_off" | "helper_cancelled";
// What the helper needs to know before they set out. Firefighters told us a neighbor who said yes
// to "a wheelchair" can arrive to find a 400-pound power chair or someone it takes two to lift.
export type PickupNeeds = {
  mobility?: Household["mobility"];
  assistance?: Household["assistanceRequired"];
  oxygen?: boolean;
};
type NeedLines = {
  mobility: Partial<Record<NonNullable<PickupNeeds["mobility"]>, string>>;
  assistance: Partial<Record<NonNullable<PickupNeeds["assistance"]>, string>>;
  oxygen: string;
};

type PlanCheckLines = {
  helperIntro: (helperName: string, residentName: string | undefined, address: string) => string;
  // A neighbor with a car who has no arrangement with the resident.
  recruitIntro: (residentName: string | undefined, address: string) => string;
  needs: NeedLines;
  askComing: string;
  askCanPickUp: string;
  askMinutes: string;
  helperComing: (residentName: string | undefined, residentPhone: string | undefined) => string;
  helperNotComing: string;
  residentIntro: (residentName: string | undefined) => string;
  // Said in place of the greeting when the question comes on the person's own warning call.
  helperContinued: (residentName: string | undefined, address: string, recruited: boolean) => string;
  residentContinued: string;
  updateContinued: string;
  helperUpdateIntro: (helperName: string) => string;
  askPickedUp: (helperName: string) => string;
  // Told as soon as the helper says yes. Their word, never our promise, and the ride request stays open.
  helperOnTheWay: (helperName: string, minutes: number | undefined, helperPhone: string | undefined) => string;
  askReady: (helperName: string) => string;
  residentReady: string;
  // After the resident confirms: Twilio can put them straight through to their helper.
  offerConnect: (helperName: string) => string;
  connecting: (helperName: string) => string;
  residentNotReady: (helperName: string) => string;
  readyUnclear: (helperName: string) => string;
  notices: Record<PlanNotice, (helperName: string, residentName: string | undefined, address: string) => string>;
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
    needs: {
      mobility: {
        walker: "They use a walker.",
        manual_wheelchair: "They use a manual wheelchair, so you'll need room for it in your car.",
        power_wheelchair: "They use a power wheelchair, which needs a van with a lift.",
        bedbound: "They can't get out of bed on their own.",
      },
      assistance: {
        one_person_assist: "They need one person to help them to the car.",
        two_person_lift: "It takes two people to lift them.",
      },
      oxygen: "They use oxygen.",
    },
    askComing: "Can you get to them now?",
    askCanPickUp: "Could you pick them up and drive them out?",
    askMinutes: "About how many minutes until you're there?",
    helperComing: (residentName, residentPhone) =>
      `Thank you.${residentPhone ? ` ${possessive(residentName ?? "Their")} number is ${spokenDigits(residentPhone)}, if you need to reach them.` : ""} We'll check in with ${residentName ?? "them"} after that. If anything changes, call this number.`,
    helperNotComing: "Thanks for telling us. We'll find them another way.",
    residentIntro: (residentName) => `Hi${residentName ? ` ${residentName}` : ""}, it's 911 calling about your pickup.`,
    helperContinued: (residentName, address, recruited) =>
      recruited
        ? `Before you go: ${residentName ? `your neighbor ${residentName}` : "a neighbor of yours"} at ${address} can't get out on their own, and our crews may not reach them in time.`
        : `Before you go: you're down to pick up ${residentName ?? "your neighbor"} at ${address}.`,
    residentContinued: "While you're on the line, I have news about a pickup.",
    updateContinued: "One more thing about the pickup.",
    helperUpdateIntro: (helperName) => `Hi ${helperName}, it's 911 with an update on the pickup.`,
    askPickedUp: (helperName) => `Has ${helperName} picked you up?`,
    helperOnTheWay: (helperName, minutes, helperPhone) =>
      `${capitalized(helperName)} says they can pick you up${minutes ? ` in about ${minutes === 1 ? "1 minute" : `${minutes} minutes`}` : " soon"}.${helperPhone ? ` Their number is ${spokenDigits(helperPhone)}.` : ""} Please get ready by the door with your medications and phone. Your ride request stays open in case they can't make it, and we'll call to check that they reached you.`,
    askReady: (helperName) => `Will you go with ${helperName} when they get there?`,
    residentReady: "Good. I'll let them know you'll be ready.",
    offerConnect: (helperName) => `Would you like me to connect you to ${helperName} on the phone now?`,
    connecting: (helperName) => `Connecting you to ${helperName} now. Please stay on the line.`,
    residentNotReady: (helperName) => `Okay. I'll tell ${helperName} they don't need to come.`,
    readyUnclear: (helperName) => `${capitalized(helperName)} is still on the way. Please be ready by the door.`,
    notices: {
      resident_ready: (_helperName, residentName, address) =>
        `${residentName ?? "They"} said yes, and will be ready for you at ${address}. If anything changes, call this number.`,
      called_off: (_helperName, residentName, address) =>
        `The pickup for ${residentName ?? "your neighbor"} at ${address} is off, so you don't need to go. Please get yourself out safely now.`,
      helper_cancelled: (helperName) =>
        `${capitalized(helperName)} can no longer pick you up. Your ride request is still open, and you're at the top of the list. I'll call you back the moment a driver accepts.`,
    },
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
    needs: {
      mobility: {
        walker: "Usa andadera.",
        manual_wheelchair: "Usa silla de ruedas manual, así que necesitará espacio para la silla en su carro.",
        power_wheelchair: "Usa silla de ruedas eléctrica, que necesita una camioneta con rampa.",
        bedbound: "No puede levantarse de la cama por su cuenta.",
      },
      assistance: {
        one_person_assist: "Necesita que una persona le ayude a llegar al carro.",
        two_person_lift: "Hacen falta dos personas para levantarle.",
      },
      oxygen: "Usa oxígeno.",
    },
    askComing: "¿Puede ir por esa persona ahora?",
    askCanPickUp: "¿Podría pasar por esa persona y sacarla de la zona?",
    askMinutes: "¿Más o menos en cuántos minutos llega?",
    helperComing: (residentName, residentPhone) =>
      `Gracias.${residentPhone ? ` El número de ${residentName ?? "esa persona"} es ${spokenDigits(residentPhone)}, por si necesita comunicarse.` : ""} Después hablaremos con ${residentName ?? "esa persona"}. Si algo cambia, llame a este número.`,
    helperNotComing: "Gracias por avisarnos. Buscaremos otra manera.",
    residentIntro: (residentName) => `Hola${residentName ? ` ${residentName}` : ""}, le llamamos del 911 por su transporte.`,
    helperContinued: (residentName, address, recruited) =>
      recruited
        ? `Antes de irse: ${residentName ? `su vecino ${residentName}` : "un vecino suyo"}, en ${address}, no puede salir por su cuenta, y es posible que nuestros equipos no lleguen a tiempo.`
        : `Antes de irse: usted quedó en pasar por ${residentName ?? "su vecino"} en ${address}.`,
    residentContinued: "Mientras sigue en la línea, tengo noticias sobre su transporte.",
    updateContinued: "Una cosa más sobre el transporte.",
    helperUpdateIntro: (helperName) => `Hola ${helperName}, le llamamos del 911 con novedades sobre la recogida.`,
    askPickedUp: (helperName) => `¿Ya le recogió ${helperName}?`,
    helperOnTheWay: (helperName, minutes, helperPhone) =>
      `${capitalized(helperName)} dice que puede pasar por usted${minutes ? (minutes === 1 ? " en 1 minuto" : ` en unos ${minutes} minutos`) : " pronto"}.${helperPhone ? ` Su número es ${spokenDigits(helperPhone)}.` : ""} Por favor, prepárese junto a la puerta con sus medicinas y su teléfono. Su solicitud de transporte sigue abierta por si no puede llegar, y le llamaremos para confirmar que llegó.`,
    askReady: (helperName) => `¿Se irá con ${helperName} cuando llegue?`,
    residentReady: "Muy bien. Le aviso que usted le estará esperando.",
    offerConnect: (helperName) => `¿Quiere que le comunique con ${helperName} por teléfono ahora?`,
    connecting: (helperName) => `Le comunico con ${helperName} ahora. Por favor no cuelgue.`,
    residentNotReady: (helperName) => `Está bien. Le diré a ${helperName} que no hace falta que venga.`,
    readyUnclear: (helperName) => `${capitalized(helperName)} sigue en camino. Por favor, espere junto a la puerta.`,
    notices: {
      resident_ready: (_helperName, residentName, address) =>
        `${residentName ?? "Esa persona"} dijo que sí, y le estará esperando en ${address}. Si algo cambia, llame a este número.`,
      called_off: (_helperName, residentName, address) =>
        `Ya no hace falta recoger a ${residentName ?? "su vecino"} en ${address}, así que no tiene que ir. Por favor, salga usted a salvo ahora.`,
      helper_cancelled: (helperName) =>
        `${capitalized(helperName)} ya no puede pasar por usted. Su solicitud de transporte sigue abierta, y usted está entre las primeras de la lista. Le llamo en cuanto un conductor acepte.`,
    },
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

const capitalized = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const possessive = (name: string) => `${name}${name.endsWith("s") ? "'" : "'s"}`;

export const planCheckLanguage = (language: Language): Language => (PLAN_CHECK_LINES[language] ? language : "en");

// Whole minutes until the helper's ETA, at least 1, for the resident's notice.
// `now` is on the night's clock (lib/sim-clock.ts), the clock `at` was stored on.
export const minutesUntil = (at: number | undefined, now: number) => (at === undefined ? undefined : Math.max(1, Math.round((at - now) / 60_000)));

// The same notice, said into a call the resident is already on.
export function helperOnTheWayLine(language: Language, helperName: string, minutes: number | undefined, helperPhone?: string) {
  return (PLAN_CHECK_LINES[planCheckLanguage(language)] ?? PLAN_CHECK_LINES.en).helperOnTheWay(helperName, minutes, helperPhone);
}

export interface PlanCheckEffects {
  helperAnswered(coming: boolean, etaMinutes?: number): void;
  residentAnswered(pickedUp: boolean): void;
  // The resident said whether they'll go with the helper.
  residentConfirmed(confirmed: boolean): void;
  // A status update was spoken, to the person or their voicemail.
  noticeHeard(): void;
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
  // Each side hears the other's number once the helper says yes, so they can reach each other.
  residentPhone?: string;
  helperPhone?: string;
  // The helper is a neighbor we found during the warning, not someone who agreed ahead of time.
  recruited?: boolean;
  // Told to the helper before they're asked, so they know what they're agreeing to.
  needs?: PickupNeeds;
  purpose?: PlanPurpose;
  // Minutes until the helper's ETA, said in the resident's confirmation call.
  minutes?: number;
  // The update a notice call gives.
  notice?: PlanNotice;
  // Asked on the person's own warning call, which is already under way: no greeting.
  continued?: boolean;
  // The call can put the resident through to the helper (voice/phone/callSession.ts connects it).
  canConnect?: boolean;
  effects: PlanCheckEffects;
  interpret?: PlanInterpret;
};

type Step = "ask_coming" | "ask_minutes" | "ask_picked_up" | "ask_ready" | "offer_connect" | "done";
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
  // The number to put the resident through to, once they've said yes to being connected.
  connectTo: string | null = null;

  constructor(options: PlanCheckOptions) {
    this.options = options;
    this.language = planCheckLanguage(options.language);
    this.lines = PLAN_CHECK_LINES[this.language] ?? PLAN_CHECK_LINES.en;
    this.interpret = options.interpret ?? interpretPlanAnswer;
    this.step = firstStep(options);
    // Nothing to answer on a notice, so hanging up after it is not a missed call.
    if (this.purpose === "notice") this.reported = true;
  }

  private get purpose(): PlanPurpose {
    return this.options.purpose ?? "ask";
  }

  get done() {
    return this.step === "done";
  }

  start(): AgentTurn {
    const intro = this.intro();
    if (this.purpose === "notice") {
      this.step = "done";
      this.options.effects.noticeHeard();
      return this.say("", [intro, this.notice(), LINES[this.language].goodbye]);
    }
    if (this.purpose === "confirm") return this.say("", [intro, this.offer(), this.question()]);
    return this.say("", [intro, ...this.needLines(), this.question()]);
  }

  private needLines() {
    const { role, needs } = this.options;
    if (role !== "helper" || !needs) return [];
    const { mobility, assistance, oxygen } = this.lines.needs;
    const said = [needs.mobility && mobility[needs.mobility], needs.assistance && assistance[needs.assistance], needs.oxygen && oxygen];
    return said.filter((line): line is string => typeof line === "string");
  }

  question(): string {
    return QUESTIONS[this.step](this.lines, this.options);
  }

  // What the helper offered, said before the resident is asked to confirm.
  private offer() {
    return this.lines.helperOnTheWay(this.options.helperName, this.options.minutes, this.options.helperPhone);
  }

  private notice() {
    const { notice, helperName, residentName, address } = this.options;
    if (!notice) throw new Error("A notice call needs the update to give");
    const line = this.lines.notices[notice](helperName, residentName, address);
    return notice === "helper_cancelled" ? withSafety(line, this.language) : line;
  }

  private intro() {
    const { role, recruited, helperName, residentName, address } = this.options;
    if (this.options.continued) return this.continuedIntro();
    if (role === "resident") return this.lines.residentIntro(residentName);
    if (this.purpose === "notice") return this.lines.helperUpdateIntro(helperName);
    return recruited ? this.lines.recruitIntro(residentName, address) : this.lines.helperIntro(helperName, residentName, address);
  }

  private continuedIntro() {
    const { role, recruited, residentName, address } = this.options;
    if (this.purpose === "notice") return this.lines.updateContinued;
    if (role === "resident") return this.lines.residentContinued;
    return this.lines.helperContinued(residentName, address, recruited ?? false);
  }

  endHold(): AgentTurn {
    return this.say("", []);
  }

  announce(): AgentTurn {
    return this.say("", [this.question()]);
  }

  voicemail(): string[] {
    const { role, helperName, residentName, address } = this.options;
    if (this.purpose === "notice") return [this.intro(), this.notice()];
    if (this.purpose === "confirm") return [this.lines.residentIntro(residentName), this.offer()];
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
    if (this.step === "ask_ready") return this.askReady(heard);
    if (this.step === "offer_connect") return this.offerConnect(heard);
    return { step: "done", lines: [] };
  }

  // A yes puts them through to the helper; anything else ends the call as before.
  private offerConnect(heard: PlanHeard): Transition {
    const { helperName, helperPhone } = this.options;
    if (heard.answer === "yes" && helperPhone) {
      this.connectTo = helperPhone;
      return { step: "done", lines: [this.lines.connecting(helperName)] };
    }
    if (heard.answer === "unclear" && !this.secondUnclear()) return { step: this.step, lines: [this.lines.sorry] };
    return { step: "done", lines: [LINES[this.language].goodbye] };
  }

  // A no lets the helper turn back; an answer we can't read leaves them coming, since they already are.
  private askReady(heard: PlanHeard): Transition {
    const { helperName } = this.options;
    if (heard.answer === "yes") {
      this.report(() => this.options.effects.residentConfirmed(true));
      if (this.options.canConnect && this.options.helperPhone) return { step: "offer_connect", lines: [this.lines.residentReady] };
      return { step: "done", lines: [this.lines.residentReady, LINES[this.language].goodbye] };
    }
    if (heard.answer === "no") {
      this.report(() => this.options.effects.residentConfirmed(false));
      return { step: "done", lines: [this.lines.residentNotReady(helperName), withSafety(this.lines.findingVehicle, this.language), LINES[this.language].goodbye] };
    }
    if (!this.secondUnclear()) return { step: this.step, lines: [this.lines.sorry] };
    this.report(() => this.options.effects.unreached());
    return { step: "done", lines: [this.lines.readyUnclear(helperName), LINES[this.language].goodbye] };
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
    return { step: "done", lines: [this.lines.helperComing(this.options.residentName, this.options.residentPhone)] };
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

function firstStep({ role, purpose }: PlanCheckOptions): Step {
  if (purpose === "notice") return "done";
  if (purpose === "confirm") return "ask_ready";
  return role === "helper" ? "ask_coming" : "ask_picked_up";
}

const QUESTIONS: Record<Step, (lines: PlanCheckLines, options: PlanCheckOptions) => string> = {
  ask_coming: (lines, { recruited }) => (recruited ? lines.askCanPickUp : lines.askComing),
  ask_minutes: (lines) => lines.askMinutes,
  ask_picked_up: (lines, { helperName }) => lines.askPickedUp(helperName),
  ask_ready: (lines, { helperName }) => lines.askReady(helperName),
  offer_connect: (lines, { helperName }) => lines.offerConnect(helperName),
  done: () => "",
};
