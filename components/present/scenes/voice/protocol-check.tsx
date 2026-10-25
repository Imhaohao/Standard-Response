"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME } from "@/lib/brand";
import { sceneMove } from "../../motion";
import { Show } from "../../show";
import { PUSH, REPLY } from "./aligned-reply";

const FIRST_TICK = 0.9;
const TICK_GAP = 0.8;
const tickAt = (index: number) => FIRST_TICK + index * TICK_GAP;

function ReplyPart({ text, index, shown }: { text: string; index: number; shown: boolean }) {
  return (
    <motion.span
      initial={false}
      animate={{ color: shown ? "var(--on-night)" : "var(--on-night-muted)" }}
      transition={{ duration: 0.4, delay: shown ? tickAt(index) : 0 }}
    >
      {text}{" "}
    </motion.span>
  );
}

function Rule({ rule, index, shown }: { rule: string; index: number; shown: boolean }) {
  return (
    <li className="flex items-center gap-5">
      <motion.span
        className="text-leaving"
        initial={false}
        animate={shown ? { opacity: 1, scale: 1 } : { opacity: 0.15, scale: 0.6 }}
        transition={{ ...sceneMove, delay: shown ? tickAt(index) : 0 }}
      >
        <CheckCircle size={56} weight="fill" aria-hidden />
      </motion.span>
      <motion.span
        className="type-deck-lede"
        initial={false}
        animate={{ color: shown ? "var(--on-night)" : "var(--on-night-muted)" }}
        transition={{ duration: 0.4, delay: shown ? tickAt(index) : 0 }}
      >
        {rule}
      </motion.span>
    </li>
  );
}

// A caller pushes for a promise; as each 911 call-taker rule ticks off, the words that keep it light up.
export function ProtocolCheck({ shown }: { shown: boolean }) {
  return (
    <>
      <Show when={shown} delay={0.1} className="absolute" style={{ left: 128, top: 130, width: 860 }}>
        <p className="type-deck-note text-on-night-muted">Caller</p>
        <p className="type-deck-lede mt-2 text-on-night-muted">“{PUSH}”</p>
        <div className="mt-12 rounded-[40px] bg-night-raised p-10 shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
          <p className="type-deck-note flex items-center gap-3 text-on-night-muted">
            <BrandMark className="size-8" />
            {PRODUCT_NAME}
          </p>
          <p className="type-deck-quote mt-4">
            {REPLY.map((part, index) => (
              <ReplyPart key={part.text} text={part.text} index={index} shown={shown} />
            ))}
          </p>
        </div>
      </Show>
      <Show when={shown} delay={0.3} className="absolute" style={{ left: 1100, top: 390, width: 700 }}>
        <ul className="flex flex-col gap-10">
          {REPLY.map((part, index) => (
            <Rule key={part.rule} rule={part.rule} index={index} shown={shown} />
          ))}
        </ul>
      </Show>
    </>
  );
}
