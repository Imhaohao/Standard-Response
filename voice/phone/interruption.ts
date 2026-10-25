import type { Language } from "../agent/script";

// Whether what the resident says while the agent is talking should stop the agent. People on a
// phone fill the line with "mm-hm", "yeah" and "okay" to show they're listening, and coughs, a
// door or a television reach speech-to-text as a stray word. None of that is a bid for the floor,
// and stopping for it leaves the agent cut off mid-sentence with nothing to answer. The agent
// yields to a resident who is really talking: a few words beyond listening noises, or a word that
// asks it to stop ("wait", "no", "espere"), with enough voice behind it to have been said.

// Voiced audio (see VoiceActivity) behind the words before the agent yields. A "wait" is short; a
// sentence takes longer, and the extra time keeps a burst of line noise from passing as one.
const STOP_WORD_VOICED_MS = 300;
const SPEECH_VOICED_MS = 500;
// Words beyond listening noises before talk counts as taking the floor.
const MIN_CONTENT_WORDS = 2;

// Listening noises and one-word acknowledgments, compared after repeated letters are collapsed,
// so "mmm", "hmmm" and "嗯嗯" all match.
const BACKCHANNEL_WORDS = new Set(
  [
    // English
    "uh", "um", "er", "erm", "ah", "oh", "hm", "m", "mhm", "huh", "yeah", "yes", "yep", "yup", "ok",
    "okay", "right", "sure", "alright", "gotcha", "i", "see",
    // Spanish
    "eh", "em", "este", "ajá", "aja", "sí", "si", "vale", "claro", "bueno", "okey", "ya",
    // Chinese
    "嗯", "啊", "哦", "噢", "呃", "对", "好", "是", "好的", "对对", "是的",
    // Japanese
    "はい", "うん", "ええ", "そう", "なるほど", "あ", "えっと", "えーと",
    // Korean
    "네", "예", "응", "음", "어", "아",
    // Russian
    "да", "ага", "угу", "хорошо", "понятно", "э", "ну",
    // Vietnamese
    "vâng", "dạ", "ừ", "ờ", "à",
    // Tagalog
    "oo", "opo", "sige",
    // French
    "ouais", "oui", "bon", "d'accord", "voilà", "euh", "hein",
    // Hindi
    "हाँ", "हां", "जी", "अच्छा", "ठीक", "हम्म", "हूँ", "हाँजी",
  ].map(collapseRepeats),
);

// Said to stop someone talking. Matched as whole words, or anywhere in scripts written without spaces.
const STOP_PHRASES = [
  "stop", "wait", "hold on", "no", "sorry", "excuse me", "hang on",
  "espera", "espere", "para", "pare", "perdón", "perdone", "disculpe", "oiga",
  "等等", "等一下", "不是", "不对",
  "待って", "ちょっと", "いいえ",
  "잠깐", "아니",
  "подождите", "подожди", "стоп", "нет",
  "khoan", "chờ", "không",
  "teka", "sandali", "hindi",
  "attendez", "arrêtez", "pardon", "non",
  "रुकिए", "रुको", "नहीं", "एक मिनट",
];
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const normalize = (text: string) =>
  text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

function collapseRepeats(word: string) {
  return word.toLowerCase().replace(/(.)\1+/gu, "$1");
}

const segmenters = new Map<Language, Intl.Segmenter>();
function words(text: string, language: Language) {
  let segmenter = segmenters.get(language);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(language, { granularity: "word" });
    segmenters.set(language, segmenter);
  }
  return [...segmenter.segment(normalize(text))].filter((part) => part.isWordLike).map((part) => part.segment);
}

const contentWords = (text: string, language: Language) =>
  words(text, language).filter((word) => !BACKCHANNEL_WORDS.has(collapseRepeats(word)));

function asksToStop(text: string) {
  const spaced = ` ${normalize(text)} `;
  return STOP_PHRASES.some((phrase) => (UNSPACED_SCRIPT.test(phrase) ? spaced.includes(phrase) : spaced.includes(` ${phrase} `)));
}

// Only listening noises: "mm-hm", "yeah, okay", "嗯嗯".
export function isBackchannel(text: string, language: Language) {
  return words(text, language).length > 0 && contentWords(text, language).length === 0;
}

// voicedMs: voiced audio heard since speech-to-text last finished a transcript.
export function interrupts(text: string, voicedMs: number, language: Language) {
  if (asksToStop(text) && voicedMs >= STOP_WORD_VOICED_MS) return true;
  return contentWords(text, language).length >= MIN_CONTENT_WORDS && voicedMs >= SPEECH_VOICED_MS;
}
