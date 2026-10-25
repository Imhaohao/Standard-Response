"use client";

import type { Census, Town } from "../night-map/town";
import type { Beat } from "../script";
import { Show } from "../show";

// The census colours, as the rescue map uses them, with how many homes in the zone each call found.
// Each count sits inside a box of its colour; amber is light enough that its count is set dark.
const KEY: { census: Census; label: string; box: string }[] = [
  { census: "need", label: "Need help", box: "bg-signal text-on-night" },
  { census: "help", label: "Can help", box: "bg-ride text-night" },
  { census: "left", label: "Left", box: "bg-leaving text-on-night" },
  { census: "unreached", label: "Not reached yet", box: "bg-unreachable text-on-night" },
];

const format = new Intl.NumberFormat("en-US");

function countOf(town: Town | null, census: Census) {
  return town ? town.homes.filter((home) => home.census === census).length : 0;
}

// A column down the left edge, clear of the zone the camera frames to the right.
export function CensusScene({ beat, town }: { beat: Beat; town: Town | null }) {
  return (
    <Show when={beat === "census"} delay={1.6} className="absolute flex flex-col gap-4 rounded-3xl bg-night/85 p-6" style={{ left: 96, top: 180 }}>
      {KEY.map((entry) => (
        <div key={entry.census} className="flex items-center gap-6">
          <p className={`type-deck-quote w-[230px] rounded-xl px-5 py-1 text-right tabular-nums ${entry.box}`}>{format.format(countOf(town, entry.census))}</p>
          <p className="type-deck-label text-on-night-muted">{entry.label}</p>
        </div>
      ))}
    </Show>
  );
}
