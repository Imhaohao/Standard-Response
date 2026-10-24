"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { languageName } from "@/lib/labels";
import { formatCountdown, useNow } from "@/lib/time";
import { Section } from "./ui/section";

const QUEUE_LENGTH = 9;

export function CallQueue({ className = "" }: { className?: string }) {
  const queue = useQuery(api.households.queue, { limit: QUEUE_LENGTH });
  const now = useNow(15_000);

  return (
    <Section title="Next to call" className={className}>
      <p className="type-small border-b border-line px-4 py-2.5 text-ink-muted">
        Ranked by chance of needing help, divided by minutes until the fire arrives.
      </p>
      {queue?.length === 0 ? (
        <p className="type-body px-4 py-10 text-center text-ink-muted">Nobody is waiting to be called.</p>
      ) : (
        <ol className="relative flex flex-col">
          <AnimatePresence initial={false} mode="popLayout">
            {queue?.map((home, i) => (
              <motion.li
                key={home._id}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-2 px-4 py-2.5 not-last:border-b not-last:border-line"
              >
                <span className="type-figure text-lg text-ink-muted">{i + 1}</span>
                <span className="flex min-w-0 flex-col">
                  <span className="type-heading flex items-center gap-1.5 truncate">
                    {home.callStatus === "no_answer" && <ArrowClockwise weight="bold" className="size-3.5 shrink-0" aria-label="Retry" />}
                    <span className="truncate">{home.address}</span>
                  </span>
                  <span className="type-small text-ink-muted">
                    {languageName(home.language)}, fire in {formatCountdown(home.fireArrivalAt - now)}
                  </span>
                </span>
                <span className="flex flex-col items-end">
                  <motion.span key={home.needProbability.toFixed(2)} initial={{ scale: 1.25 }} animate={{ scale: 1 }} className="type-figure text-lg">
                    {Math.round(home.needProbability * 100)}%
                  </motion.span>
                  <span className="type-small text-ink-muted">need</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </Section>
  );
}
