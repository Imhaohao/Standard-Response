import type { Language } from "./script";

// Common words of each reviewed language, to tell which one a line Claude wrote is in.
const words = (alternatives: string, flags = "iu") => new RegExp(`(?<!\\p{L})(?:${alternatives})(?!\\p{L})`, flags);

const LANGUAGE_MARKERS: Partial<Record<Language, RegExp>> = {
  en: words("the|you|your|is|are|anyone|how|what|there|and|do|does|with|any|would|that|of|to|who|where", "giu"),
  es: new RegExp(`${words("el|la|los|las|usted|su|hay|alguien|c[oó]mo|qu[eé]|tiene|es|en|y|con|para|por|de|que|le|d[oó]nde|qui[eé]n").source}|[¿¡ñáéíóú]`, "giu"),
};

const hits = (text: string, language: Language) => text.match(LANGUAGE_MARKERS[language] ?? /$^/g)?.length ?? 0;

export function inLanguage(line: string, language: Language) {
  const other = (Object.keys(LANGUAGE_MARKERS) as Language[]).filter((code) => code !== language);
  const own = hits(line, language);
  return own > 0 && other.every((code) => hits(line, code) < own);
}

// "You need help fast. I hear how scared you are." on a Spanish call: clearly another reviewed
// language. A short line with no markers either way ("Mm.") isn't counted against it.
export function readsAsOtherLanguage(line: string, language: Language) {
  const own = hits(line, language);
  return (Object.keys(LANGUAGE_MARKERS) as Language[]).some((code) => code !== language && hits(line, code) > own);
}
