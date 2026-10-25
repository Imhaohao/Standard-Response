"use client";

import { PhoneOutgoing, PhoneSlash } from "@phosphor-icons/react";
import { motion, type Transition } from "motion/react";
import { STAGE } from "../stage";
import { CAMERA_GLIDE_SECONDS, STORY_ANIMATION_PACE, briskSceneMove, quickFade, sceneMove } from "../motion";
import { Photo } from "../photo";
import { isAtOrAfter, type Beat } from "../script";
import { Show } from "../show";

type Frame = { left: number; top: number; width: number; height: number; borderRadius: number; opacity: number };

const MARK = 26;
const FULL: Frame = { left: 0, top: 0, width: STAGE.width, height: STAGE.height, borderRadius: 0, opacity: 1 };
// On 1.2 the camera settles with the house in the middle of the stage, so the photo shrinks straight to
// that spot over the same time and fades only as it lands on the red dot.
const INTO_HOUSE: Frame = {
  left: STAGE.width / 2 - MARK / 2,
  top: STAGE.height / 2 - MARK / 2,
  width: MARK,
  height: MARK,
  borderRadius: MARK / 2,
  opacity: 0,
};
// The family photo is landscape, so 1.4's card is too. The call rows sit under it.
const CARD: Frame = { left: 1150, top: 110, width: 640, height: 480, borderRadius: 32, opacity: 1 };
const CALL_ROWS = { left: 1090, top: CARD.top + CARD.height + 40, width: 740 };
// Anthony with his family, whole, at the photo's own shape on the right.
const PORTRAIT: Frame = { left: 880, top: 196, width: 920, height: 689, borderRadius: 32, opacity: 1 };

// On 2.3 the family photo comes back beside the dark house: these are the people we're asking how to save.
const BESIDE_HOUSE: Frame = { left: 1100, top: 250, width: 640, height: 480, borderRadius: 32, opacity: 1 };

function portraitFrame(beat: Beat): Frame {
  if (beat === "anthony") return PORTRAIT;
  if (beat === "calls") return CARD;
  if (beat === "howSave") return BESIDE_HOUSE;
  if (isAtOrAfter(beat, "gone")) return { ...CARD, opacity: 0 };
  if (isAtOrAfter(beat, "family")) return INTO_HOUSE;
  return { ...FULL, opacity: 0 };
}

function portraitMove(beat: Beat): Transition {
  if (beat === "family") return { type: "tween", duration: CAMERA_GLIDE_SECONDS, ease: [0.65, 0, 0.35, 1], opacity: { delay: CAMERA_GLIDE_SECONDS - 0.35, duration: 0.35 } };
  if (beat === "gone") return { ...briskSceneMove, opacity: { duration: 1.6 / STORY_ANIMATION_PACE } };
  if (beat === "night" || beat === "calls") return briskSceneMove;
  return sceneMove;
}

function Portrait({ beat }: { beat: Beat }) {
  return (
    <motion.div
      className="absolute overflow-hidden shadow-[0_30px_80px_oklch(0_0_0/0.5)] outline-1 -outline-offset-1 outline-white/10"
      initial={false}
      animate={portraitFrame(beat)}
      transition={portraitMove(beat)}
    >
      <Photo name="mitchells" compact={beat !== "anthony" && beat !== "howSave"} />
    </motion.div>
  );
}

// Each 911 call rings, then goes dead: the phone turns into a slashed phone and the row greys out.
// Leaving the slide, the row just fades with the dead phone still showing.
const RING_SECONDS = 2.8 / STORY_ANIMATION_PACE;

function CallRow({ shown, delay, time }: { shown: boolean; delay: number; time: string }) {
  const at = (keyframes: number[]) => (shown ? { duration: RING_SECONDS, delay, times: keyframes } : quickFade);
  return (
    <motion.div
      className="flex h-[104px] items-center gap-7 rounded-3xl bg-night-raised px-8"
      initial={false}
      animate={shown ? { opacity: [0, 1, 1, 0.55], y: [16, 0, 0, 0] } : { opacity: 0, y: 16 }}
      transition={at([0, 0.12, 0.8, 1])}
    >
      <span className="relative size-12 shrink-0">
        <motion.span className="absolute inset-0 text-signal" initial={false} animate={{ opacity: shown ? [1, 1, 0] : 0 }} transition={at([0, 0.8, 0.9])}>
          <PhoneOutgoing size={48} weight="fill" className={shown ? "animate-ringing" : undefined} />
        </motion.span>
        <motion.span className="absolute inset-0 text-on-night-muted" initial={false} animate={{ opacity: shown ? [0, 0, 1] : 1 }} transition={at([0, 0.8, 0.95])}>
          <PhoneSlash size={48} weight="bold" />
        </motion.span>
      </span>
      <span className="type-deck-lede font-semibold">Called 911</span>
      <span className="type-deck-quote ml-auto tabular-nums">{time}</span>
    </motion.div>
  );
}

export function StoryScene({ beat }: { beat: Beat }) {
  const calling = beat === "calls";
  return (
    <>
      <Portrait beat={beat} />
      <Show
        when={beat === "anthony"}
        rise={0}
        className="absolute inset-x-0 bottom-0 h-[520px] bg-[linear-gradient(to_top,var(--night)_10%,transparent)]"
      >
        <span />
      </Show>
      <Show when={beat === "anthony"} delay={0.3} className="absolute" style={{ left: 128, bottom: 120, width: 820 }}>
        <p className="type-deck-title">Anthony Mitchell</p>
        <p className="type-deck-lede mt-4 text-on-night-muted">68 years old</p>
      </Show>
      <Show when={beat === "night"} delay={0.6 / STORY_ANIMATION_PACE} className="absolute" style={{ left: 128, bottom: 120 }}>
        <p className="type-deck-title">Eaton Fire</p>
        <p className="type-deck-lede mt-4 text-on-night-muted">January 7, 2025</p>
      </Show>
      <div className="absolute flex flex-col gap-5" style={CALL_ROWS}>
        <CallRow shown={calling} delay={0.9 / STORY_ANIMATION_PACE} time="6:03 am" />
        <CallRow shown={calling} delay={3.4 / STORY_ANIMATION_PACE} time="6:14 am" />
      </div>
    </>
  );
}
