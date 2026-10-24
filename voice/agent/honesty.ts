import { REVIEWED_LANGUAGES } from "../../convex/languages";
import { Language, RequestStatus } from "./script";

// Claude writes only short acknowledgments. This guard is the code-level backstop: while no driver
// has accepted, any acknowledgment that sounds like a promise of help is replaced with a neutral one.
// The implied-reassurance grader (Track D) measures what slips past it.

// Besides direct promises, these catch echoes of a caller's demand ("Entendido, una hora.",
// "Understood, checking on the driver.", "we'll work that out"): any time word, driver or "we will".
// HELP_ON_THE_WAY holds what the voice exam caught Claude saying instead ("we're working on getting
// help to you", "the crew knows to bring", "Estamos trabajando para ayudarle", "Seguimos con usted").
const HELP_ON_THE_WAY = [
  /\b((get|getting|send|sending|bring|bringing) (you )?(the right )?help|help (will|gets?|is coming|arriv|to send)|working (on|to)|crews?|the right (help|people)|dispatchers? (can see|have|has|know|are|is)|handled by)\b/i,
  /(trabajando|enviar|mandar|equipo|la ayuda (va|llega|adecuada)|seguimos con usted|despachadores? (ya )?(tienen|saben|ven))/i,
];

// Comfort that may be false while the hazard is at the door: "Está bien, no pasa nada" to a caller
// with flames coming in.
const FALSE_COMFORT = [
  /\b(it'?s (going to be |gonna be )?(okay|ok|alright|fine)|everything (will|is going to) be|you'?ll be (okay|ok|fine|alright)|no need to worry)\b/i,
  /(no pasa nada|todo (va a )?(estar|salir) bien|tranquil)/i,
];

// A caller near the fire is never told to slow down.
const DELAY = [/\btake your time\b/i, /t[oó]mese (su|el) tiempo/i];

const PROMISES = [
  /\b(on (the|their|its) way|coming (for|to)|be there|help is|someone (is|will)|they('ll| will)|we('ll| will)|don'?t worry|you'?re safe|you will be safe|rescued|soon|minutes?|hours?|away|arriv|assigned|dispatch(ed)? (a|someone)|pick (you )?up|driver|work (that|it) out|be ready|wait(ing)? for you|see you)\b/i,
  /(en camino|ya (viene|va)|vienen?|van a (llegar|ir)|llegar[áa]n?|no se preocupe|est[áa] a salvo|pronto|minutos?|horas?|asignad|recoger|rescat|conductor|chofer|ayudamos|vamos a|confirmad|atent|esper[oa]|la puerta)/i,
];

const UNCONFIRMED = new Set<RequestStatus | "none">(["none", "received", "approved", "reassigning"]);

export type GuardResult = { text: string; blocked: boolean };

// A blocked acknowledgment is dropped, not replaced: a stock "Okay." on every turn sounds robotic.
const blocked: GuardResult = { text: "", blocked: true };

export function guardAcknowledgment(text: string, status: RequestStatus | "none", language: Language): GuardResult {
  const trimmed = text.trim();
  if (trimmed === "") return { text: "", blocked: false };
  // The phrase lists only cover reviewed languages, so elsewhere Claude's words are never spoken.
  if (!REVIEWED_LANGUAGES.includes(language)) return blocked;
  const soundsLikePromise = [...PROMISES, ...HELP_ON_THE_WAY, ...FALSE_COMFORT, ...DELAY].some((pattern) => pattern.test(trimmed));
  if (UNCONFIRMED.has(status) && soundsLikePromise) return blocked;
  // Even after acceptance, ETAs and names come only from templates.
  if (/\d/.test(trimmed)) return blocked;
  return { text: trimmed, blocked: false };
}
