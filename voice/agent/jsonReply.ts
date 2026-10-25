// The interpreters ask for JSON in the prompt instead of through the API's structured-output format.
// The format constrains every token to the schema's grammar, which measured on the warning-call
// prompt cost 130 ms before the first token and 250 ms per turn at the median, with a 2.7 s tail
// (12 turns each, Haiku: 1,287 ms p50 with it, 1,041 ms without). Each parse function already drops
// any value outside its allowed choices, so a stray value is unheard rather than recorded.

export const jsonRule = (schema: object) =>
  `Reply with one JSON object and nothing else, matching this JSON Schema. Leave out every optional key that has nothing to say: never write an empty string, an empty list, null or "none".\n${JSON.stringify(schema)}`;

export function jsonObjectIn(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("Reply holds no JSON object");
  const candidate = content.slice(start, end + 1);
  JSON.parse(candidate);
  return candidate;
}

// The parts of a Claude reply, standard or beta, that hold its text.
type Reply = { stop_reason: string | null; content: readonly ({ type: "text"; text: string } | { type: string })[] };

// The JSON object in a Claude reply, or an error naming the interpreter when there is none.
export function jsonReply(response: Reply, interpreter: string): string {
  const block = response.content.find((item): item is { type: "text"; text: string } => item.type === "text");
  if (response.stop_reason === "refusal" || !block) {
    throw new Error(`${interpreter} returned no text (stop_reason ${response.stop_reason})`);
  }
  return jsonObjectIn(block.text);
}
