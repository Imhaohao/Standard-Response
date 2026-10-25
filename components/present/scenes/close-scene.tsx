"use client";

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME, WORDMARK } from "@/lib/brand";
import { sceneMove } from "../motion";
import { Photo } from "../photo";
import type { PhotoName } from "../photos";
import type { Beat } from "../script";
import { Show } from "../show";
import { Wordmark } from "../wordmark";

// Portraits arrive about when each name is said in "the Anthonys, Justins, and Roselands".
const PORTRAITS: { photo: PhotoName; name: string; delay: number }[] = [
  { photo: "mitchells", name: "Anthony and Justin", delay: 0.5 },
  { photo: "roseland", name: "Roseland", delay: 1.9 },
];

const SECOND_WORD = WORDMARK.split(" ").slice(1).join(" ");

function Portraits({ shown }: { shown: boolean }) {
  return (
    <div className="absolute flex gap-12" style={{ left: 128, bottom: 120 }}>
      {PORTRAITS.map((portrait) => (
        <Show key={portrait.photo} when={shown} delay={portrait.delay} className="w-[420px]">
          <div className="h-[300px] overflow-hidden rounded-[28px] shadow-[0_30px_80px_oklch(0_0_0/0.5)] outline-1 -outline-offset-1 outline-white/10">
            <Photo name={portrait.photo} compact />
          </div>
          <p className="type-deck-label mt-5">{portrait.name}</p>
        </Show>
      ))}
    </div>
  );
}

// On "let's save lives" the call mark rings in, then the word arrives beside it. On the last click
// both fly into the full wordmark.
function Response({ beat }: { beat: Beat }) {
  return (
    <LayoutGroup>
      <AnimatePresence>
        {beat === "saveLives" && (
          <motion.div
            key="response"
            className="type-deck-display absolute inset-0 flex items-center justify-center gap-[0.22em] font-brand text-on-night"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0 } }}
            aria-label={PRODUCT_NAME}
          >
            <motion.span layoutId="wordmark-mark" className="flex" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={sceneMove}>
              <BrandMark className="size-[1.1em]" />
            </motion.span>
            <motion.span layoutId="wordmark-second" initial={{ opacity: 0, x: -40 }} animate={{ opacity: 1, x: 0 }} transition={{ ...sceneMove, delay: 1.4 }}>
              {SECOND_WORD}
            </motion.span>
          </motion.div>
        )}
        {beat === "wordmark" && (
          <motion.div key="wordmark" className="absolute inset-0 flex items-center justify-center" exit={{ opacity: 0 }}>
            <Wordmark className="type-deck-display" stacked shared />
          </motion.div>
        )}
      </AnimatePresence>
    </LayoutGroup>
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
      <Response beat={beat} />
    </>
  );
}
