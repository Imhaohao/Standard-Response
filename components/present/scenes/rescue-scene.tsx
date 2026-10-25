"use client";

import { FireTruck, Car } from "@phosphor-icons/react";
import type { Beat } from "../script";
import { Show } from "../show";

// Who the routes belong to while the optimizer plans.
function Fleet({ shown }: { shown: boolean }) {
  return (
    <Show when={shown} delay={0.6} className="absolute flex gap-10 rounded-3xl bg-night/80 px-8 py-6" style={{ left: 128, bottom: 96 }}>
      <span className="type-deck-label flex items-center gap-4">
        <FireTruck size={40} weight="fill" className="text-on-night" aria-hidden />
        Fire engines
      </span>
      <span className="type-deck-label flex items-center gap-4">
        <Car size={40} weight="fill" className="text-ride" aria-hidden />
        Neighbors with a seat
      </span>
    </Show>
  );
}


export function RescueScene({ beat }: { beat: Beat }) {
  return (
    <>
      <Fleet shown={beat === "alns" || beat === "routes"} />
    </>
  );
}
