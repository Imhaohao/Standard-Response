"use client";

import { motion } from "motion/react";
import { HouseFacts, HouseStage, LiveStep } from "@/lib/claim-stage";

// The night in four steps under the headline, so a judge sees how far their house has come at a
// glance. Done is solid ink, the step under way is half full and sweeping, a step the house never
// needed is hatched, and the last step turns red when the fire got there first.

type Segment = "done" | "now" | "todo" | "skipped" | "failed";
type Track = [Segment, Segment, Segment, Segment];

const STEPS = ["Warning", "Call", "Ride", "Out"] as const;

const LIVE_TRACKS: Record<LiveStep, Track> = {
  outside_zone: ["done", "todo", "todo", "todo"],
  calling: ["done", "now", "todo", "todo"],
  no_answer: ["done", "now", "todo", "todo"],
  on_call: ["done", "now", "todo", "todo"],
  door_check: ["done", "now", "todo", "todo"],
  call_done: ["done", "done", "todo", "todo"],
  ride_requested: ["done", "done", "now", "todo"],
  ride_coming: ["done", "done", "now", "todo"],
};

const callSegment = (facts: HouseFacts): Segment => (facts.callStatus === "complete" ? "done" : "skipped");
// A ride asked for that never boarded stays unfinished; a home that never asked skips the step.
const unboardedRide = (facts: HouseFacts): Segment => (facts.ride.state === "none" ? "skipped" : "todo");

function trackFor(stage: HouseStage, facts: HouseFacts): Track {
  if (stage.kind === "live") return LIVE_TRACKS[stage.step];
  if (stage.kind === "safe") return stage.how === "ride" || stage.how === "neighbor" ? ["done", "done", "done", "done"] : ["done", "done", "skipped", "done"];
  if (stage.kind === "lost") return stage.rideCameLate ? ["done", "done", "done", "failed"] : ["done", callSegment(facts), unboardedRide(facts), "failed"];
  if (stage.kind === "spared") return ["done", callSegment(facts), unboardedRide(facts), "done"];
  return ["now", "todo", "todo", "todo"];
}

const FILL: Record<Segment, number> = { done: 1, now: 0.5, todo: 0, skipped: 0, failed: 1 };

const SEGMENT_NAMES: Record<Segment, string> = { done: "done", now: "under way", todo: "not yet", skipped: "not needed", failed: "the fire got there first" };

const LABEL_TONE: Record<Segment, string> = {
  done: "font-semibold text-ink",
  now: "font-semibold text-ink",
  todo: "text-ink-muted",
  skipped: "text-ink-muted",
  failed: "font-semibold text-signal",
};

function SegmentBar({ segment }: { segment: Segment }) {
  return (
    <span className={`relative block h-1.5 overflow-hidden ${segment === "failed" ? "bg-signal-soft" : "bg-line"}`}>
      {segment === "skipped" && <span className="hatch absolute inset-0 text-line-strong" />}
      <motion.span
        className={`absolute inset-0 origin-left ${segment === "failed" ? "bg-signal" : "bg-ink"}`}
        initial={false}
        animate={{ scaleX: FILL[segment] }}
        transition={{ type: "spring", stiffness: 140, damping: 22 }}
      />
      {segment === "now" && <span className="animate-sweep absolute inset-0 bg-gradient-to-r from-transparent via-canvas/70 to-transparent" />}
    </span>
  );
}

export function NightTrack({ stage, facts }: { stage: HouseStage; facts: HouseFacts }) {
  const track = trackFor(stage, facts);
  return (
    <ol className="grid grid-cols-4 gap-1.5">
      {STEPS.map((step, i) => (
        <li key={step} className="flex flex-col gap-1.5" aria-label={`${step}: ${SEGMENT_NAMES[track[i]]}`}>
          <SegmentBar segment={track[i]} />
          <span className={`type-caption ${LABEL_TONE[track[i]]}`}>
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}
