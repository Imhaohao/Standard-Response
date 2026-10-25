"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

export const STAGE = { width: 1920, height: 1080 } as const;

const fitScale = () => Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height);

// Every slide is laid out on one 1920 by 1080 canvas, scaled to whatever screen the deck lands on.
export function Stage({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const update = () => setScale(fitScale());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-night">
      <div
        className="relative shrink-0 overflow-hidden bg-night text-on-night"
        style={{ width: STAGE.width, height: STAGE.height, transform: `scale(${scale})`, visibility: scale ? "visible" : "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}
