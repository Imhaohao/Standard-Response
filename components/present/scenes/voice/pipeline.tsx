"use client";

import { Check } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { sceneMove } from "../../motion";
import { Show } from "../../show";
import { LiveBars } from "./live-bars";

export const NODE = { x: 220, y: 430, size: 180 };
export const INK = { left: 470, top: 330, width: 340, height: 200 };
export const CLAUDE = { left: 890, top: 290, width: 380, height: 280 };
export const SONIC = { left: 1350, top: 330, width: 340, height: 200 };
export const RETURN_Y = 760;

export function Block({ box, maker, name, shown, children }: { box: typeof INK; maker: string; name: string; shown: boolean; children?: ReactNode }) {
  return (
    <Show when={shown} className="absolute" style={box}>
      <div className="flex size-full flex-col justify-center gap-1 rounded-[40px] bg-night-raised px-10 shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
        <p className="type-deck-note text-on-night-muted">{maker}</p>
        <p className="type-deck-quote">{name}</p>
        {children}
      </div>
    </Show>
  );
}

const INTO_INK = `M310 ${NODE.y} H${INK.left}`;
const ON_TO_SONIC = `M${INK.left + INK.width} ${NODE.y} H${SONIC.left}`;
const BACK = `M${SONIC.left + SONIC.width / 2} ${SONIC.top + SONIC.height} V${RETURN_Y} H${NODE.x} V${NODE.y + NODE.size / 2 + 70}`;

function FlowPath({ d, shown }: { d: string; shown: boolean }) {
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="var(--on-night-muted)"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="10 14"
      className="animate-dash-flow"
      initial={false}
      animate={{ opacity: shown ? 0.7 : 0 }}
      transition={sceneMove}
    />
  );
}

// The lines a voice travels: Roseland to Ink and on to Sonic, then back around to her phone.
export function Flows({ hearing, speaking }: { hearing: boolean; speaking: boolean }) {
  return (
    <svg width={1920} height={1080} className="absolute inset-0" aria-hidden>
      <FlowPath d={INTO_INK} shown={hearing} />
      <FlowPath d={ON_TO_SONIC} shown={speaking} />
      <FlowPath d={BACK} shown={speaking} />
    </svg>
  );
}

const HEARD = `M310 ${NODE.y} H${INK.left + INK.width / 2}`;
const ROUND_TRIP = `M310 ${NODE.y} H${SONIC.left + SONIC.width / 2} V${RETURN_Y} H${NODE.x} V${NODE.y + NODE.size / 2 + 70}`;

// One turn of the call travelling the line: into Ink only, or all the way round once Sonic answers.
// It is drawn under the blocks, so it passes through each one.
export function Pulse({ turn, roundTrip, durationMs }: { turn: number; roundTrip: boolean; durationMs: number }) {
  return (
    <motion.span
      key={turn}
      className="absolute top-0 left-0 size-6 rounded-full bg-on-night shadow-[0_0_24px_8px_oklch(0.95_0.006_85/0.35)]"
      style={{ offsetPath: `path("${roundTrip ? ROUND_TRIP : HEARD}")`, offsetRotate: "0deg" }}
      initial={{ offsetDistance: "0%", opacity: 0 }}
      animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
      transition={{ duration: (durationMs / 1000) * 0.9, ease: [0.4, 0, 0.2, 1], opacity: { times: [0, 0.08, 0.85, 1], duration: (durationMs / 1000) * 0.9 } }}
      aria-hidden
    />
  );
}

export function Caller({ shown, speaking }: { shown: boolean; speaking: boolean }) {
  return (
    <Show when={shown} className="absolute flex flex-col items-center gap-6" style={{ left: NODE.x - NODE.size / 2, top: NODE.y - NODE.size / 2, width: NODE.size }}>
      <span className="type-deck-quote flex size-[180px] items-center justify-center rounded-full bg-night-raised">R</span>
      <LiveBars running={speaking} bars={9} className="h-14 w-full text-on-night" />
    </Show>
  );
}

// Haiku answers every turn; Opus grades each whole call afterwards, so it lights after the reply.
export function ModelRow({ name, role, lit, check = false }: { name: string; role: string; lit: boolean; check?: boolean }) {
  return (
    <div className="flex items-center gap-4">
      <motion.span
        className="flex size-10 items-center justify-center rounded-full text-night"
        initial={false}
        animate={{ backgroundColor: lit ? "var(--on-night)" : "var(--night)", scale: lit ? 1 : 0.8 }}
        transition={{ duration: 0.35 }}
      >
        {check && <Check size={24} weight="bold" aria-hidden />}
      </motion.span>
      <span className="type-deck-label">{name}</span>
      <span className="type-deck-note ml-auto text-on-night-muted">{role}</span>
    </div>
  );
}
