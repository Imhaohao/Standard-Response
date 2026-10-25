"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { Brain, CaretRight, ClipboardText, Faders, Phone, PhoneSlash, Van, type Icon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { formatClock } from "@/lib/time";
import { PanelEmpty } from "../ui/panel";

type Event = FunctionReturnType<typeof api.events.recent>[number];

const KIND_ICONS: Record<Doc<"events">["kind"], Icon> = {
  call: Phone,
  record: ClipboardText,
  retry: PhoneSlash,
  model: Brain,
  dispatch: Van,
  control: Faders,
};

const ROW = "grid w-full grid-cols-[1rem_minmax(0,1fr)_auto_1rem] items-start gap-2.5 border-b border-panel-raised px-3 py-2 text-left";

function EventRow({ event, selected, onOpenCall }: { event: Event; selected: boolean; onOpenCall: (id: Id<"calls">) => void }) {
  const KindIcon = KIND_ICONS[event.kind];
  const content = (
    <>
      <KindIcon weight={event.kind === "model" ? "fill" : "bold"} className="mt-0.5 size-4 text-on-panel-muted" />
      <span className="type-small">{event.message}</span>
      <span className="type-small text-on-panel-muted tabular-nums">{formatClock(event.at)}</span>
      {event.callId && <CaretRight weight="bold" className="mt-0.5 size-4 text-on-panel-muted" />}
    </>
  );
  const { callId } = event;
  if (!callId) return <div className={ROW}>{content}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpenCall(callId)}
      aria-pressed={selected}
      aria-label={`Open the call: ${event.message}`}
      className={`${ROW} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
        selected ? "bg-panel-raised shadow-[inset_3px_0_0_var(--on-panel)]" : "hover:bg-panel-raised/50"
      }`}
    >
      {content}
    </button>
  );
}

// Rows that came out of a call open that call's transcript, including calls that have ended.
export function ActivityList({ selectedCallId, onOpenCall }: { selectedCallId: Id<"calls"> | null; onOpenCall: (id: Id<"calls">) => void }) {
  const events = useQuery(api.events.recent, { limit: 40 });
  if (events?.length === 0) return <PanelEmpty>Records, retries and model updates land here as they happen.</PanelEmpty>;
  return (
    <ol className="flex flex-col" aria-live="polite">
      <AnimatePresence initial={false}>
        {events?.map((event) => (
          <motion.li
            key={event._id}
            layout
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            <EventRow event={event} selected={event.callId !== null && event.callId === selectedCallId} onOpenCall={onOpenCall} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
