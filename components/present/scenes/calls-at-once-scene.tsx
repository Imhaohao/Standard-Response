"use client";

import { animate } from "motion/react";
import { useEffect, useRef } from "react";
import type { Beat } from "../script";
import { Show } from "../show";
import { Wordmark } from "../wordmark";

const CALLS = 10_000;
const format = new Intl.NumberFormat("en-US");

// Counts up alongside the wave of calls crossing the map behind it.
function CountUp({ running }: { running: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!running) {
      node.textContent = format.format(0);
      return;
    }
    const controls = animate(0, CALLS, {
      duration: 3,
      delay: 0.6,
      ease: [0.2, 0, 0, 1],
      onUpdate: (value) => {
        node.textContent = format.format(Math.round(value));
      },
    });
    return () => controls.stop();
  }, [running]);
  return <span ref={ref}>{format.format(0)}</span>;
}

export function CallsAtOnceScene({ beat }: { beat: Beat }) {
  const shown = beat === "tenThousand";
  return (
    <>
      <Show
        when={shown}
        rise={0}
        className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_8%_100%,var(--night)_35%,transparent_75%)]"
      >
        <span />
      </Show>
      <Show when={shown} className="absolute" style={{ left: 128, top: 96 }}>
        <Wordmark className="type-deck-quote" />
      </Show>
      <Show when={shown} delay={0.3} className="absolute" style={{ left: 128, bottom: 110 }}>
        <p className="type-deck-figure">
          <CountUp running={shown} />
        </p>
        <p className="type-deck-lede mt-8">phone conversations at once</p>
      </Show>
    </>
  );
}
