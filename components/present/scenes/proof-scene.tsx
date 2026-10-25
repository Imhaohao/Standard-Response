"use client";

import { motion } from "motion/react";
import { PRODUCT_NAME } from "@/lib/brand";
import { sceneMove } from "../motion";
import { Photo } from "../photo";
import type { Beat } from "../script";
import { Percent } from "../percent";
import { Show } from "../show";
import { FireNights, NIGHTS_SIZE } from "./proof/fire-nights";
import { NIGHT_OUTCOME } from "./proof/night-outcome";

// The quote photo keeps a wide group-shot frame (1600 by 845), so everyone stays whole.
const QUOTE_PHOTO = { width: 1140, height: 602 };

const percentOf = (out: number) => Math.round((out / NIGHT_OUTCOME.households) * 100);

const BAR = { width: 260, height: 640, bottom: 150 };

// One bar of the night: a grey track for every at-risk household, filled to the share that got out in time.
function OutcomeBar({ shown, out, label, left }: { shown: boolean; out: number; label: string; left: number }) {
  const share = out / NIGHT_OUTCOME.households;
  return (
    <Show when={shown} rise={0} className="absolute" style={{ left, bottom: BAR.bottom - 80, width: BAR.width }}>
      <p className="type-deck-quote text-center">
        {percentOf(out)}
        <Percent />
      </p>
      <div className="relative mt-4 overflow-hidden rounded-3xl bg-night-raised" style={{ height: BAR.height }}>
        <motion.div
          className="absolute inset-x-0 bottom-0 rounded-3xl bg-leaving"
          initial={false}
          animate={{ height: shown ? share * BAR.height : 0 }}
          transition={{ ...sceneMove, duration: 1.6, delay: shown ? 0.3 : 0 }}
        />
      </div>
      <p className="type-deck-label mt-5 text-center">{label}</p>
    </Show>
  );
}

// How many times as many households the same 25 vans got out, rounded down to a whole number.
const TIMES = Math.floor(NIGHT_OUTCOME.ours.out / NIGHT_OUTCOME.today.out);

function Outcomes({ beat }: { beat: Beat }) {
  const comparing = beat === "today" || beat === "ours";
  return (
    <>
      <Show when={beat === "ours"} delay={1.2} className="absolute" style={{ left: 128, top: 200, width: 820 }}>
        <p className="type-deck-figure">{TIMES}×</p>
        <p className="type-deck-lede mt-8">as many people out in time as today’s “caveman” system</p>
      </Show>
      <Show when={comparing} delay={0.2} className="absolute" style={{ left: 128, bottom: 96, width: 820 }}>
        <p className="type-deck-note text-on-night-muted">
          Simulated on the Eaton Fire’s real 911 and radio records, fire spread and census population, with the same 25 vans
        </p>
      </Show>
      <OutcomeBar shown={comparing} out={NIGHT_OUTCOME.today.out} label="Today" left={1100} />
      <OutcomeBar shown={beat === "ours"} out={NIGHT_OUTCOME.ours.out} label={PRODUCT_NAME} left={1480} />
    </>
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
          <Photo name="station1" />
        </div>
      </Show>
      <Show when={shown} delay={0.4} className="absolute" style={{ left: 128, top: 90 + QUOTE_PHOTO.height + 56, width: 1664 }}>
        <blockquote className="type-deck-quote">“Honestly, this is the most cutting-edge emergency services improvement idea I’ve ever heard.”</blockquote>
        <p className="type-deck-lede mt-6 text-on-night-muted">Jesse, firefighter at Palo Alto Fire Station 1</p>
      </Show>
    </>
  );
}

export function ProofScene({ beat }: { beat: Beat }) {
  return (
    <>
      <Nights shown={beat === "nights"} />
      <Outcomes beat={beat} />
      <Quote shown={beat === "quote"} />
    </>
  );
}
