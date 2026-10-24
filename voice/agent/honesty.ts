import type { Language, RequestStatus } from "./script";

// Claude writes only short acknowledgments. This guard is the code-level backstop: while no driver
// has accepted, any acknowledgment that sounds like a promise of help is replaced with a neutral one.
// The implied-reassurance grader (Track D) measures what slips past it.

const PROMISES: Record<Language, RegExp> = {
  en: /\b(on (the|their|its) way|coming (for|to)|be there|help is|someone (is|will)|they('ll| will)|don'?t worry|you'?re safe|you will be safe|rescued|soon|minutes? away|arriv|assigned|dispatch(ed)? (a|someone)|pick (you )?up)\b/i,
  es: /(en camino|ya (viene|va)|vienen?|van a (llegar|ir)|llegar[áa]n?|no se preocupe|est[áa] a salvo|pronto|minutos|asignad|recoger|rescat)/i,
};

const NEUTRAL: Record<Language, string> = { en: "Okay.", es: "Entendido." };

const UNCONFIRMED = new Set<RequestStatus | "none">(["none", "received", "approved", "reassigning"]);

export type GuardResult = { text: string; blocked: boolean };

export function guardAcknowledgment(text: string, status: RequestStatus | "none", language: Language): GuardResult {
  const trimmed = text.trim();
  if (trimmed === "") return { text: "", blocked: false };
  const soundsLikePromise = PROMISES.en.test(trimmed) || PROMISES.es.test(trimmed);
  if (UNCONFIRMED.has(status) && soundsLikePromise) return { text: NEUTRAL[language], blocked: true };
  // Even after acceptance, ETAs and names come only from templates.
  if (/\d/.test(trimmed)) return { text: NEUTRAL[language], blocked: true };
  return { text: trimmed, blocked: false };
}
