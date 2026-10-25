import { guardAcknowledgment } from "./honesty";
import type { Language } from "./script";

// Goals, not a script. Code decides which fact to ask for next; Claude, in the same call that reads
// the answer, may word that question in its own words with a short acknowledgment in front. Code
// speaks Claude's line only when Claude aimed it at the goal the code landed on and it passes every
// check below; otherwise the template question plays, as before. Status, safety, read-back and
// goodbye lines are never Claude's: those goals are marked scripted and have no line.

export type Ask = { goal: string; line: string };

// One goal as Claude sees it: the code's own question as the example, and when the code asks it.
export type GoalPrompt = { goal: string; question: string; when?: string; scripted?: boolean };

export type AskCheck = {
  // The goal the code's transition landed on.
  goal: string;
  // The code's own questions for that goal, first and again. Words about another goal are allowed
  // only when they use them too.
  templates: string[];
  language: Language;
  // Digits the line may say back: the address the record already holds, when confirming it.
  heldDigits?: string;
  // Everything the agent said earlier on this call. The line must not say any of it again.
  said: string[];
  // The first word of the agent's previous turn, when the line opens this turn.
  opener?: string;
};

export type AskVerdict = { line: string | null; blocked: boolean };

const MAX_ASK_WORDS = 32;
// An acknowledgment and a question, or a question in two parts like the templates ("How many? Any pets?").
const MAX_ASK_SENTENCES = 3;
const REJECTED: AskVerdict = { line: null, blocked: false };

const normalized = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/u).filter((sentence) => sentence.trim() !== "");
const digitRuns = (text: string) => text.match(/\d+/g) ?? [];

// Whole words in any script: \b only knows ASCII letters, so it never ends a word on "qué".
const words = (alternatives: string, flags = "iu") => new RegExp(`(?<!\\p{L})(?:${alternatives})(?!\\p{L})`, flags);

// What a question is about, by the words that name it. A line for the needs question that also asks
// how many people are home asks about two goals, and the second one may not be the code's.
const TOPICS = [
  words("address|street|direcci[oó]n|calle"),
  words("leave|get(ting)? out|salir|saldr[ií]a"),
  words("car|drive|carro|coche|manej\\p{L}*"),
  words("how many|pets?|cu[aá]nt[ao]s|mascotas?"),
  words("walker|wheelchair|oxygen|dialysis|bed|andadera|silla de ruedas|ox[ií]geno|di[aá]lisis|cama"),
  words("motor|battery|power(ed)?|electric|bater[ií]a|el[eé]ctric[ao]"),
  words("lift|two people|levantar\\p{L}*|dos personas"),
  words("neighbou?rs?|anyone else|vecin[ao]s?|alguien m[aá]s"),
  words("sleeps?|upstairs|basement|ground floor|duerme|arriba|s[oó]tano|planta baja"),
  words("hearing|vision|memory|device|service animal|audici[oó]n|vista|memoria|aparato|animal de servicio"),
  words("phone|tel[eé]fono"),
  words("gate|key|code|reja|llave|c[oó]digo"),
];

// Words only English or only Spanish use, to tell which language a line is in.
const LANGUAGE_MARKERS: Partial<Record<Language, RegExp>> = {
  en: words("the|you|your|is|are|anyone|how|what|there|and|do|does|with|any|would|that|of|to|who|where", "giu"),
  es: new RegExp(`${words("el|la|los|las|usted|su|hay|alguien|c[oó]mo|qu[eé]|tiene|es|en|y|con|para|por|de|que|le|d[oó]nde|qui[eé]n").source}|[¿¡ñáéíóú]`, "giu"),
};

const hits = (text: string, language: Language) => text.match(LANGUAGE_MARKERS[language] ?? /$^/g)?.length ?? 0;

function inLanguage(line: string, language: Language) {
  const other = (Object.keys(LANGUAGE_MARKERS) as Language[]).filter((code) => code !== language);
  const own = hits(line, language);
  return own > 0 && other.every((code) => hits(line, code) < own);
}

function fitsLength(line: string) {
  return sentencesOf(line).length <= MAX_ASK_SENTENCES && line.split(/\s+/).length <= MAX_ASK_WORDS;
}

// It has to end by asking, or the resident hears an acknowledgment and silence.
const endsAsking = (line: string) => /[?？]\s*$/.test(line);

function digitsHeld(line: string, held: string | undefined) {
  const allowed = new Set(digitRuns(held ?? ""));
  return digitRuns(line).every((run) => allowed.has(run));
}

