import type { Interpretation } from "./interpreter";
import type { AgentRecord } from "./record";
import type { Language } from "./script";
import { plainAnswer } from "./answerPatterns";

// Answers that need no interpreter: a bare "yes" or "no" to a yes-or-no question, "just me" to the
// head count, "okay" while waiting on hold, "hello?" checking the line. Read here, they answer at
// once; in the voice exam they were about a quarter of all turns, each otherwise waiting about a
// second on Claude. Anything longer, or in a language without a reviewed word list, goes to Claude.

type YesNo = "yes" | "no";
type Words = Record<YesNo, string[]> & { alone: string[]; okay: string[]; hello: string[] };

const WORDS: Partial<Record<Language, Words>> = {
  en: {
    yes: ["yes", "yeah", "yep", "yes it is", "yes that's right", "that's right", "correct"],
    no: ["no", "nope"],
    alone: ["just me", "it's just me", "only me", "just myself"],
    okay: ["okay", "ok", "alright", "thanks", "thank you", "okay thank you", "okay thanks", "mm hm", "mhm", "uh huh"],
    hello: ["hello", "hello hello", "are you there", "hello are you there"],
  },
  es: {
    yes: ["sí", "si", "sí es correcto", "correcto", "así es"],
    no: ["no"],
    alone: ["solo yo", "sólo yo", "nada más yo", "yo sola", "yo solo"],
    okay: ["gracias", "vale", "está bien", "de acuerdo", "ok", "okay", "sí gracias"],
    hello: ["hola", "hola hola", "está ahí", "me escucha"],
  },
};

// Where a bare word has one meaning. At the needs step "yes" could confirm the file or mean oxygen,
// and at the assistance step "yes" doesn't say how much help, so those stay with Claude.
const YES_NO_STEPS: Record<string, YesNo[]> = {
  confirm_address: ["yes", "no"],
  can_leave: ["yes", "no"],
  has_car: ["yes", "no"],
  readback: ["yes", "no"],
  neighbor: ["yes", "no"],
  assistance: ["no"],
  chair_kind: ["yes", "no"],
};

const normalized = (utterance: string) =>
  utterance.toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").replace(/\s+/g, " ").trim();

const reading = (language: Language, overrides: Partial<Interpretation>): Interpretation => ({
  updates: {},
  confidence: {},
  answer: null,
  emergency: "none",
  asksAboutRide: false,
  wantsRepeat: false,
  addressedToAgent: true,
  wantsToEnd: false,
  wantsTime: false,
  asksWhatToDo: false,
  neighborAddresses: [],
  spokenLanguage: language,
  acknowledgment: "",
  feeling: "",
  reply: "",
  ...overrides,
});

function yesNoReading(said: string, step: string, words: Words, language: Language) {
  const answer: YesNo | null = words.yes.includes(said) ? "yes" : words.no.includes(said) ? "no" : null;
  if (!answer || !YES_NO_STEPS[step]?.includes(answer)) return null;
  const updates: AgentRecord = step === "can_leave" ? { canLeave: answer } : {};
  return reading(language, { answer, updates, confidence: step === "can_leave" ? { canLeave: 0.9 } : {} });
}

function phraseReading(said: string, step: string, words: Words, language: Language) {
  if (words.hello.includes(said)) return reading(language, { wantsRepeat: true });
  if (step === "hold" && words.okay.includes(said)) return reading(language, {});
  if (step === "household" && words.alone.includes(said)) {
    return reading(language, { updates: { peopleCount: 1 }, confidence: { peopleCount: 0.9 } });
  }
  return null;
}

// A plain answer to the question (answerPatterns.ts), with each field it gives heard clearly.
function patternReading(said: string, step: string, language: Language) {
  const parsed = plainAnswer(said, step, language);
  if (!parsed) return null;
  const confidence = Object.fromEntries(Object.keys(parsed.updates).map((field) => [field, 0.9]));
  return reading(language, { updates: parsed.updates, confidence, answer: parsed.answer ?? null, saysChairKind: parsed.saysChairKind });
}

export function quickReading(utterance: string, step: string, language: Language): Interpretation | null {
  const words = WORDS[language];
  // A question of their own ("Just me?") or an exclamation ("No! I can't get out!") goes to Claude,
  // which can answer it and name the feeling; "hello?" is checked first.
  if (!words || step === "done") return null;
  const said = normalized(utterance);
  if (words.hello.includes(said)) return reading(language, { wantsRepeat: true });
  if (/[?!¡¿]/.test(utterance)) return null;
  return yesNoReading(said, step, words, language) ?? phraseReading(said, step, words, language) ?? patternReading(said, step, language);
}
