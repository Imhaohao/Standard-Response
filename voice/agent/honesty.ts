import { REVIEWED_LANGUAGES } from "../../convex/languages";
import { readsAsOtherLanguage } from "./languageMarkers";
import { Language, RequestStatus } from "./script";

// Claude writes only short acknowledgments. This guard is the code-level backstop: while no driver
// has accepted, any acknowledgment that sounds like a promise of help is replaced with a neutral one.
// The implied-reassurance grader measures what slips past it.

// Besides direct promises, these catch echoes of a caller's demand ("Entendido, una hora.",
// "Understood, checking on the driver.", "we'll work that out"): any time word, driver or "we will".
// HELP_ON_THE_WAY holds what the voice exam caught Claude saying instead ("we're working on getting
// help to you", "the crew knows to bring", "Estamos trabajando para ayudarle", "Seguimos con usted").
const HELP_ON_THE_WAY = [
  /\b((get|getting|send|sending|bring|bringing) (you )?(the right )?help|help (will|gets?|is coming|arriv|to send)|working (on|to)|crews?|the right (help|people)|dispatchers? (can see|have|has|know|are|is)|handled by|here with you|your agent|i'?m marking|i'?m noting|i'?ve noted|when (help|someone|they)|plan (a|the|your) (ride|pickup)|the code|the system|yes,? (it'?s|that'?s) (fine|okay|ok)|to send|for the vehicle|the vehicle (will|is|that)|i can help with that|bring (the|a) (right )?vehicle|send (you|the|a) |who'?s coming|someone'?s coming|noted|i can (hear|see) (the|that) (fire|flames|smoke))\b/i,
  /(trabajando|enviar|mandar|equipo|la ayuda (va|llega|adecuada)|seguimos con usted|estamos con usted|estamos ayudando|lo m[aá]s r[aá]pido|estoy aqu[ií] con usted|cu[aá]ndo (lleg|vien)|lleg(a|ue) (la )?ayuda|el c[oó]digo|el sistema|^s[ií],? est[aá] bien|despachadores? (ya )?(tienen|saben|ven))/i,
];

// "Sí, ya lo tenemos." to "Por favor, ayúdenos." and "Okay, your dog is coming with you.": the voice
// exam heard both while no driver had accepted. An approved answer may still say a pet can come.
const HANDLED = [/\bwe'?ve got (it|you|this)\b|\b(is|are|can) (coming|come) with you\b/i, /\b(ya )?lo tenemos\b/i];

// Advice the agent can't stand behind: it sees no fire, roads or officers. The fixed lines carry the
// only advice ("If you can leave safely, leave now").
const INVENTED_ADVICE = [
  /\b(officers?|signs|stay low|windows?|route|which way|turn (left|right)|head (north|south|east|west)|shelter in|news|alerts?|keep driving|keep going|stay in the car|stay on (the|a)|main road|reach (her|him|you|them)|anyone will|status line)\b/i,
  /(oficiales|polic[ií]a|ventanas|ruta|gire a|qu[eé]dese adentro)/i,
  // "The fire is to your north." to "Which way do I go?": the agent can't see the fire.
  /\bthe fire is (to|near|close|at|coming|moving|heading|behind|in front|on|north|south|east|west)\b|\b(to|of) (your|the) (north|south|east|west)\b/i,
  /\b(el )?fuego (est[aá]|viene|va)\b|\bal (norte|sur|este|oeste)\b/i,
];

// "You want to know what to do while you wait." to "Are we supposed to wait here?" made waiting
// sound like the plan. Only the fixed lines speak about waiting.
const WAITING = [/\bwhile you wait\b/i, /\bmientras (usted )?espera\b/i];

// Comfort that may be false while the hazard is at the door: "Está bien, no pasa nada" to a caller
// with flames coming in.
const FALSE_COMFORT = [
  /\b(it'?s (going to be |gonna be )?(okay|ok|alright|fine)|everything (will|is going to) be|you'?ll be (okay|ok|fine|alright)|no need to worry)\b/i,
  /(no pasa nada|todo (va a )?(estar|salir) bien|tranquil)/i,
];

// Scripted sympathy after the feeling is named: principle 5 names it once and moves on.
// "Sorry about that." opened a hold answer on a real call; the call-taker principles never apologize.
const SYMPATHY = [/\bsorry\b/i, /\blo siento\b/i, /\b(and )?i understand\b/i, /\blo entiendo\b/i];

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

const CLAUDE_LINE = [...PROMISES, ...HELP_ON_THE_WAY, ...HANDLED, ...FALSE_COMFORT, ...DELAY, ...WAITING, ...INVENTED_ADVICE, ...SYMPATHY];
// An approved answer is the agency's own advice (approvedAnswers.ts), so the advice Claude can't
// stand behind is allowed there ("close every window"); a promise of help or false comfort is not.
const APPROVED_LINE = [...PROMISES, ...HELP_ON_THE_WAY, ...FALSE_COMFORT, ...DELAY, ...SYMPATHY];

export function guardAcknowledgment(text: string, status: RequestStatus | "none", language: Language, approved = false): GuardResult {
  const trimmed = text.trim();
  if (trimmed === "") return { text: "", blocked: false };
  // The phrase lists only cover reviewed languages, so elsewhere Claude's words are never spoken.
  if (!REVIEWED_LANGUAGES.includes(language)) return blocked;
  if (readsAsOtherLanguage(trimmed, language)) return blocked;
  const soundsLikePromise = (approved ? APPROVED_LINE : CLAUDE_LINE).some((pattern) => pattern.test(trimmed));
  if (UNCONFIRMED.has(status) && soundsLikePromise) return blocked;
  // Even after acceptance, ETAs and names come only from templates. "911" is the line's own name:
  // "No, you're on the phone with 911." to "Am I in heaven?" was blocked for its digits.
  if (/\d/.test(trimmed.replace(/\b911\b/g, ""))) return blocked;
  return { text: trimmed, blocked: false };
}
