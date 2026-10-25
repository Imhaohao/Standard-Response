"use client";

import { motion } from "motion/react";
import { sceneMove } from "../../motion";

const FIELD = { columns: 38, stepX: 22, stepY: 25, width: 16, height: 22 } as const;

// Multiplying by a number that shares no factor with the total visits every household once in a
// scattered order, so the ones that got out are spread across the crowd rather than filling it row by row.
const SCATTER = 389;
const LIGHT_SECONDS = 1.6;
const DIM = "oklch(0.72 0.01 70 / 0.2)";

// A small standing figure on a 14 by 20 box: a head and a pair of shoulders.
function PersonShape() {
  return (
    <symbol id="proof-person" viewBox="0 0 14 20">
      <circle cx="7" cy="4" r="3.6" />
      <path d="M1,20 C1,12.5 3.8,9.8 7,9.8 C10.2,9.8 13,12.5 13,20 Z" />
    </symbol>
  );
}

// One figure per at-risk household. The ones that got out in time light up green, in a scattered order.
export function PeopleField({ shown, households, out }: { shown: boolean; households: number; out: number }) {
  const rows = Math.ceil(households / FIELD.columns);
  return (
    <motion.svg
      width={FIELD.columns * FIELD.stepX}
      height={rows * FIELD.stepY}
      initial={false}
      animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 24 }}
      transition={sceneMove}
      aria-hidden
    >
      <defs>
        <PersonShape />
      </defs>
      {Array.from({ length: households }, (_, i) => {
        const order = (i * SCATTER) % households;
        const lit = shown && order < out;
        return (
          <use
            key={i}
            href="#proof-person"
            x={(i % FIELD.columns) * FIELD.stepX}
            y={Math.floor(i / FIELD.columns) * FIELD.stepY}
            width={FIELD.width}
            height={FIELD.height}
            style={{
              fill: lit ? "var(--leaving)" : DIM,
              transition: "fill 0.5s",
              transitionDelay: lit ? `${0.8 + (order / Math.max(out, 1)) * LIGHT_SECONDS}s` : "0s",
            }}
          />
        );
      })}
    </motion.svg>
  );
}
