"use client";

import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import { sceneMove } from "./motion";

type ShowProps = {
  when: boolean;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  delay?: number;
  rise?: number;
};

// Fades a piece of a slide in on its beat and out again, rising a little as it arrives.
export function Show({ when, children, className, style, delay = 0, rise = 24 }: ShowProps) {
  return (
    <motion.div
      className={className}
      style={{ ...style, pointerEvents: "none" }}
      initial={false}
      animate={when ? { opacity: 1, y: 0 } : { opacity: 0, y: rise }}
      transition={{ ...sceneMove, delay: when ? delay : 0 }}
      aria-hidden={!when}
    >
      {children}
    </motion.div>
  );
}
