"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Robot, User } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { CAN_LEAVE_LABELS, languageName, MOBILITY_LABELS, OUTCOMES, outcomeColor } from "@/lib/labels";
import { Button } from "./ui/button";
import { Section } from "./ui/section";
import { StageTrack } from "./ui/stage-track";

type Household = Doc<"households">;

const yesNo = (value: boolean | undefined) => (value === undefined ? undefined : value ? "Yes" : "No");

function recordRows(h: Household) {
  return [
    { key: "canLeave", label: "Can leave", value: h.canLeave && CAN_LEAVE_LABELS[h.canLeave] },
    { key: "peopleCount", label: "People", value: h.peopleCount?.toString() },
    { key: "mobility", label: "Mobility", value: h.mobility && MOBILITY_LABELS[h.mobility] },
    { key: "medical", label: "Medical", value: h.medical && (h.medical.length ? h.medical.join(", ") : "None") },
    { key: "hasCar", label: "Has a car", value: yesNo(h.hasCar) },
    { key: "pets", label: "Pets", value: yesNo(h.pets) },
  ];
}

function RecordField({ label, value, confidence }: { label: string; value: string | undefined; confidence: number | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
      <dt className="type-small text-ink-muted">{label}</dt>
      <dd className="flex flex-wrap items-baseline justify-between gap-x-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value ?? "empty"}
            className={`type-heading ${value ? "" : "text-line-strong"}`}
            initial={{ opacity: 0, y: 6, backgroundColor: "var(--surface-sunk)" }}
            animate={{ opacity: 1, y: 0, backgroundColor: "rgba(0,0,0,0)" }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
          >
            {value ?? "Not asked"}
          </motion.span>
        </AnimatePresence>
        {confidence !== undefined && value && <span className="type-small text-ink-muted">{Math.round(confidence * 100)}%</span>}
      </dd>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: Household["outcome"] }) {
  const label = OUTCOMES.find((o) => o.key === outcome)?.label ?? "No answer yet";
  return (
    <span className="type-small inline-flex items-center gap-2 bg-surface-sunk px-2.5 py-1 font-semibold">
      <motion.span layout className="size-2.5" style={{ background: outcomeColor(outcome) }} aria-hidden />
      {label}
    </span>
  );
}

function Transcript({ lines }: { lines: Doc<"transcriptLines">[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [lines.length]);

  if (lines.length === 0) return <p className="type-small px-4 py-6 text-ink-muted">The phone is ringing. Nothing said yet.</p>;

  return (
    <ol ref={listRef} className="flex max-h-[38vh] flex-col gap-2 overflow-y-auto px-4 py-4" aria-live="polite">
      <AnimatePresence initial={false}>
        {lines.map((line) => {
          const agent = line.speaker === "agent";
          return (
            <motion.li
              key={line._id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
              className={`flex gap-2.5 px-3 py-2.5 ${agent ? "bg-surface-sunk" : "ml-6"}`}
            >
              {agent ? <Robot weight="fill" className="mt-0.5 size-4 shrink-0" /> : <User weight="bold" className="mt-0.5 size-4 shrink-0 text-ink-muted" />}
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="type-small font-semibold">{agent ? "Calling agent" : "Resident"}</span>
                <p className="type-body">{line.text}</p>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

export function CallDetail({ callId, pinned, onFollowLive }: { callId: Id<"calls"> | null; pinned: boolean; onFollowLive: () => void }) {
  const detail = useQuery(api.calls.detail, callId ? { callId } : "skip");

  const aside = pinned ? (
    <Button variant="quiet" onClick={onFollowLive} className="h-8 px-3">
      Follow newest call
    </Button>
  ) : (
    <span className="type-small text-ink-muted">Following the oldest live call</span>
  );

  if (!callId || !detail?.household) {
    return (
      <Section title="Listening in" aside={callId ? aside : undefined}>
        <p className="type-body px-4 py-10 text-center text-ink-muted">Pick a line to hear the call and watch its record fill in.</p>
      </Section>
    );
  }

  const { call, household, lines } = detail;
  const confidence = household.confidence ?? {};

  return (
    <Section title="Listening in" aside={aside}>
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col">
            <span className="type-title">{household.address}</span>
            <span className="type-small text-ink-muted">
              {languageName(call.language)}, {call.direction === "inbound" ? "called the alert number" : `outbound attempt ${call.attempt}`}
              {household.simulated && ", simulated resident"}
            </span>
          </div>
          <OutcomeBadge outcome={household.outcome} />
        </div>
        <StageTrack stage={call.stage} live={call.phase === "live"} showLabel />
      </div>
      <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3">
        {recordRows(household).map((row) => (
          <RecordField key={row.key} label={row.label} value={row.value} confidence={confidence[row.key]} />
        ))}
      </dl>
      <Transcript lines={lines} />
    </Section>
  );
}
