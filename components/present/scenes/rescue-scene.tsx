"use client";

import { CheckCircle, FireTruck, Car } from "@phosphor-icons/react";
import type { Beat } from "../script";
import { Show } from "../show";

// Who the routes belong to while the optimizer plans, and Maria's yes once she takes Roseland.
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

function MariaAccepted({ shown }: { shown: boolean }) {
  return (
    <Show when={shown} delay={0.3} className="absolute w-[760px] rounded-[32px] bg-night-raised p-10 shadow-[0_30px_80px_oklch(0_0_0/0.5)]" style={{ left: 128, top: 330 }}>
      <p className="type-deck-title">Maria</p>
      <p className="type-deck-lede mt-3 text-on-night-muted">Next door, with a van</p>
      <p className="type-deck-quote mt-10 flex items-center gap-5 text-ride">
        <CheckCircle size={64} weight="fill" aria-hidden />
        Picking up Roseland
      </p>
    </Show>
  );
}

export function RescueScene({ beat }: { beat: Beat }) {
  return (
    <>
      <Fleet shown={beat === "alns" || beat === "routes"} />
      <MariaAccepted shown={beat === "maria"} />
    </>
  );
}
