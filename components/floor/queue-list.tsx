"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { languageName } from "@/lib/labels";
import { formatCountdown, useNow } from "@/lib/time";
import { PanelEmpty } from "../ui/panel";

const QUEUE_LENGTH = 12;

// Ranked by chance of needing help, divided by minutes until the fire arrives. The first six carry
// the same numbers as the flags on the map.
export function QueueList() {
  const queue = useQuery(api.households.queue, { limit: QUEUE_LENGTH });
  const now = useNow(15_000);
  if (queue?.length === 0) return <PanelEmpty>Nobody is waiting to be called.</PanelEmpty>;
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false} mode="popLayout">
        {queue?.map((home, index) => (
          <motion.li
            key={home._id}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.15 } }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-panel-raised px-3 py-2"
          >
            <span className={`type-figure grid size-6 place-items-center text-sm ${index < 6 ? "bg-on-panel text-panel" : "text-on-panel-muted"}`}>{index + 1}</span>
            <span className="flex min-w-0 flex-col">
              <span className="type-small flex items-center gap-1.5 font-bold">
                {home.callStatus === "no_answer" && <ArrowClockwise weight="bold" className="size-3.5 shrink-0" aria-label="Redial" />}
                <span className="truncate">{home.address}</span>
              </span>
              <span className="type-small text-on-panel-muted">
                {languageName(home.language)}, fire in {formatCountdown(home.fireArrivalAt - now)}
              </span>
            </span>
            <span className="flex items-center gap-2" aria-label={`${Math.round(home.needProbability * 100)}% chance they need help`}>
              <span className="h-1.5 w-12 bg-panel-raised" aria-hidden>
                <span className="block h-full bg-on-panel" style={{ width: `${home.needProbability * 100}%` }} />
              </span>
              <span className="type-small w-8 text-right font-bold tabular-nums">{Math.round(home.needProbability * 100)}%</span>
            </span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
