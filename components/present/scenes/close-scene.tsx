"use client";

import { motion, type Transition } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME, WORDMARK, WORDMARK_LAST_WORD } from "@/lib/brand";
import { sceneMove } from "../motion";
import { Photo } from "../photo";
import type { PhotoName } from "../photos";
import type { Beat } from "../script";
import { Show } from "../show";

// Portraits arrive about when each name is said in "the Anthonys, Justins, and Roselands".
const WORDMARK_LEADING = WORDMARK.split(" ").slice(0, -1).join(" ");

// Each frame takes its photo's own shape, so nobody in it is cropped.
const PORTRAITS: { photo: PhotoName; name: string; delay: number; width: number }[] = [
  { photo: "mitchellsSmiling", name: "Anthony Mitchell", delay: 0.5, width: 484 },
  { photo: "roseland", name: "Roseland", delay: 1.9, width: 320 },
];

function Portraits({ shown }: { shown: boolean }) {
  return (
    <div className="absolute flex gap-12" style={{ left: 128, bottom: 120 }}>
      {PORTRAITS.map((portrait) => (
        <Show key={portrait.photo} when={shown} delay={portrait.delay} style={{ width: portrait.width }}>
          <div className="h-[444px] overflow-hidden rounded-[28px] shadow-[0_30px_80px_oklch(0_0_0/0.5)] outline-1 -outline-offset-1 outline-white/10">
            <Photo name={portrait.photo} compact />
          </div>
          <p className="type-deck-label mt-5">{portrait.name}</p>
        </Show>
      ))}
    </div>
  );
}

// On "let's save lives" the call mark rings in and the last word arrives beside it; on the last click
// the first word opens in above it and the mark grows to both lines' height. It is one wordmark the
// whole time, so every piece moves by animating a number rather than jumping between layouts.
const GROW: Transition = { type: "spring", duration: 1.6, bounce: 0 };
const MARK_PX = { alone: 230, full: 340 };

function ClosingWordmark({ beat }: { beat: Beat }) {
  const shown = beat === "saveLives" || beat === "wordmark";
  const full = beat === "wordmark";
  return (
    <motion.div
      className="type-deck-display absolute inset-0 flex items-center justify-center gap-[0.22em] font-brand text-on-night"
      initial={false}
      animate={{ opacity: shown ? 1 : 0 }}
      transition={{ duration: 0.8 }}
      role="img"
      aria-label={PRODUCT_NAME}
    >
      <motion.span
        className="flex shrink-0"
        initial={false}
        animate={{ width: full ? MARK_PX.full : MARK_PX.alone, height: full ? MARK_PX.full : MARK_PX.alone, scale: shown ? 1 : 0.6 }}
        transition={GROW}
      >
        <BrandMark className="size-full" />
      </motion.span>
      <span className="flex flex-col items-start">
        <motion.span
          className="overflow-hidden"
          initial={false}
          animate={full ? { height: "auto", opacity: 1, y: 0 } : { height: 0, opacity: 0, y: -40 }}
          transition={{ ...GROW, opacity: { duration: 0.9, delay: full ? 0.35 : 0 } }}
        >
          {WORDMARK_LEADING}
        </motion.span>
        <motion.span initial={false} animate={{ opacity: shown ? 1 : 0, x: shown ? 0 : -40 }} transition={{ ...sceneMove, delay: beat === "saveLives" ? 1.4 : 0 }}>
          {WORDMARK_LAST_WORD}
        </motion.span>
      </span>
    </motion.div>
  );
}

export function CloseScene({ beat }: { beat: Beat }) {
  return (
    <>
      <Show when={beat === "told"} delay={0.8} className="absolute" style={{ right: 128, top: 300, width: 860 }}>
        <blockquote className="type-deck-title">“They’re on their way.”</blockquote>
        <p className="type-deck-lede mt-8 text-on-night-muted">911 dispatcher to Anthony Mitchell</p>
      </Show>
      <Portraits shown={beat === "everyone"} />
      <ClosingWordmark beat={beat} />
    </>
  );
}
