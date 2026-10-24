"use client";

import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { Headphones, PhoneCall, PhoneIncoming, PhoneOutgoing } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { languageName, STAGES, stageIndex } from "@/lib/labels";
import { formatElapsed, useNow } from "@/lib/time";
import { PanelEmpty } from "../ui/panel";
import { StageTrack } from "../ui/stage-track";
import { Waveform } from "../ui/waveform";

export type ActiveCall = FunctionReturnType<typeof api.calls.active>[number];

const SPEAKING_WINDOW_MS = 2600;

function CallIcon({ call }: { call: ActiveCall }) {
  if (call.phase === "ringing") return <PhoneCall weight="fill" className="animate-ringing size-5 text-on-panel-muted" />;
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  return <Icon weight="bold" className="size-5" />;
}

function callNote(call: ActiveCall) {
  if (call.direction === "inbound") return `${languageName(call.language)}, called in`;
  return call.attempt > 1 ? `${languageName(call.language)}, try ${call.attempt}` : languageName(call.language);
}

function LineRow({ call, selected, onSelect, now }: { call: ActiveCall; selected: boolean; onSelect: () => void; now: number }) {
  const speaking = call.phase === "live" && call.lastLine !== null && now - call.lastLine.at < SPEAKING_WINDOW_MS;
  const stageLabel = call.phase === "ringing" ? "Ringing" : STAGES[stageIndex(call.stage)].label;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4, transition: { duration: 0.15 } }}
      transition={{ type: "spring", duration: 0.35, bounce: 0 }}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`flex w-full flex-col gap-2 border-b border-panel-raised px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
          selected ? "bg-panel-raised shadow-[inset_3px_0_0_var(--on-panel)]" : "hover:bg-panel-raised/50"
        }`}
      >
        <span className="flex items-center gap-2.5">
          <CallIcon call={call} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="type-small truncate font-bold">{call.address}</span>
            <span className="type-small text-on-panel-muted">{callNote(call)}</span>
          </span>
          {selected && <Headphones weight="fill" className="size-4 shrink-0" aria-label="Listening" />}
          <span className="type-small shrink-0 font-semibold tabular-nums">{formatElapsed(now - call.startedAt)}</span>
        </span>
        <span className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="flex flex-col gap-1">
            <StageTrack stage={call.stage} live={call.phase === "live"} />
            <span className="type-small text-on-panel-muted">{stageLabel}</span>
          </span>
          <span className="shrink-0">
            <Waveform active={speaking} speaker={call.lastLine?.speaker ?? null} />
          </span>
        </span>
      </button>
    </motion.li>
  );
}

export function LineList({
  calls,
  selectedId,
  onSelect,
}: {
  calls: ActiveCall[];
  selectedId: Id<"calls"> | null;
  onSelect: (id: Id<"calls">) => void;
}) {
  const now = useNow(500);
  if (calls.length === 0) return <PanelEmpty>Every line is free. The dialer picks the next home within a second.</PanelEmpty>;
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false} mode="popLayout">
        {calls.map((call) => (
          <LineRow key={call._id} call={call} now={now} selected={call._id === selectedId} onSelect={() => onSelect(call._id)} />
        ))}
      </AnimatePresence>
    </ol>
  );
}
