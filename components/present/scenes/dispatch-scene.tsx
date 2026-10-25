"use client";

import { Headset, PhoneIncoming } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { sceneMove } from "../motion";
import type { Beat } from "../script";
import { Show } from "../show";
import { Wordmark } from "../wordmark";

const DISPATCHERS = 4;
const SEAT = { size: 170, gap: 32, left: 128, top: 200 };
const WALL = { columns: 15, rows: 8, left: 640, top: 120, step: 72 };
const CALLS = WALL.columns * WALL.rows;
// Calls that spill out of the queue and land on top of the four seats once every line is taken.
const SPILL = 30;
const SPILL_AREA = { left: 100, top: 170, width: 420, height: 420 };
// The whole pile-up plays in under two seconds: seats pick up, the queue backs up from the seats
// toward the right edge, then the overflow buries the seats.
const PICK_UP_SECONDS = 0.15;
const QUEUE_SECONDS = 1.0;
const SPILL_START = 1.05;
const SPILL_SECONDS = 0.6;
const FLY_IN = 420;

const scatter = (i: number) => ((i + 1) * 0.618034) % 1;
const queueArrival = (i: number) => 0.2 + ((i % WALL.columns) / WALL.columns) * QUEUE_SECONDS + scatter(i) * 0.12;

function callLook(ringing: boolean, quiet: boolean) {
  if (ringing) return { opacity: 1, x: 0, scale: 1, color: "var(--signal)" };
  if (quiet) return { opacity: 0.06, x: 0, scale: 1, color: "var(--on-night-muted)" };
  return { opacity: 0, x: FLY_IN, scale: 0.6, color: "var(--signal)" };
}

type CallProps = { left: number; top: number; delay: number; rotate: number; size: number; ringing: boolean; quiet: boolean };

function Call({ left, top, delay, rotate, size, ringing, quiet }: CallProps) {
  return (
    <motion.span
      className="absolute"
      style={{ left, top, rotate }}
      initial={false}
      animate={callLook(ringing, quiet)}
      transition={{ ...sceneMove, duration: 0.55, delay: ringing ? delay : 0 }}
    >
      <PhoneIncoming size={size} weight="fill" className={ringing ? "animate-ringing" : undefined} />
    </motion.span>
  );
}

// The queue behind the four seats, filling from the seats outward so it reads as calls backing up.
function CallQueue({ ringing, quiet }: { ringing: boolean; quiet: boolean }) {
  return (
    <div className="absolute" style={{ left: WALL.left, top: WALL.top }} aria-hidden>
      {Array.from({ length: CALLS }, (_, i) => (
        <Call
          key={i}
          left={(i % WALL.columns) * WALL.step}
          top={Math.floor(i / WALL.columns) * WALL.step}
          delay={queueArrival(i)}
          rotate={0}
          size={44}
          ringing={ringing}
          quiet={quiet}
        />
      ))}
    </div>
  );
}

function Spill({ ringing, quiet }: { ringing: boolean; quiet: boolean }) {
  return (
    <div className="absolute" style={SPILL_AREA} aria-hidden>
      {Array.from({ length: SPILL }, (_, i) => (
        <Call
          key={i}
          left={scatter(i * 3) * SPILL_AREA.width}
          top={scatter(i * 7 + 1) * SPILL_AREA.height}
          delay={SPILL_START + scatter(i) * SPILL_SECONDS}
          rotate={(scatter(i * 5) - 0.5) * 50}
          size={60}
          ringing={ringing}
          quiet={quiet}
        />
      ))}
    </div>
  );
}

// Each seat picks up a call straight away: its headset rings red. Once the overflow lands, the seats sink.
function Seat({ index, swamped }: { index: number; swamped: boolean }) {
  return (
    <motion.span
      className="relative flex items-center justify-center rounded-full bg-night-raised text-on-night"
      style={{ width: SEAT.size, height: SEAT.size }}
      initial={false}
      animate={{ opacity: swamped ? [1, 1, 0.45] : 1 }}
      transition={{ duration: SPILL_START + SPILL_SECONDS, times: [0, 0.7, 1] }}
    >
      <motion.span
        className="absolute inset-0 rounded-full ring-4 ring-signal"
        initial={false}
        animate={{ opacity: swamped ? 1 : 0 }}
        transition={{ duration: 0.25, delay: swamped ? PICK_UP_SECONDS + index * 0.05 : 0 }}
      />
      <Headset size={84} weight="regular" aria-hidden />
    </motion.span>
  );
}

function Dispatchers({ shown }: { shown: boolean }) {
  return (
    <Show when={shown} rise={0} className="absolute grid grid-cols-2" style={{ left: SEAT.left, top: SEAT.top, gap: SEAT.gap }}>
      {Array.from({ length: DISPATCHERS }, (_, i) => (
        <Seat key={i} index={i} swamped={shown} />
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
      <CallQueue ringing={swamped} quiet={built} />
      <Spill ringing={swamped} quiet={false} />
      <Show when={swamped} delay={0.8} className="absolute" style={{ left: 128, top: 760, width: 1660 }}>
        <blockquote className="type-deck-quote">“We have four dispatchers that sit in the room, you can only answer so many calls.”</blockquote>
        <p className="type-deck-lede mt-6 text-on-night-muted">Ryan, firefighter at Palo Alto Fire Station 1</p>
      </Show>
      <Show when={built} delay={0.5} className="absolute inset-0 flex items-center justify-center">
        <Wordmark className="type-deck-display" stacked />
      </Show>
    </>
  );
}
