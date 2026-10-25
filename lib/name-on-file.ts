// The one person on file a caller means by a name ("Boris is bedridden" is Boris Nezlobin). A first
// or last name must appear as a whole word in what they said; two people who both fit is no match,
// so a common first name never points a crew at the wrong house.

const MIN_NAME_LENGTH = 3;

const wordsOf = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= MIN_NAME_LENGTH);

export function nameOnFile(spoken: string, names: readonly string[]): string | undefined {
  const said = new Set(wordsOf(spoken));
  const fits = names.filter((name) => wordsOf(name).some((word) => said.has(word)));
  return fits.length === 1 ? fits[0] : undefined;
}
