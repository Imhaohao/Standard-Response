"use client";

import { PRODUCT_NAME } from "@/lib/brand";
import { Photo } from "../photo";
import type { Beat } from "../script";
import { Percent } from "../percent";
import { Show } from "../show";
import { FireNights, NIGHTS_SIZE } from "./proof/fire-nights";
import { NIGHT_OUTCOME } from "./proof/night-outcome";
import { PeopleField } from "./proof/people-field";

// The Station 6 photo is a wide group shot (1600 by 845), so its frame keeps that shape and everyone stays whole.
const QUOTE_PHOTO = { width: 1140, height: 602 };

const percentOf = (out: number) => Math.round((out / NIGHT_OUTCOME.households) * 100);

type OutcomeProps = { shown: boolean; outcome: { out: number; setup: string }; label: string; left: number };

function Outcome({ shown, outcome, label, left }: OutcomeProps) {
  return (
    <div className="absolute" style={{ left, top: 90 }}>
      <Show when={shown}>
        <p className="type-deck-figure">
          {percentOf(outcome.out)}
          <Percent />
        </p>
        <p className="type-deck-label mt-8">{label}</p>
        <p className="type-deck-note mt-1 text-on-night-muted tabular-nums">
          {outcome.out} of {NIGHT_OUTCOME.households} households out in time
        </p>
        <p className="type-deck-note text-on-night-muted">{outcome.setup}</p>
      </Show>
      <div className="mt-8">
        <PeopleField shown={shown} households={NIGHT_OUTCOME.households} out={outcome.out} />
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

function Quote({ shown }: { shown: boolean }) {
  return (
    <>
      <Show when={shown} delay={0.2} className="absolute" style={{ left: 128, top: 90, ...QUOTE_PHOTO }}>
        <div className="size-full overflow-hidden rounded-[32px] outline-1 -outline-offset-1 outline-white/10">
          <Photo name="station6" />
        </div>
      </Show>
      <Show when={shown} delay={0.4} className="absolute" style={{ left: 128, top: 90 + QUOTE_PHOTO.height + 56, width: 1664 }}>
        <blockquote className="type-deck-quote">“Honestly, this one is probably the most at the cutting edge of what we’re already doing and what could be helpful.”</blockquote>
        <p className="type-deck-lede mt-6 text-on-night-muted">Jesse, firefighter at Palo Alto Fire Station 6</p>
      </Show>
    </>
  );
}

export function ProofScene({ beat }: { beat: Beat }) {
  const comparing = beat === "today" || beat === "ours";
  return (
    <>
      <Nights shown={beat === "nights"} />
      <Outcome shown={comparing} outcome={NIGHT_OUTCOME.today} label="Today’s process" left={128} />
      <Outcome shown={beat === "ours"} outcome={NIGHT_OUTCOME.ours} label={`With ${PRODUCT_NAME}`} left={1012} />
      <Show when={comparing} delay={1.2} className="absolute" style={{ left: 128, bottom: 28 }}>
        <p className="type-deck-note text-on-night-muted">Simulated on the Eaton Fire’s real record, median of 5 runs</p>
      </Show>
      <Quote shown={beat === "quote"} />
    </>
  );
}
