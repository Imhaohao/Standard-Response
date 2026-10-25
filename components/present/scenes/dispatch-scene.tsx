"use client";

import { Headset, PhoneIncoming } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { sceneMove } from "../motion";
import type { Beat } from "../script";
import { Show } from "../show";
import { Wordmark } from "../wordmark";

const DISPATCHERS = 4;
const WALL = { columns: 15, rows: 8, left: 700, top: 120, step: 72 };
const CALLS = WALL.columns * WALL.rows;
// The wall fills in a scattered order, so it reads as calls piling up. Golden-ratio steps spread the
// arrivals evenly with no call landing at zero.
const FILL_SECONDS = 1.6;
const arrival = (i: number) => (((i + 1) * 0.618034) % 1) * FILL_SECONDS;

function CallWall({ ringing, quiet }: { ringing: boolean; quiet: boolean }) {
  return (
    <div className="absolute" style={{ left: WALL.left, top: WALL.top }} aria-hidden>
      {Array.from({ length: CALLS }, (_, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{ left: (i % WALL.columns) * WALL.step, top: Math.floor(i / WALL.columns) * WALL.step }}
          initial={false}
          animate={{ opacity: ringing ? 1 : quiet ? 0.06 : 0, scale: ringing || quiet ? 1 : 0.4, color: quiet ? "var(--on-night-muted)" : "var(--signal)" }}
          transition={{ ...sceneMove, duration: 0.6, delay: ringing ? 0.2 + arrival(i) : 0 }}
        >
          <PhoneIncoming size={44} weight="fill" className={ringing ? "animate-ringing" : undefined} />
        </motion.span>
      ))}
    </div>
  );
}

function Dispatchers({ shown }: { shown: boolean }) {
  return (
    <Show when={shown} className="absolute grid grid-cols-2 gap-8" style={{ left: 128, top: 200 }}>
      {Array.from({ length: DISPATCHERS }, (_, i) => (
        <span key={i} className="flex size-[170px] items-center justify-center rounded-full bg-night-raised text-on-night">
          <Headset size={84} weight="regular" aria-hidden />
        </span>
      ))}
    </Show>
  );
}

export function DispatchScene({ beat }: { beat: Beat }) {
  const swamped = beat === "dispatch";
  const built = beat === "built";
  return (
    <>
      <Dispatchers shown={swamped} />
      <CallWall ringing={swamped} quiet={built} />
      <Show when={swamped} delay={0.8} className="absolute" style={{ left: 128, top: 790, width: 1660 }}>
        <blockquote className="type-deck-quote">“We have four dispatchers that sit in the room, you can only answer so many calls.”</blockquote>
      </Show>
      <Show when={built} delay={0.5} className="absolute inset-0 flex items-center justify-center">
        <Wordmark className="type-deck-display" stacked />
      </Show>
    </>
  );
}
