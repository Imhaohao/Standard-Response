"use client";

import { Headset } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import type { Beat } from "../script";
import { Show } from "../show";
import { STAGE, stageCanvasRatio } from "../stage";
import { Wordmark } from "../wordmark";
import { AREA as ROOM, CALL_RADIUS, CallTubes, TUBE, tubeCenter, type Call } from "./dispatch/call-tubes";

const AREA = { left: STAGE.width - ROOM.width - 140, top: 0, ...ROOM };
const SEAT = { size: 112, top: AREA.top + AREA.height + 22 };
// With reduced motion the room is shown this far into the beat, already backed up, and holds still.
const STILL_SECONDS = 10;
const MAX_STEP = 0.05;

type SeatRings = React.RefObject<(HTMLSpanElement | null)[]>;
type Colors = { call: string; tube: string };

function drawCall(ctx: CanvasRenderingContext2D, call: Call) {
  ctx.globalAlpha = call.alpha;
  ctx.beginPath();
  ctx.arc(call.x, call.y, CALL_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

// How strongly a full tube glows red behind the calls packed into it.
const FULL_TUBE_RED = 0.4;

function tubePath(ctx: CanvasRenderingContext2D, tube: number) {
  ctx.beginPath();
  ctx.roundRect(tubeCenter(tube) - TUBE.width / 2, TUBE.top, TUBE.width, TUBE.bottom - TUBE.top + 4, TUBE.width / 2);
}

function drawTubes(ctx: CanvasRenderingContext2D, room: CallTubes, colors: Colors) {
  for (const [tube, line] of room.lines.entries()) {
    tubePath(ctx, tube);
    ctx.fillStyle = colors.tube;
    ctx.fill();
    ctx.globalAlpha = line.red * FULL_TUBE_RED;
    ctx.fillStyle = colors.call;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawRoom(ctx: CanvasRenderingContext2D, room: CallTubes, colors: Colors) {
  ctx.clearRect(0, 0, AREA.width, AREA.height);
  drawTubes(ctx, room, colors);
  ctx.fillStyle = colors.call;
  for (const line of room.lines) {
    if (line.answering) drawCall(ctx, line.answering);
    for (const call of line.waiting) drawCall(ctx, call);
  }
  for (const column of room.columns) for (const call of column.calls) drawCall(ctx, call);
  ctx.globalAlpha = 1;
}

function lightSeats(room: CallTubes, rings: SeatRings) {
  for (const [d, ring] of rings.current.entries()) if (ring) ring.style.opacity = room.isAnswering(d) ? "1" : "0";
}

function readColors(): Colors {
  const css = getComputedStyle(document.documentElement);
  return { call: css.getPropertyValue("--signal").trim(), tube: css.getPropertyValue("--night-raised").trim() };
}

// Runs the room while the beat is up. With reduced motion it starts already backed up and holds still.
function useRoom(running: boolean, canvasRef: React.RefObject<HTMLCanvasElement | null>, rings: SeatRings) {
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !running) return;
    const ratio = stageCanvasRatio();
    canvas.width = AREA.width * ratio;
    canvas.height = AREA.height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const colors = readColors();
    const room = new CallTubes();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      while (room.seconds < STILL_SECONDS) room.step(1 / 60);
      drawRoom(ctx, room, colors);
      return;
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      room.step(Math.min(MAX_STEP, (now - last) / 1000));
      last = now;
      drawRoom(ctx, room, colors);
      lightSeats(room, rings);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, canvasRef, rings]);
}

// The four dispatchers sit under their four lines; a seat's ring flashes red as it picks up a call.
function Seats({ shown, ringRef }: { shown: boolean; ringRef: (d: number) => (node: HTMLSpanElement | null) => void }) {
  return (
    <Show when={shown} rise={0} className="absolute inset-0">
      {Array.from({ length: TUBE.count }, (_, d) => (
        <span
          key={d}
          className="absolute flex items-center justify-center rounded-full bg-night-raised text-on-night"
          style={{ left: AREA.left + tubeCenter(d) - SEAT.size / 2, top: SEAT.top, width: SEAT.size, height: SEAT.size }}
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
  useRoom(swamped || built, canvasRef, rings);
  return (
    <>
      <motion.canvas
        ref={canvasRef}
        className="pointer-events-none absolute"
        style={{ left: AREA.left, top: AREA.top, width: AREA.width, height: AREA.height }}
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
