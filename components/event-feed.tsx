"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, ClipboardText, Faders, Phone, PhoneSlash, Van, type Icon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { formatClock } from "@/lib/time";
import { Section } from "./ui/section";

const KIND_ICONS: Record<Doc<"events">["kind"], Icon> = {
  call: Phone,
  record: ClipboardText,
  retry: PhoneSlash,
  model: Brain,
  dispatch: Van,
  control: Faders,
};

export function EventFeed({ className = "" }: { className?: string }) {
  const events = useQuery(api.events.recent, { limit: 30 });

  return (
    <Section title="Activity" className={className}>
      {events?.length === 0 ? (
        <p className="type-body px-4 py-10 text-center text-ink-muted">Records, retries and model updates appear here as they happen.</p>
      ) : (
        <ol className="flex max-h-[19.5rem] flex-col overflow-y-auto" aria-live="polite">
          <AnimatePresence initial={false}>
            {events?.map((event) => {
              const KindIcon = KIND_ICONS[event.kind];
              return (
                <motion.li
                  key={event._id}
                  layout
                  initial={{ opacity: 0, y: -10, backgroundColor: "var(--surface-sunk)" }}
                  animate={{ opacity: 1, y: 0, backgroundColor: "var(--surface)" }}
                  transition={{ type: "spring", stiffness: 260, damping: 28, backgroundColor: { duration: 1.2 } }}
                  className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-2.5 not-last:border-b not-last:border-line"
                >
                  <KindIcon weight={event.kind === "model" ? "fill" : "bold"} className="mt-0.5 size-4" />
                  <span className="type-small">{event.message}</span>
                  <span className="type-small text-ink-muted">{formatClock(event.at)}</span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </Section>
  );
}
