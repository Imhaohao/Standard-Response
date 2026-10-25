"use client";

import { Photo } from "../photo";
import type { Beat } from "../script";
import { Show } from "../show";
import { FireNights, NIGHTS_SIZE } from "./proof/fire-nights";
import { HomeField } from "./proof/home-field";
import { NIGHT_OUTCOME } from "./proof/night-outcome";

const percentOf = (out: number) => Math.round((out / NIGHT_OUTCOME.homes) * 100);

function Outcome({ shown, out, label, left }: { shown: boolean; out: number; label: string; left: number }) {
  return (
    <div className="absolute" style={{ left, top: 110 }}>
      <Show when={shown}>
        <p className="type-deck-figure">
          {percentOf(out)}
          {/* Nexa Rust has no percent sign, so it comes from the condensed display face. */}
          <span className="font-display">%</span>
        </p>
        <p className="type-deck-label mt-8">{label}</p>
        <p className="type-deck-note mt-1 text-on-night-muted tabular-nums">
          {out} of {NIGHT_OUTCOME.homes} homes out in time
        </p>
      </Show>
      <div className="mt-10">
        <HomeField shown={shown} homes={NIGHT_OUTCOME.homes} out={out} />
      </div>
    </div>
  );
}

function Nights({ shown }: { shown: boolean }) {
  return (
    <>
      <Show when={shown} delay={0.2} className="absolute" style={{ left: 128, top: 330, width: 760 }}>
        <p className="type-deck-figure">100</p>
        <p className="type-deck-lede mt-8">simulated fire nights, with households and 911 calls modeled on real data</p>
      </Show>
      <Show when={shown} rise={0} className="absolute" style={{ right: 128, top: (1080 - NIGHTS_SIZE) / 2 }}>
        <FireNights running={shown} />
      </Show>
    </>
  );
}

export function ProofScene({ beat }: { beat: Beat }) {
  const comparing = beat === "today" || beat === "ours";
  return (
    <>
      <Nights shown={beat === "nights"} />
      <Outcome shown={comparing} out={NIGHT_OUTCOME.today} label="Today’s process" left={128} />
      <Outcome shown={beat === "ours"} out={NIGHT_OUTCOME.ours} label="With Standard Response" left={1090} />
      <Show when={comparing} delay={1.2} className="absolute" style={{ left: 128, bottom: 56 }}>
        <p className="type-deck-note text-on-night-muted">Simulated on the Eaton Fire’s real record, median of 5 runs, {NIGHT_OUTCOME.setup}</p>
      </Show>
      <Show when={beat === "quote"} delay={0.2} className="absolute" style={{ left: 128, top: 400, width: 940 }}>
        <blockquote className="type-deck-quote">“Honestly, this one is probably the most at the cutting edge of what we’re already doing and what could be helpful.”</blockquote>
        <p className="type-deck-label mt-10 text-on-night-muted">Firefighter, Palo Alto Fire Station 1</p>
      </Show>
      <Show when={beat === "quote"} delay={0.4} className="absolute" style={{ left: 1180, top: 140, width: 612, height: 800 }}>
        <div className="size-full overflow-hidden rounded-[32px] outline-1 -outline-offset-1 outline-white/10">
          <Photo name="station1" />
        </div>
      </Show>
    </>
  );
}
