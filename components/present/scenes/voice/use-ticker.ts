"use client";

import { useEffect, useState } from "react";

// Counts up once per period while running, and goes back to 0 when stopped.
export function useTicker(running: boolean, periodMs: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), periodMs);
    return () => {
      window.clearInterval(timer);
      setTick(0);
    };
  }, [running, periodMs]);
  return tick;
}
