"use client";

import { Headset } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import type { Beat } from "../script";
import { Show } from "../show";
import { STAGE } from "../stage";
import { Wordmark } from "../wordmark";
import { CallPile, DRAINS, PILE } from "./dispatch/call-pile";

const AREA = { left: STAGE.width - PILE.columns * PILE.cell - 140, top: 50, width: PILE.columns * PILE.cell, height: PILE.rows * PILE.cell };
const SEAT = { size: 112, top: AREA.top + AREA.height + 22 };
const GRAIN = 3.6;
const PREFILL_TICKS = 600;

type SeatRings = React.RefObject<(HTMLSpanElement | null)[]>;

function drawPile(ctx: CanvasRenderingContext2D, pile: CallPile, colors: { call: string; floor: string }) {
  ctx.clearRect(0, 0, AREA.width, AREA.height + 4);
  ctx.fillStyle = colors.call;
  ctx.beginPath();
  for (let row = 0; row < PILE.rows; row++) {
    for (let column = 0; column < PILE.columns; column++) {
      if (!pile.grid[row * PILE.columns + column]) continue;
      const [x, y] = [column * PILE.cell + PILE.cell / 2, row * PILE.cell + PILE.cell / 2];
      ctx.moveTo(x + GRAIN, y);
      ctx.arc(x, y, GRAIN, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.fillStyle = colors.floor;
  let from = 0;
  for (const drain of [...DRAINS, PILE.columns]) {
    ctx.fillRect(from * PILE.cell, AREA.height, (drain - from) * PILE.cell, 3);
    from = drain + 1;
  }
}

function lightSeats(pile: CallPile, rings: SeatRings) {
  for (const [d, ring] of rings.current.entries()) if (ring) ring.style.opacity = pile.isAnswering(d) ? "1" : "0";
}

// Runs the pile while the beat is up. With reduced motion the pile starts already backed up and holds still.
function usePile(running: boolean, canvasRef: React.RefObject<HTMLCanvasElement | null>, rings: SeatRings) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !running) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = AREA.width * ratio;
    canvas.height = (AREA.height + 4) * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const colors = { call: css.getPropertyValue("--signal").trim(), floor: css.getPropertyValue("--on-night-muted").trim() };
    const pile = new CallPile();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) for (let i = 0; i < PREFILL_TICKS; i++) pile.step();
    let frame = 0;
    const tick = () => {
      if (!still) pile.step();
      drawPile(ctx, pile, colors);
      lightSeats(pile, rings);
      if (!still) frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [running, canvasRef, rings]);
}

// The four dispatchers sit under the four ways through; a seat's ring flashes red as it picks up a call.
function Seats({ shown, ringRef }: { shown: boolean; ringRef: (d: number) => (node: HTMLSpanElement | null) => void }) {
  return (
    <Show when={shown} rise={0} className="absolute inset-0">
      {DRAINS.map((column, d) => (
        <span
          key={column}
          className="absolute flex items-center justify-center rounded-full bg-night-raised text-on-night"
          style={{ left: AREA.left + column * PILE.cell + PILE.cell / 2 - SEAT.size / 2, top: SEAT.top, width: SEAT.size, height: SEAT.size }}
        >
          <span ref={ringRef(d)} className="absolute inset-0 rounded-full ring-4 ring-signal transition-opacity duration-150" style={{ opacity: 0 }} />
          <Headset size={56} weight="regular" aria-hidden />
        </span>
      ))}
    </Show>
  );
}

export function DispatchScene({ beat }: { beat: Beat }) {
  const swamped = beat === "dispatch";
  const built = beat === "built";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rings = useRef<(HTMLSpanElement | null)[]>([]);
  const ringRef = useCallback(
    (d: number) => (node: HTMLSpanElement | null) => {
      rings.current[d] = node;
    },
    [],
  );
  usePile(swamped || built, canvasRef, rings);
  return (
    <>
      <motion.canvas
        ref={canvasRef}
        className="pointer-events-none absolute"
        style={{ left: AREA.left, top: AREA.top, width: AREA.width, height: AREA.height + 4 }}
        initial={false}
        animate={{ opacity: swamped ? 1 : built ? 0.08 : 0 }}
        transition={{ duration: built ? 1.2 : 0.4 }}
        aria-hidden
      />
      <Seats shown={swamped} ringRef={ringRef} />
      <Show when={swamped} delay={0.8} className="absolute" style={{ left: 128, top: 300, width: AREA.left - 240 }}>
        <blockquote className="type-deck-quote">“We have four dispatchers that sit in the room, you can only answer so many calls.”</blockquote>
        <p className="type-deck-lede mt-6 text-on-night-muted">Ryan, firefighter at Palo Alto Fire Station 1</p>
      </Show>
      <Show when={built} delay={0.5} className="absolute inset-0 flex items-center justify-center">
        <Wordmark className="type-deck-display" stacked />
      </Show>
    </>
  );
}
