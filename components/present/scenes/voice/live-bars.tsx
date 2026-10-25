"use client";

import { motion } from "motion/react";

const height = (bar: number, step: number) => 0.18 + (((bar * 7919 + step * 104729) % 997) / 997) * 0.82;

// A voice as a row of bars that rise and fall while someone is speaking and lie flat when nobody is.
export function LiveBars({ running, bars, className = "" }: { running: boolean; bars: number; className?: string }) {
  return (
    <div className={`flex items-center gap-[6px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, bar) => (
        <motion.span
          key={bar}
          className="h-full flex-1 origin-center rounded-full bg-current"
          initial={false}
          animate={{ scaleY: running ? [0, 1, 2, 3].map((step) => height(bar, step)) : 0.08, opacity: running ? 1 : 0.35 }}
          transition={running ? { duration: 1.1, repeat: Infinity, repeatType: "mirror", ease: "easeInOut", delay: (bar % 5) * 0.07 } : { duration: 0.4 }}
        />
      ))}
    </div>
  );
}
