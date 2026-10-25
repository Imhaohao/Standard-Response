"use client";

import { FormEvent, useState } from "react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "../ui/button";

type Match = { householdId: string; address: string; snippet: string; callId?: string; at?: number };

export type PickedMatch = { householdId: Id<"households">; address: string; callId?: Id<"calls"> };

const OPEN = "[[";
const CLOSE = "]]";

// The search server marks the words that matched with [[ and ]]; this splits them out so they render bold.
function snippetParts(snippet: string) {
  return snippet.split(OPEN).flatMap((piece, index) => {
    if (index === 0) return piece ? [{ text: piece, hit: false }] : [];
    const [hit, ...rest] = piece.split(CLOSE);
    return [{ text: hit, hit: true }, ...(rest.join(CLOSE) ? [{ text: rest.join(CLOSE), hit: false }] : [])];
  });
}

function Snippet({ snippet }: { snippet: string }) {
  return (
    <span className="type-small text-on-panel-muted">
      {snippetParts(snippet).map((part, index) => (
        <span key={index} className={part.hit ? "font-bold text-on-panel" : ""}>
          {part.text}
        </span>
      ))}
    </span>
  );
}

function useTranscriptSearch() {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [searching, setSearching] = useState(false);
  const run = async (q: string) => {
    setSearching(true);
    try {
      // The server route checks dispatcher access and holds the search secret.
      const response = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q }) });
      setMatches(response.ok ? ((await response.json()) as Match[]) : []);
    } catch {
      setMatches([]);
    } finally {
      setSearching(false);
    }
  };
  return { matches, searching, run, clear: () => setMatches(null) };
}

const FIELD =
  "type-body h-10 min-w-0 flex-1 rounded-lg bg-panel-raised px-3 text-on-panel placeholder:text-on-panel-muted focus-visible:outline-2 focus-visible:outline-on-panel";

// Finds people by what they said: "oxygen", "can't walk", "second floor", in any language the agent heard.
export function TranscriptSearch({ onPick }: { onPick: (match: PickedMatch) => void }) {
  const { matches, searching, run, clear } = useTranscriptSearch();
  const [q, setQ] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (q.trim()) void run(q);
  };
  return (
    <section className="flex flex-col card">
      <form onSubmit={submit} className="flex items-center gap-2 p-2">
        <label className="sr-only" htmlFor="transcript-search">
          Search what residents said
        </label>
        <input
          id="transcript-search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search what people said, like oxygen"
          autoComplete="off"
          className={FIELD}
        />
        {matches && (
          <Button
            variant="onPanelQuiet"
            size="sm"
            square
            aria-label="Clear the search"
            onClick={() => {
              clear();
              setQ("");
            }}
          >
            <X weight="bold" className="size-4" />
          </Button>
        )}
        <Button type="submit" variant="onPanel" size="sm" disabled={searching || !q.trim()}>
          <MagnifyingGlass weight="bold" className="size-4" />
          Search
        </Button>
      </form>
      {matches && <Matches matches={matches} onPick={onPick} />}
    </section>
  );
}

function Matches({ matches, onPick }: { matches: Match[]; onPick: (match: PickedMatch) => void }) {
  if (matches.length === 0) return <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">No call or home matches that.</p>;
  return (
    <ul className="max-h-64 overflow-y-auto border-t border-panel-raised">
      {matches.map((match) => (
        <li key={match.householdId}>
          <button
            type="button"
            onClick={() =>
              onPick({ householdId: match.householdId as Id<"households">, address: match.address, callId: match.callId as Id<"calls"> | undefined })
            }
            className="flex w-full flex-col items-start gap-0.5 border-b border-panel-raised px-3 py-2 text-left hover:bg-panel-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel"
          >
            <span className="type-small font-bold">{match.address}</span>
            <Snippet snippet={match.snippet} />
          </button>
        </li>
      ))}
    </ul>
  );
}
