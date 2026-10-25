"use client";

import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Point } from "@/lib/ink-map/data";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";
import { quickFade } from "../motion";
import type { HouseState } from "./shots";

const DOT = 26;

// Pins the mark to its home from inside the renderer's view change, so it moves in the same frame
// the map is drawn. A React state update would land a frame later and slide across the map in a glide.
function usePinned(renderer: InkMapRenderer | null, center: Point) {
  const ref = useRef<HTMLDivElement>(null);
  const [x, y] = center;
  useEffect(() => {
    const node = ref.current;
    if (!renderer || !node) return;
    const place = () => {
      const at = renderer.project([x, y]);
      node.style.transform = `translate3d(${at.x}px, ${at.y}px, 0)`;
      node.style.visibility = at.visible ? "" : "hidden";
    };
    place();
    const stop = renderer.onViewChange(place);
    return () => {
      stop();
    };
  }, [renderer, x, y]);
  return ref;
}

// The deck's recurring mark: one home on the night map. Red while someone inside needs help,
// ringing while they call, and hollow once nobody is left to answer.
export function HouseMark({ renderer, center, state }: { renderer: InkMapRenderer | null; center: Point; state: HouseState }) {
  const ref = usePinned(renderer, center);
  if (!renderer) return null;
  const lit = state === "lit" || state === "calling";
  return (
    <motion.div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0"
      style={{ width: 0, height: 0 }}
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
