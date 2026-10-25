// Keeps an interpreter's prompt warm on Anthropic's side. Two things go cold there: the cached prompt,
// five minutes after its last read (a call's first turn then paid an 8,370-token cache write, 1.5 s
// against about 1.1 s cached), and the compiled JSON schema, which a new key or new request settings
// recompile on first use: measured at 45 to 51 s for one request. So the server warms every prompt
// when it boots, and each call warms its own while it rings and greets.

const FRESH_MS = 4 * 60_000;

export type Warmer = {
  // A real request just read the prompt, so it stays cached for a while yet.
  used(): void;
  warm(): Promise<void>;
};

// send: the interpreter's own request with a one-token answer, so it builds the same cached prefix
// and the same schema as a real turn.
export function warmer(label: string, send: () => Promise<unknown>): Warmer {
  let usedAt = -Infinity;
  return {
    used() {
      usedAt = Date.now();
    },
    async warm() {
      if (Date.now() - usedAt < FRESH_MS) return;
      usedAt = Date.now();
      try {
        await send();
      } catch (error) {
        usedAt = -Infinity;
        console.warn(`[agent] could not warm the ${label} prompt`, error);
      }
    },
  };
}

export const WARM_UP_TEXT = "Nobody has spoken yet.";
