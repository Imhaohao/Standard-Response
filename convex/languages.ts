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

// What a rider list may put in its language column: anything we can speak or at least hear.
export const fileLanguageOf = (value: string | undefined): string =>
  isSpokenLanguage(value) || (HEARD_ONLY_LANGUAGES as readonly string[]).includes(value ?? "") ? (value as string) : "en";
