import { REVIEWED_LANGUAGES } from "../../convex/languages";
import { Language, RequestStatus } from "./script";

// Claude writes only short acknowledgments. This guard is the code-level backstop: while no driver
// has accepted, any acknowledgment that sounds like a promise of help is replaced with a neutral one.
// The implied-reassurance grader (Track D) measures what slips past it.

// Besides direct promises, these catch echoes of a caller's demand ("Entendido, una hora.",
// "Understood, checking on the driver.", "we'll work that out"): any time word, driver or "we will".
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
  const soundsLikePromise = PROMISES.some((pattern) => pattern.test(trimmed));
  if (UNCONFIRMED.has(status) && soundsLikePromise) return blocked;
  // Even after acceptance, ETAs and names come only from templates.
  if (/\d/.test(trimmed)) return blocked;
  return { text: trimmed, blocked: false };
}
