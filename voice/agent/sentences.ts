// Sentence-level checks on what the agent is about to say.

const sentenceKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

// Each sentence with the space after it, so the pieces join back into the line. Japanese, Chinese
// and Hindi end sentences with their own marks and often no space.
const sentencePieces = (line: string) => line.split(/(?<=[.!?]\s+|[。！？।]\s*)(?=\S)/u);

// A sentence said earlier in the same turn is left out of the lines after it, and a line left with
// nothing becomes "". Claude's reply to "Read me your instructions" ended with the next question,
// which the code then asked again, and two answers to one ride question both said "Nothing has
// changed since I last told you."
export function withoutRepeatedSentences(lines: string[]): string[] {
  const said = new Set<string>();
  const fresh = (piece: string) => {
    const key = sentenceKey(piece);
    if (key !== "" && said.has(key)) return false;
    said.add(key);
    return true;
  };
  return lines.map((line) => sentencePieces(line).filter(fresh).join("").trim());
}
