// Languages a whole call can run in: Cartesia Ink hears them and Sonic speaks them. The first two
// are reviewed by fluent speakers; the rest are machine translations awaiting review.
export const SPOKEN_LANGUAGES = ["en", "es", "zh", "ko", "vi", "tl", "ru", "ja", "fr", "hi"] as const;
export type Language = (typeof SPOKEN_LANGUAGES)[number];

export const REVIEWED_LANGUAGES: readonly Language[] = ["en", "es"];

// Ink hears these, but Sonic can't speak them, so the call goes to a person.
export const HEARD_ONLY_LANGUAGES = ["hy", "fa"] as const;

export const isSpokenLanguage = (value: string | undefined): value is Language =>
  (SPOKEN_LANGUAGES as readonly string[]).includes(value ?? "");

export const languageOf = (value: string | undefined): Language => (isSpokenLanguage(value) ? value : "en");

// What a home's file may say it speaks: anything we can speak or at least hear.
export const FILE_LANGUAGES: readonly string[] = [...SPOKEN_LANGUAGES, ...HEARD_ONLY_LANGUAGES];

export const isFileLanguage = (value: string | undefined) => FILE_LANGUAGES.includes(value ?? "");

export const isHeardOnlyLanguage = (value: string) => (HEARD_ONLY_LANGUAGES as readonly string[]).includes(value);

// What a rider list may put in its language column.
export const fileLanguageOf = (value: string | undefined): string => (isFileLanguage(value) ? (value as string) : "en");

// Each call language as its speakers write it, and in English for a crew reading the house card.
const LANGUAGE_NAMES: Record<string, { native: string; english: string }> = {
  en: { native: "English", english: "English" },
  es: { native: "Español", english: "Spanish" },
  zh: { native: "中文", english: "Chinese" },
  ko: { native: "한국어", english: "Korean" },
  vi: { native: "Tiếng Việt", english: "Vietnamese" },
  tl: { native: "Tagalog", english: "Tagalog" },
  ru: { native: "Русский", english: "Russian" },
  ja: { native: "日本語", english: "Japanese" },
  fr: { native: "Français", english: "French" },
  hi: { native: "हिन्दी", english: "Hindi" },
  hy: { native: "Հայերեն", english: "Armenian" },
  fa: { native: "فارسی", english: "Persian" },
};
export const languageName = (code: string) => LANGUAGE_NAMES[code]?.native ?? code;
export const languageInEnglish = (code: string) => LANGUAGE_NAMES[code]?.english ?? code;