function asksOnlyItsGoal(line: string, check: AskCheck) {
  const own = [...check.templates, check.goal.replace(/_/g, " ")].join(" ");
  const questions = sentencesOf(line).filter(endsAsking);
  return TOPICS.every((topic) => topic.test(own) || !questions.some((question) => topic.test(question)));
}

function sayingSomethingNew(line: string, said: string[]) {
  const spoken = normalized(line);
  return !said.some((earlier) => normalized(earlier).includes(spoken));
}

// Two turns in a row that start with the same word sound like a recording, and so does "Okay" twice.
const OKAY = /^(okay|ok|vale)$/;
const openerOf = (text: string) => normalized(text).split(" ")[0];

function freshOpener(line: string, check: AskCheck) {
  const opener = openerOf(line);
  if (check.opener !== undefined && opener === check.opener) return false;
  return !OKAY.test(opener) || !check.said.some((earlier) => OKAY.test(openerOf(earlier)));
}

const CHECKS: ((line: string, check: AskCheck) => boolean)[] = [
  fitsLength,
  endsAsking,
  (line, check) => inLanguage(line, check.language),
  (line, check) => digitsHeld(line, check.heldDigits),
  asksOnlyItsGoal,
  (line, check) => sayingSomethingNew(line, check.said),
  freshOpener,
];

// Claude's line for the goal, or null to play the template. The honesty guard reads it as if no
// driver had accepted, whatever the status: a question never talks about a ride. A held address is
// taken out first so its house number isn't read as a number Claude made up.
export function checkAsk(ask: Ask | undefined, check: AskCheck): AskVerdict {
  if (!ask || ask.goal !== check.goal) return REJECTED;
  const line = ask.line.trim();
  if (line === "" || !CHECKS.every((passes) => passes(line, check))) return REJECTED;
  const held = digitRuns(check.heldDigits ?? "");
  const unheld = held.reduce((text, run) => text.replaceAll(run, ""), line);
  if (guardAcknowledgment(unheld, "received", check.language).blocked) return { line: null, blocked: true };
  return { line, blocked: false };
}

export function askFrom(raw: unknown): Ask | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { goal, line } = raw as Record<string, unknown>;
  return typeof goal === "string" && typeof line === "string" && line.trim() !== "" ? { goal, line } : undefined;
}

export const ASK_SCHEMA = {
  type: "object",
  properties: { goal: { type: "string" }, line: { type: "string" } },
  required: ["goal", "line"],
  additionalProperties: false,
};

export function goalsText(goals: GoalPrompt[] | undefined) {
  if (!goals || goals.length === 0) return "";
  const listed = goals.map((goal) => {
    const when = goal.when ? ` (${goal.when})` : "";
    const example = goal.scripted ? " The code speaks this one itself: leave ask out." : ` Example: "${goal.question}"`;
    return `- ${goal.goal}${when}.${example}`;
  });
  return `Goals the code asks next, in order. The first is the current one:\n${listed.join("\n")}`;
}

// Shared by both interpreters' prompts.
export const ASK_RULES = `- ask: the agent's next question, in your words. "Goals the code asks next" lists goals in the order the code asks them, each with its condition and the code's own question as an example. Pick the goal the code asks after this answer:
  1. When this answer doesn't settle the current goal, it is the current goal.
  2. Otherwise go down the list and take the first later goal whose condition holds once your own set is applied, skipping any goal your set already answers.
  Leave ask out when that goal is one the code speaks itself, or when the resident asked you to repeat, asked you to wait, asked about a ride or raised an emergency. The code checks your pick and plays its own question when it differs.
  - line: in the call language, at most three short sentences and 30 words, always in two parts: a brief acknowledgment of what they just said in their terms (2 to 6 words, such as "Two of you, okay.", "Mm, no car.", "Thanks, a walker." or "Just you tonight, alright."), then that goal's question reworded in plain everyday words, the way a calm person on the phone would ask it. Never copy the example. Ask about that one goal only. When you also wrote a reply, leave out the acknowledgment.
  - For example, at the current goal can_leave the resident says "No, I can't really get out on my own.": set canLeave=no; has_car is skipped because canLeave isn't yes; ask is {"goal":"household","line":"Alright, you'd need help getting out. Who's there with you right now, and any pets?"}
  - When a goal is asked again, use wording different from every earlier agent turn. Never start with the first word of the agent's last turn, never say "Got it", and say "Okay" at most once in a call.
  - No numerals. The only digits allowed are the address the record already holds, said back when confirming it.
  - The ack's limits apply: never say or imply that help, a driver or a vehicle is coming or being sent, that they are safe, or any time. Never say "we'll", "they'll", "soon", "pick you up", "driver", "crew" or "on the way"; ask "who would drive you out" rather than "who would pick you up". Never give advice.`;
