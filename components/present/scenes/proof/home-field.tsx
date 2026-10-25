"use client";

import { motion } from "motion/react";
import { sceneMove } from "../../motion";

export const FIELD = { columns: 26, mark: 12, step: 15 } as const;

// Multiplying by a number that shares no factor with the total visits every home once in a scattered
// order, so the homes that got out are spread across the field rather than filling it row by row.
const SCATTER = 389;
const LIGHT_SECONDS = 1.6;

// One square per at-risk home. The homes that got out light up green, in a scattered order.
export function HomeField({ shown, homes, out }: { shown: boolean; homes: number; out: number }) {
  const rows = Math.ceil(homes / FIELD.columns);
  return (
    <motion.svg
      width={FIELD.columns * FIELD.step}
      height={rows * FIELD.step}
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 24 }}
      transition={sceneMove}
      aria-hidden
    >
      {Array.from({ length: homes }, (_, i) => {
        const order = (i * SCATTER) % homes;
        const lit = shown && order < out;
        return (
          <rect
            key={i}
            x={(i % FIELD.columns) * FIELD.step}
            y={Math.floor(i / FIELD.columns) * FIELD.step}
            width={FIELD.mark}
            height={FIELD.mark}
            rx={2}
            style={{
              fill: lit ? "var(--leaving)" : "oklch(0.72 0.01 70 / 0.18)",
              transition: "fill 0.5s",
              transitionDelay: lit ? `${0.8 + (order / Math.max(out, 1)) * LIGHT_SECONDS}s` : "0s",
            }}
          />
        );
      })}
    </motion.svg>
  );
}
