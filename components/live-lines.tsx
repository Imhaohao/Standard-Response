"use client";

import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { Headphones, PhoneCall, PhoneIncoming, PhoneOutgoing } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { languageName, STAGES, stageIndex } from "@/lib/labels";
import { formatElapsed, useNow } from "@/lib/time";
import { Section } from "./ui/section";
import { StageTrack } from "./ui/stage-track";
import { Waveform } from "./ui/waveform";

type ActiveCall = FunctionReturnType<typeof api.calls.active>[number];

const SPEAKING_WINDOW_MS = 2600;

function CallIcon({ call }: { call: ActiveCall }) {
  if (call.phase === "ringing") return <PhoneCall weight="fill" className="animate-ringing size-5 text-ink-muted" />;
  const Icon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  return <Icon weight="bold" className="size-5" />;
}

function RevealedLine({ text, lineKey }: { text: string; lineKey: number }) {
  const words = text.split(" ");
  return (
    <span key={lineKey}>
      {words.map((word, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: "blur(3px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.25, delay: i * 0.035 }}
        >
          {word}{" "}
        </motion.span>
      ))}
    </span>
  );
}

function emptyLineText(call: ActiveCall) {
  if (call.phase === "live") return "Connected. The agent is about to speak.";
  return call.direction === "inbound" ? "A resident is calling the alert number." : "Waiting for the resident to pick up.";
}

function LineCard({ call, selected, onSelect, now }: { call: ActiveCall; selected: boolean; onSelect: () => void; now: number }) {
  const speaking = call.phase === "live" && call.lastLine !== null && now - call.lastLine.at < SPEAKING_WINDOW_MS;
  const stageLabel = call.phase === "ringing" ? "Ringing" : STAGES[stageIndex(call.stage)].label;

  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative flex min-h-[13.5rem] flex-col gap-3 p-4 text-left transition-[background-color,box-shadow] duration-150 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal ${
        selected ? "z-[1] bg-surface shadow-[inset_0_0_0_2px_var(--ink)]" : "bg-surface hover:bg-surface-sunk"
      }`}
    >
      <div className="flex items-start gap-3">
        <CallIcon call={call} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="type-heading truncate">{call.address}</span>
          <span className="type-small text-ink-muted">
            {languageName(call.language)}
            {call.direction === "inbound" ? ", called in" : call.attempt > 1 ? `, attempt ${call.attempt}` : ""}
          </span>
        </div>
        <span className="type-small font-semibold">{formatElapsed(now - call.startedAt)}</span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Waveform active={speaking} speaker={call.lastLine?.speaker ?? null} />
        <span className="type-small flex items-center gap-1.5 font-semibold">
          {selected && <Headphones weight="fill" className="size-4" aria-label="Listening" />}
          {stageLabel}
        </span>
      </div>

      <StageTrack stage={call.stage} live={call.phase === "live"} />

      <p className="type-small line-clamp-3 min-h-[3.4em] text-ink-muted">
        {call.lastLine ? (
          <>
            <span className="font-semibold text-ink">{call.lastLine.speaker === "agent" ? "Agent" : "Resident"} </span>
            <RevealedLine text={call.lastLine.text} lineKey={call.lastLine.at} />
          </>
        ) : (
          emptyLineText(call)
        )}
      </p>
    </motion.button>
  );
}

function EmptyLines({ warningIssued }: { warningIssued: boolean }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-16 text-center">
      <PhoneOutgoing className="size-8 text-ink-muted" />
      <p className="type-body text-ink-muted">
        {warningIssued ? "Every line is free. The dialer picks the next household within a second." : "Lines open when the warning goes out."}
      </p>
    </div>
  );
}

export function LiveLines({
  calls,
  warningIssued,
  maxLines,
  selectedId,
  onSelect,
}: {
  calls: ActiveCall[] | undefined;
  warningIssued: boolean;
  maxLines: number;
  selectedId: Id<"calls"> | null;
  onSelect: (id: Id<"calls">) => void;
}) {
  const now = useNow(500);
  const sorted = [...(calls ?? [])].sort((a, b) => a.startedAt - b.startedAt);

  return (
    <Section
      title="Live lines"
      aside={
        warningIssued && (
          <span className="type-small text-ink-muted">
            <span className="font-semibold text-ink">{sorted.length}</span> of {maxLines} in use
          </span>
        )
      }
    >
      {sorted.length === 0 ? (
        <EmptyLines warningIssued={warningIssued} />
      ) : (
        <motion.div layout className="grid gap-px bg-line p-px sm:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {sorted.map((call) => (
              <LineCard key={call._id} call={call} now={now} selected={call._id === selectedId} onSelect={() => onSelect(call._id)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </Section>
  );
}
