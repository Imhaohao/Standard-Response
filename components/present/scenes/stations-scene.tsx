"use client";

import { Photo } from "../photo";
import type { PhotoName } from "../photos";
import type { Beat } from "../script";
import { Show } from "../show";

const VISITS: { photo: PhotoName; station: string }[] = [
  { photo: "station1", station: "Palo Alto Fire Station 1" },
  { photo: "station6", station: "Palo Alto Fire Station 6" },
];

export function StationsScene({ beat }: { beat: Beat }) {
  const shown = beat === "stations";
  return (
    <>
      <div className="absolute flex gap-16" style={{ left: 128, top: 110 }}>
        {VISITS.map((visit, i) => (
          <Show key={visit.photo} when={shown} delay={0.1 + i * 0.15} className="w-[800px]">
            <div className="h-[470px] overflow-hidden rounded-[32px] outline-1 -outline-offset-1 outline-white/10">
              <Photo name={visit.photo} />
            </div>
            <p className="type-deck-label mt-5 text-on-night-muted">{visit.station}</p>
          </Show>
        ))}
      </div>
      <Show when={shown} delay={0.6} className="absolute" style={{ left: 128, top: 760, width: 1580 }}>
        <blockquote className="type-deck-quote">“It would be really helpful to have pre-gathered information about what’s going on at an individual residence.”</blockquote>
        <p className="type-deck-lede mt-6 text-on-night-muted">Jesus, firefighter at Palo Alto Fire Station 1</p>
      </Show>
    </>
  );
}
