export type TextLike = { _id: string; direction: string; body: string; at: number };

export const CLUSTER_GAP_MS = 2 * 60_000;

export type ThreadStatus = "needsPerson" | "noReply" | "answered" | "empty";

const DIGIT_MEANINGS: Record<string, string> = {
  "1": "Can leave on their own",
  "2": "Needs a ride",
  "3": "Needs a wheelchair van",
};

export function isDigitReply(body: string) {
  return /^\s*[123]\s*$/.test(body);
}

export function threadStatus(texts: TextLike[]): ThreadStatus {
  const last = texts[texts.length - 1];
  if (!last) return "empty";
  if (last.direction === "outbound") return "noReply";
  return isDigitReply(last.body) ? "answered" : "needsPerson";
}

export function answerMeaning(texts: TextLike[]) {
  const last = texts[texts.length - 1];
  return last ? DIGIT_MEANINGS[last.body.trim()] : undefined;
}

export type PlacedText<T extends TextLike> = {
  text: T;
  startsCluster: boolean;
  startsRun: boolean;
};

export function placeTexts<T extends TextLike>(texts: T[]): PlacedText<T>[] {
  return texts.map((text, index) => {
    const previous = texts[index - 1];
    const senderChanged = !previous || previous.direction !== text.direction;
    const gapped = !previous || text.at - previous.at > CLUSTER_GAP_MS;
    return { text, startsCluster: senderChanged || gapped, startsRun: senderChanged };
  });
}
