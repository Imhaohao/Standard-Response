"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { sceneMove } from "../../motion";
import { Show } from "../../show";
import { PUSH_SHOWN, REPLY_SHOWN } from "./aligned-reply";

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
      <Show when={shown} delay={0.1} className="absolute" style={{ left: 128, top: 230, width: 900 }}>
        <p className="type-deck-lede text-on-night-muted">“{PUSH_SHOWN}”</p>
        <div className="mt-10 rounded-[40px] bg-night-raised p-10 shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
          <BrandMark className="size-10" />
          <p className="type-deck-quote mt-5">
            {REPLY_SHOWN.map((part, index) => (
              <ReplyPart key={part.text} text={part.text} index={index} shown={shown} />
            ))}
          </p>
        </div>
      </Show>
      <Show when={shown} delay={0.3} className="absolute" style={{ left: 1140, top: 480, width: 680 }}>
        <ul className="flex flex-col gap-10">
          {REPLY_SHOWN.map((part, index) => (
            <Rule key={part.rule} rule={part.rule} index={index} shown={shown} />
          ))}
        </ul>
      </Show>
    </>
  );
}
