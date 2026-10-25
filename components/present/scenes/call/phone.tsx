"use client";

import { Waveform } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { BrandMark } from "@/components/ui/brand-mark";
import { PRODUCT_NAME } from "@/lib/brand";
import { sceneMove } from "../../motion";
import { Photo } from "../../photo";
import { LiveBars } from "../voice/live-bars";
import type { CallTurn } from "./roseland-call";

export const PHONE = { left: 960, top: 90, width: 500, height: 900 };
const SHOWN_TURNS = 3;

// Rings leave the avatar while the phone is still ringing on Roseland's end.
function Ringing() {
  return (
    <svg className="absolute top-1/2 left-1/2 overflow-visible" width={0} height={0} aria-hidden>
      {[0, 0.6, 1.2].map((delay) => (
        <circle key={delay} r={60} fill="none" stroke="var(--on-night)" strokeWidth={3} className="animate-ring-out" style={{ animationDelay: `${delay}s` }} />
      ))}
    </svg>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

function AgentTurn({ text }: { text: string }) {
  return (
    <div className="rounded-3xl bg-on-night/10 px-6 py-5">
      <p className="type-deck-note flex items-center gap-2 text-on-night-muted">
        <BrandMark className="size-6" />
        {PRODUCT_NAME}
      </p>
      <p className="type-deck-label mt-2 font-normal">{text}</p>
    </div>
  );
}

function ResidentTurn({ name, text }: { name: string; text: string }) {
  return (
    <div className="px-6">
      <p className="type-deck-note text-on-night-muted">{name}</p>
      <p className="type-deck-label mt-1 font-normal">{text}</p>
    </div>
  );
}

function TranscriptSlot({ file }: { file: string }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl bg-on-night/5 px-8 text-center text-on-night-muted">
      <div className="hatch absolute inset-0 opacity-[0.07]" aria-hidden />
      <Waveform size={72} weight="light" aria-hidden />
      <p className="type-deck-label relative">Roseland’s test call</p>
      <p className="type-deck-note relative break-all font-mono">{file}</p>
    </div>
  );
}

function Transcript({ turns, name, seconds }: { turns: CallTurn[]; name: string; seconds: number }) {
  const heard = turns.filter((turn) => turn.atSeconds <= seconds).slice(-SHOWN_TURNS);
  return (
    <div className="flex flex-1 flex-col justify-end gap-6 overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%)]">
      <AnimatePresence initial={false}>
        {heard.map((turn) => (
          <motion.div key={`${turn.atSeconds}-${turn.speaker}`} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={sceneMove}>
            {turn.speaker === "agent" ? <AgentTurn text={turn.text} /> : <ResidentTurn name={name} text={turn.text} />}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type PhoneProps = { name: string; live: boolean; seconds: number; turns: CallTurn[]; file: string };

// Our side of the call: who we're talking to, how long the call has run, and what each side said.
export function Phone({ name, live, seconds, turns, file }: PhoneProps) {
  return (
    <div className="flex size-full flex-col rounded-[72px] bg-black p-4 shadow-[0_40px_120px_oklch(0_0_0/0.6)] ring-1 ring-white/10">
      <div className="flex flex-1 flex-col gap-8 overflow-hidden rounded-[58px] bg-night px-6 pt-16 pb-8">
        {!live && <div className="flex-1" />}
        <motion.header layout transition={sceneMove} className="flex flex-col items-center gap-4">
          <span className="relative flex size-[120px] items-center justify-center rounded-full bg-night-raised type-deck-quote">
            {!live && <Ringing />}
            <span className="absolute inset-0 overflow-hidden rounded-full">
              <Photo name="roseland" compact />
            </span>
          </span>
          <p className="type-deck-quote">{name}</p>
          <p className="type-deck-label font-normal text-on-night-muted tabular-nums">{live ? clock(seconds) : "Calling…"}</p>
        </motion.header>
        {live && (turns.length ? <Transcript turns={turns} name={name} seconds={seconds} /> : <TranscriptSlot file={file} />)}
        {!live && <div className="flex-1" />}
        <LiveBars running={live} className="h-16 text-on-night" bars={28} />
      </div>
    </div>
  );
}
