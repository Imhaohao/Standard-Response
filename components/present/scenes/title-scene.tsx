"use client";

import type { Beat } from "../script";
import { Show } from "../show";
import { Wordmark } from "../wordmark";

export function TitleScene({ beat }: { beat: Beat }) {
  const shown = beat === "title";
  return (
    <>
      <Show
        when={shown}
        rise={0}
        className="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_10%_95%,var(--night)_30%,transparent_75%)]"
      >
        <span />
      </Show>
      <Show when={shown} delay={0.2} className="absolute" style={{ left: 128, bottom: 160, width: 1500 }}>
        <Wordmark className="type-deck-display" stacked />
        <p className="type-deck-lede mt-10 max-w-[32ch] text-on-night-muted">
          We save lives by solving the information-at-scale problem for emergency services
        </p>
      </Show>
    </>
  );
}
