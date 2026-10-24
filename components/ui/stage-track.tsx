"use client";

import { AnimatePresence, motion } from "motion/react";
import { STAGES, Stage, stageIndex } from "@/lib/labels";

// Seven segments, one per step of the conversation state machine.
export function StageTrack({ stage, live, showLabel = false }: { stage: Stage; live: boolean; showLabel?: boolean }) {
  const current = live ? stageIndex(stage) : -1;
  const currentLabel = current >= 0 ? STAGES[current].label : "Not connected";
  return (
    <div className="flex flex-col gap-2">
      <ol className="grid grid-cols-7 gap-1" aria-label={`Conversation step: ${currentLabel}`}>
        {STAGES.map((s, i) => (
          <li key={s.key} className="relative block h-1 overflow-hidden bg-line">
            <motion.span
              className="absolute inset-0 origin-left bg-ink"
              initial={false}
              animate={{ scaleX: i < current ? 1 : i === current ? 0.55 : 0 }}
              transition={{ type: "spring", stiffness: 140, damping: 22 }}
            />
            {i === current && <span className="animate-sweep absolute inset-0 bg-gradient-to-r from-transparent via-surface/70 to-transparent" />}
          </li>
        ))}
      </ol>
      {showLabel && (
        <p className="type-small flex gap-1.5 text-ink-muted">
          {current >= 0 && <span>Step {current + 1} of 7</span>}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={currentLabel}
              className="font-semibold text-ink"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
            >
              {currentLabel}
            </motion.span>
          </AnimatePresence>
        </p>
      )}
    </div>
  );
}
