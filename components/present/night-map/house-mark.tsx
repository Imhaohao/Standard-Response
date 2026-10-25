"use client";

import { motion } from "motion/react";
import type { ScreenPoint } from "@/lib/ink-map/renderer";
import { quickFade } from "../motion";
import type { HouseState } from "./shots";

const DOT = 26;

// The deck's recurring mark: one home on the night map. Red while someone inside needs help,
// ringing while they call, and hollow once nobody is left to answer.
export function HouseMark({ at, state }: { at: ScreenPoint | null; state: HouseState }) {
  if (!at) return null;
  const lit = state === "lit" || state === "calling";
  return (
    <motion.div
      className="pointer-events-none absolute"
      style={{ left: at.x, top: at.y, width: 0, height: 0 }}
      initial={false}
      animate={{ opacity: state === "hidden" ? 0 : 1 }}
      transition={quickFade}
      aria-hidden
    >
      {state === "calling" && <Ripples />}
      <motion.span
        className="absolute rounded-full"
        style={{ width: DOT, height: DOT, left: -DOT / 2, top: -DOT / 2 }}
        initial={false}
        animate={
          lit
            ? { backgroundColor: "var(--signal)", boxShadow: "0 0 0 4px var(--night), 0 0 36px 10px oklch(0.585 0.215 27 / 0.55)" }
            : { backgroundColor: "var(--night)", boxShadow: "0 0 0 4px var(--on-night-muted), 0 0 0 0 oklch(0.585 0.215 27 / 0)" }
        }
        transition={{ duration: 1.4, ease: [0.2, 0, 0, 1] }}
      />
    </motion.div>
  );
}

// A call going out: rings that leave the house and fade before they reach anyone.
function Ripples() {
  return (
    <svg className="absolute overflow-visible" width={0} height={0}>
      {[0, 0.6, 1.2].map((delay) => (
        <circle key={delay} r={DOT / 2} fill="none" stroke="var(--signal)" strokeWidth={2.5} className="animate-ring-out" style={{ animationDelay: `${delay}s` }} />
      ))}
    </svg>
  );
}
