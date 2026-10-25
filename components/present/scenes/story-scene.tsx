"use client";

import { PhoneOutgoing, PhoneSlash } from "@phosphor-icons/react";
import { motion, type Transition } from "motion/react";
import type { ScreenPoint } from "@/lib/ink-map/renderer";
import { STAGE } from "../stage";
import { sceneMove } from "../motion";
import { Photo } from "../photo";
import { isAtOrAfter, type Beat } from "../script";
import { Show } from "../show";

type Frame = { left: number; top: number; width: number; height: number; borderRadius: number; opacity: number };

const MARK = 26;
const FULL: Frame = { left: 0, top: 0, width: STAGE.width, height: STAGE.height, borderRadius: 0, opacity: 1 };
// The photo shrinks into the house mark wherever the camera has put it.
function intoHouse(at: ScreenPoint | null): Frame {
  const { x, y } = at ?? { x: STAGE.width / 2, y: STAGE.height / 2 };
  return { left: x - MARK / 2, top: y - MARK / 2, width: MARK, height: MARK, borderRadius: MARK / 2, opacity: 0 };
}
const CARD: Frame = { left: 1150, top: 150, width: 640, height: 450, borderRadius: 32, opacity: 1 };

function portraitFrame(beat: Beat, houseAt: ScreenPoint | null): Frame {
  if (beat === "anthony") return FULL;
  if (beat === "calls") return CARD;
  if (isAtOrAfter(beat, "gone")) return { ...CARD, opacity: 0 };
  if (isAtOrAfter(beat, "family")) return intoHouse(houseAt);
  return { ...FULL, opacity: 0 };
}

function portraitMove(beat: Beat): Transition {
  if (beat === "family") return { ...sceneMove, duration: 1.8, opacity: { delay: 1.3, duration: 0.5 } };
  if (beat === "gone") return { ...sceneMove, opacity: { duration: 1.6 } };
  return sceneMove;
}

function Portrait({ beat, houseAt }: { beat: Beat; houseAt: ScreenPoint | null }) {
  return (
    <motion.div
      className="absolute overflow-hidden shadow-[0_30px_80px_oklch(0_0_0/0.5)] outline-1 -outline-offset-1 outline-white/10"
      initial={false}
      animate={portraitFrame(beat, houseAt)}
      transition={portraitMove(beat)}
    >
      <Photo name="mitchells" compact={beat !== "anthony"} />
    </motion.div>
  );
}

// Each 911 call rings, then goes dead: the phone turns into a slashed phone and the row greys out.
const RING_SECONDS = 2.8;

function CallRow({ shown, delay, time }: { shown: boolean; delay: number; time: string }) {
  const at = (keyframes: number[]) => ({ duration: RING_SECONDS, delay: shown ? delay : 0, times: keyframes });
  return (
    <motion.div
      className="flex h-[104px] items-center gap-7 rounded-3xl bg-night-raised px-8"
      initial={false}
      animate={shown ? { opacity: [0, 1, 1, 0.55], y: [16, 0, 0, 0] } : { opacity: 0, y: 16 }}
      transition={at([0, 0.12, 0.8, 1])}
    >
      <span className="relative size-12 shrink-0">
        <motion.span className="absolute inset-0 text-signal" initial={false} animate={{ opacity: shown ? [1, 1, 0] : 1 }} transition={at([0, 0.8, 0.9])}>
          <PhoneOutgoing size={48} weight="fill" className={shown ? "animate-ringing" : undefined} />
        </motion.span>
        <motion.span className="absolute inset-0 text-on-night-muted" initial={false} animate={{ opacity: shown ? [0, 0, 1] : 0 }} transition={at([0, 0.8, 0.95])}>
          <PhoneSlash size={48} weight="bold" />
        </motion.span>
      </span>
      <span className="type-deck-lede font-semibold">Called 911</span>
      <span className="type-deck-quote ml-auto tabular-nums">{time}</span>
    </motion.div>
  );
}

export function StoryScene({ beat, houseAt }: { beat: Beat; houseAt: ScreenPoint | null }) {
  const calling = beat === "calls";
  return (
    <>
      <Portrait beat={beat} houseAt={houseAt} />
      <Show
        when={beat === "anthony"}
        rise={0}
        className="absolute inset-x-0 bottom-0 h-[520px] bg-[linear-gradient(to_top,var(--night)_10%,transparent)]"
      >
        <span />
      </Show>
      <Show when={beat === "anthony"} delay={0.3} className="absolute" style={{ left: 128, bottom: 120 }}>
        <p className="type-deck-title">Anthony Mitchell</p>
        <p className="type-deck-lede mt-4 text-on-night-muted">68, west Altadena</p>
      </Show>
      <Show when={beat === "night"} delay={0.6} className="absolute" style={{ left: 128, bottom: 120 }}>
        <p className="type-deck-title">Eaton Fire</p>
        <p className="type-deck-lede mt-4 text-on-night-muted">January 7, 2025</p>
      </Show>
      <div className="absolute flex flex-col gap-5" style={{ left: CARD.left, top: CARD.top + CARD.height + 40, width: CARD.width }}>
        <CallRow shown={calling} delay={0.9} time="6:03 am" />
        <CallRow shown={calling} delay={3.4} time="6:14 am" />
      </div>
    </>
  );
}
