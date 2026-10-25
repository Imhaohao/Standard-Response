"use client";

import type { Census, Town } from "../night-map/town";
import type { Beat } from "../script";
import { Show } from "../show";

// The census colours, as the rescue map uses them, with how many homes in the zone each call found.
const KEY: { census: Census; label: string; color: string }[] = [
  { census: "need", label: "Need help", color: "bg-signal" },
  { census: "help", label: "Can help", color: "bg-ride" },
  { census: "left", label: "Left", color: "bg-leaving" },
  { census: "unreached", label: "Not reached yet", color: "bg-unreachable" },
];

const format = new Intl.NumberFormat("en-US");

function countOf(town: Town | null, census: Census) {
  return town ? town.homes.filter((home) => home.census === census).length : 0;
}

export function CensusScene({ beat, town }: { beat: Beat; town: Town | null }) {
  return (
    <Show when={beat === "census"} delay={1.6} className="absolute flex gap-12 rounded-3xl bg-night/85 px-10 py-7" style={{ left: 128, top: 96 }}>
      {KEY.map((entry) => (
        <div key={entry.census}>
          <p className="type-deck-quote flex items-center gap-4 tabular-nums">
            <span className={`size-7 rounded-full ${entry.color}`} aria-hidden />
            {format.format(countOf(town, entry.census))}
          </p>
          <p className="type-deck-label mt-1 text-on-night-muted">{entry.label}</p>
        </div>
      ))}
    </Show>
  );
}
