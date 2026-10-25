"use client";

import { FireTruck, Car } from "@phosphor-icons/react";
import type { Beat } from "../script";
import { Show } from "../show";

// A short stretch of route, drawn the way the map draws that fleet's runs.
function RouteSample({ dashed }: { dashed: boolean }) {
  return (
    <svg width={56} height={8} aria-hidden>
      <line x1={4} y1={4} x2={52} y2={4} stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeDasharray={dashed ? "9 8" : undefined} />
    </svg>
  );
}

// Who the routes belong to while the optimizer plans.
function Fleet({ shown }: { shown: boolean }) {
  return (
    <Show when={shown} delay={0.6} className="absolute flex gap-10 rounded-3xl bg-night/80 px-8 py-6" style={{ left: 128, bottom: 96 }}>
      <span className="type-deck-label flex items-center gap-4 text-on-night">
        <FireTruck size={40} weight="fill" aria-hidden />
        <RouteSample dashed />
        Emergency services
      </span>
      <span className="type-deck-label flex items-center gap-4 text-ride">
        <Car size={40} weight="fill" aria-hidden />
        <RouteSample dashed={false} />
        <span className="text-on-night">Neighbors with a seat</span>
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
