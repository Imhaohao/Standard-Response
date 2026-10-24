"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Headphones, PhoneCall, Robot, User } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { PRODUCT_NAME } from "@/lib/brand";
import { CAN_LEAVE_LABELS, languageName, MOBILITY_LABELS } from "@/lib/labels";
import { Button } from "../ui/button";
import { StageTrack } from "../ui/stage-track";
import { HOME_KINDS, homeKind, HomeMark, PANEL_TONE } from "./household-mark";

type Household = Doc<"households">;
type Line = Doc<"transcriptLines">;

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

// A field that has not been asked yet stays an empty slot; when the agent fills it, the value drops in.
function RecordField({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex min-w-24 flex-col gap-0.5 bg-panel-raised px-3 py-1.5">
      <dt className="type-small text-on-panel-muted">{label}</dt>
      <dd>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value ?? "empty"}
            className={`type-title block truncate ${value ? "" : "text-on-panel-muted/50"}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            {value ?? "–"}
          </motion.span>
        </AnimatePresence>
      </dd>
    </div>
  );
}

function OutcomeBadge({ household }: { household: Household }) {
  const kind = homeKind(household);
  const label = HOME_KINDS.find((entry) => entry.kind === kind)?.label;
  return (
    <span className="type-small inline-flex shrink-0 items-center gap-2 bg-panel-raised px-2.5 py-1 font-semibold">
      <svg viewBox="-7 -7 14 14" className="size-3.5" aria-hidden>
        <HomeMark kind={kind} r={5} tone={PANEL_TONE} />
      </svg>
      {label}
    </span>
  );
}

// Slack-style: the agent's turns sit on their own raised surface and carry the agent's name once per
// run of turns; the resident's words are plain text under the resident's name.
function TranscriptLine({ line, residentName, firstOfRun }: { line: Line; residentName: string; firstOfRun: boolean }) {
  const agent = line.speaker === "agent";
  const speakerName = agent ? `${PRODUCT_NAME} agent` : residentName;
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.35, bounce: 0 }}
      className={`flex flex-col gap-0.5 ${agent ? "mx-2 rounded-lg bg-panel-raised px-3 py-2" : "px-5 py-1"} ${firstOfRun ? "mt-2" : ""}`}
    >
      {firstOfRun && (
        <span className="type-small flex items-center gap-1.5 font-bold">
          {agent ? <Robot weight="fill" className="size-4" /> : <User weight="bold" className="size-4 text-on-panel-muted" />}
          {speakerName}
        </span>
      )}
      <p className="type-body">{line.text}</p>
    </motion.li>
  );
}

function Transcript({ lines, residentName }: { lines: Line[]; residentName: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  if (lines.length === 0) {
    return (
      <div className="grid flex-1 place-items-center text-on-panel-muted" role="status" aria-label="Nothing said yet">
        <PhoneCall weight="bold" className="size-8" />
      </div>
    );
  }
  return (
    <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pb-3" aria-live="polite">
      {lines.map((line, index) => (
        <TranscriptLine key={line._id} line={line} residentName={residentName} firstOfRun={lines[index - 1]?.speaker !== line.speaker} />
      ))}
    </ol>
  );
}

export function ListeningPanel({ callId, pinned, onFollowLive }: { callId: Id<"calls"> | null; pinned: boolean; onFollowLive: () => void }) {
  const detail = useQuery(api.calls.detail, callId ? { callId } : "skip");
  const follow = pinned && (
    <Button variant="onPanelQuiet" className="!h-7 !px-2.5 !text-xs" onClick={onFollowLive}>
      <Headphones weight="bold" className="size-4" />
      Follow live
    </Button>
  );

  if (!callId || !detail?.household) {
    return (
      <section aria-label="Listening in" className="grid place-items-center bg-panel/96 py-8 text-on-panel-muted backdrop-blur-md">
        <Headphones weight="bold" className="size-8" />
      </section>
    );
  }

  const { call, household, lines } = detail;
  return (
    <section aria-label="Listening in" className="flex min-h-0 flex-1 flex-col bg-panel/96 text-on-panel backdrop-blur-md">
      <header className="flex flex-col gap-2.5 border-b border-panel-raised p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h2 className="type-title truncate">{household.address}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {call.language !== "en" && <span className="type-small bg-panel-raised px-2 py-1 font-bold">{languageName(call.language)}</span>}
            <OutcomeBadge household={household} />
          </div>
        </div>
        <StageTrack stage={call.stage} live={call.phase === "live"} showLabel />
        {follow && <div className="self-start">{follow}</div>}
      </header>
      <dl className="flex flex-wrap gap-1.5 border-b border-panel-raised p-3">
        {recordRows(household).map((row) => (
          <RecordField key={row.key} label={row.label} value={row.value} />
        ))}
      </dl>
      <Transcript lines={lines} residentName={household.residentName ?? "Resident"} />
    </section>
  );
}
