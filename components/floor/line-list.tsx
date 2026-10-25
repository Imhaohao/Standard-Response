"use client";

import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { Phone, PhoneCall, PhoneIncoming, PhoneOutgoing } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { flowLabel, languageName, STAGES, stageIndex } from "@/lib/labels";
import { formatElapsed } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { Waveform } from "../ui/waveform";

export type ActiveCall = FunctionReturnType<typeof api.calls.active>[number];

const SPEAKING_WINDOW_MS = 2600;

function CallIcon({ call }: { call: ActiveCall }) {
  if (call.phase === "ringing") return <PhoneCall weight="fill" className="animate-ringing size-5 text-on-panel-muted" />;
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  return <Icon weight="bold" className="size-5" />;
}

function LanguageChip({ language }: { language: string }) {
  if (language === "en") return null;
  return (
    <span title={languageName(language)} className="type-small shrink-0 rounded bg-panel-raised px-1.5 font-bold uppercase">
      {language}
    </span>
  );
}

function LineRow({ call, selected, onSelect, now }: { call: ActiveCall; selected: boolean; onSelect: () => void; now: number }) {
  const speaking = call.phase === "live" && call.lastLine !== null && now - call.lastLine.at < SPEAKING_WINDOW_MS;
  const stageLabel = call.phase === "ringing" ? "Ringing" : call.flow ? flowLabel(call.flow) : STAGES[stageIndex(call.stage)].label;
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
        className={`flex h-12 w-full items-center gap-2 border-b border-panel-raised px-3 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
          selected ? "bg-panel-raised shadow-[inset_3px_0_0_var(--on-panel)]" : "hover:bg-panel-raised/50"
        }`}
      >
        <CallIcon call={call} />
        <span className="type-small min-w-0 flex-1 truncate font-bold">{call.address}</span>
        <LanguageChip language={call.language} />
        <span className="type-small shrink-0 bg-panel-raised px-1.5 ring-1 ring-inset ring-on-panel/15 font-semibold">{stageLabel}</span>
        <span className="block h-4 w-14 shrink-0 overflow-hidden">
          <span className="block origin-top-left scale-50">
            <Waveform active={speaking} speaker={call.lastLine?.speaker ?? null} />
          </span>
        </span>
        <span className="type-small w-10 shrink-0 text-right font-semibold tabular-nums">{formatElapsed(now - call.startedAt)}</span>
      </button>
    </motion.li>
  );
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-8 text-center" role="status">
      <Phone weight="bold" className="size-8 text-on-panel-muted" aria-hidden />
      <p className="type-heading">Nobody is on a call right now</p>
      <p className="type-small text-pretty text-on-panel-muted">Each call shows up here as it rings. Pick one to listen in.</p>
    </div>
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
  const now = useSimNow(500);
  if (calls.length === 0) return <Empty />;
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
