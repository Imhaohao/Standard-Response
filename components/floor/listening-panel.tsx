"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Robot, User } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { PRODUCT_NAME } from "@/lib/brand";
import { CAN_LEAVE_LABELS, languageName, MOBILITY_LABELS } from "@/lib/labels";
import { Button } from "../ui/button";
import { PanelEmpty } from "../ui/panel";
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
function RecordField({ label, value, confidence }: { label: string; value: string | undefined; confidence: number | undefined }) {
  return (
    <div className="flex flex-col gap-0.5 bg-panel px-3 py-2">
      <dt className="type-small text-on-panel-muted">{label}</dt>
      <dd className="flex items-baseline justify-between gap-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={value ?? "empty"}
            className={`type-heading truncate ${value ? "" : "text-on-panel-muted/50"}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            {value ?? "–"}
          </motion.span>
        </AnimatePresence>
        {confidence !== undefined && value && <span className="type-small text-on-panel-muted tabular-nums">{Math.round(confidence * 100)}%</span>}
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

function Speaker({ agent }: { agent: boolean }) {
  return agent ? (
    <span className="grid size-8 shrink-0 place-items-center bg-on-panel text-panel">
      <Robot weight="fill" className="size-5" />
    </span>
  ) : (
    <span className="grid size-8 shrink-0 place-items-center bg-panel-raised text-on-panel-muted">
      <User weight="bold" className="size-4" />
    </span>
  );
}

// Slack-style: the speaker's avatar and name sit with their words, and the agent's turns are on
// their own raised surface so nobody mistakes the bot for the resident.
function TranscriptLine({ line, residentName }: { line: Line; residentName: string }) {
  const agent = line.speaker === "agent";
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.35, bounce: 0 }}
      className={`flex gap-3 px-3 py-2.5 ${agent ? "bg-panel-raised" : ""}`}
    >
      <Speaker agent={agent} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="type-small font-bold">{agent ? `${PRODUCT_NAME} agent` : residentName}</span>
          {agent && line.latencyMs !== undefined && <span className="type-small text-on-panel-muted tabular-nums">{line.latencyMs} ms</span>}
        </span>
        <p className="type-body">{line.text}</p>
      </div>
    </motion.li>
  );
}

function Transcript({ lines, residentName }: { lines: Line[]; residentName: string }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  if (lines.length === 0) return <PanelEmpty>The phone is ringing. Nothing said yet.</PanelEmpty>;
  return (
    <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto py-1" aria-live="polite">
      {lines.map((line) => (
        <TranscriptLine key={line._id} line={line} residentName={residentName} />
      ))}
    </ol>
  );
}

function callNote(call: Doc<"calls">, household: Household) {
  const how = call.direction === "inbound" ? "called the alert number" : `outbound, try ${call.attempt}`;
  return `${languageName(call.language)}, ${how}${household.simulated ? ", simulated resident" : ""}`;
}

export function ListeningPanel({ callId, pinned, onFollowLive }: { callId: Id<"calls"> | null; pinned: boolean; onFollowLive: () => void }) {
  const detail = useQuery(api.calls.detail, callId ? { callId } : "skip");
  const follow = pinned && (
    <Button variant="onPanelQuiet" className="!h-7 !px-2.5 !text-xs" onClick={onFollowLive}>
      Follow the oldest call
    </Button>
  );

  if (!callId || !detail?.household) {
    return (
      <section className="flex flex-col bg-panel/96 text-on-panel backdrop-blur-md">
        <PanelEmpty>Pick a line to listen in and watch its record fill.</PanelEmpty>
      </section>
    );
  }

  const { call, household, lines } = detail;
  const confidence = household.confidence ?? {};
  return (
    <section aria-label="Listening in" className="flex min-h-0 flex-1 flex-col bg-panel/96 text-on-panel backdrop-blur-md">
      <header className="flex flex-col gap-2.5 border-b border-panel-raised p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h2 className="type-title truncate">{household.address}</h2>
            <span className="type-small text-on-panel-muted">{callNote(call, household)}</span>
          </div>
          <OutcomeBadge household={household} />
        </div>
        <StageTrack stage={call.stage} live={call.phase === "live"} showLabel />
        {follow && <div className="self-start">{follow}</div>}
      </header>
      <dl className="grid grid-cols-3 gap-px border-b border-panel-raised bg-panel-raised">
        {recordRows(household).map((row) => (
          <RecordField key={row.key} label={row.label} value={row.value} confidence={confidence[row.key]} />
        ))}
      </dl>
      <Transcript lines={lines} residentName={household.residentName ?? "Resident"} />
    </section>
  );
}
