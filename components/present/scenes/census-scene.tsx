"use client";

import type { Beat } from "../script";
import { Show } from "../show";

// The census colours, as the rescue map uses them.
const KEY = [
  { label: "Needs help", color: "bg-signal" },
  { label: "Can help", color: "bg-ride" },
  { label: "Left", color: "bg-leaving" },
  { label: "Not reached yet", color: "bg-unreachable" },
];

export function CensusScene({ beat }: { beat: Beat }) {
  return (
    <Show when={beat === "census"} delay={1.6} className="absolute flex gap-10 rounded-3xl bg-night/80 px-8 py-6" style={{ left: 128, bottom: 96 }}>
      {KEY.map((entry) => (
        <span key={entry.label} className="type-deck-label flex items-center gap-4">
          <span className={`size-6 rounded-full ${entry.color}`} aria-hidden />
          {entry.label}
        </span>
      ))}
    </Show>
  );
}
