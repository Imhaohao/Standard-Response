"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, ClipboardText, Faders, Phone, PhoneSlash, Van, type Icon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { formatClock } from "@/lib/time";
import { PanelEmpty } from "../ui/panel";

const KIND_ICONS: Record<Doc<"events">["kind"], Icon> = {
  call: Phone,
  record: ClipboardText,
  retry: PhoneSlash,
  model: Brain,
  dispatch: Van,
  control: Faders,
};

export function ActivityList() {
  const events = useQuery(api.events.recent, { limit: 40 });
  if (events?.length === 0) return <PanelEmpty>Records, retries and model updates land here as they happen.</PanelEmpty>;
  return (
    <ol className="flex flex-col" aria-live="polite">
      <AnimatePresence initial={false}>
        {events?.map((event) => {
          const KindIcon = KIND_ICONS[event.kind];
          return (
            <motion.li
              key={event._id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.35, bounce: 0 }}
              className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-2.5 border-b border-panel-raised px-3 py-2"
            >
              <KindIcon weight={event.kind === "model" ? "fill" : "bold"} className="mt-0.5 size-4 text-on-panel-muted" />
              <span className="type-small">{event.message}</span>
              <span className="type-small text-on-panel-muted tabular-nums">{formatClock(event.at)}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
