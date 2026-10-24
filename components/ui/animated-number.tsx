"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";

export function AnimatedNumber({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const motionValue = useMotionValue(value);
  const display = useTransform(motionValue, (v) => v.toFixed(decimals));

  useEffect(() => {
    const controls = animate(motionValue, value, { type: "spring", stiffness: 90, damping: 20 });
    return () => controls.stop();
  }, [motionValue, value]);

  return <motion.span className={className}>{display}</motion.span>;
}
