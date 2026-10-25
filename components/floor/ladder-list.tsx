"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { ChatText, DoorOpen, PhoneCall, PhoneSlash, type Icon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { formatElapsed } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { PanelEmpty } from "../ui/panel";

type Rung = FunctionReturnType<typeof api.reachLadder.unanswered>[number];

const STEP_ICONS: Partial<Record<Rung["step"], Icon>> = {
  waiting_to_retry: PhoneSlash,
  retry_due: PhoneSlash,
  retrying: PhoneCall,
  awaiting_reply: ChatText,
  door_check: DoorOpen,
};

// Where the home is on the ladder: which call it's on, or that it was texted.
function whereOnLadder(rung: Rung) {
  if (rung.step === "retrying") return `Call ${rung.attempt} of ${rung.maxAttempts}`;
  if (rung.step === "awaiting_reply") return `${rung.maxAttempts} calls missed, texted`;
  if (rung.step === "door_check") return "No reply";
  return `${rung.attempt} of ${rung.maxAttempts} calls missed`;
}

// What fires next and when, on the night clock: the redial, the door check, or the call ringing now.
function NextStep({ rung, now }: { rung: Rung; now: number }) {
  if (rung.step === "retrying") return <span className="type-small font-semibold">Ringing</span>;
  if (rung.step === "door_check") return <span className="type-small font-semibold">Door check</span>;
  const label = rung.nextStep === "door_check" ? "Door check" : "Redial";
  const left = rung.nextStepAt === null ? 0 : rung.nextStepAt - now;
  if (rung.step === "retry_due" || left <= 0) return <span className="type-small font-semibold">{label} now</span>;
  return (
    <span className="type-small font-semibold">
      {label} in <span className="tabular-nums">{formatElapsed(left)}</span>
    </span>
  );
}

function RungRow({ rung, now }: { rung: Rung; now: number }) {
  const StepIcon = STEP_ICONS[rung.step] ?? PhoneSlash;
  const timedBy = rung.source === "workflow" ? "Timed by its own Convex workflow" : "Simulated home on the stand-in's timing";
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4, transition: { duration: 0.15 } }}
      transition={{ type: "spring", duration: 0.35, bounce: 0 }}
      title={timedBy}
      className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2.5 border-b border-panel-raised px-3 py-2"
    >
      <StepIcon weight="bold" className={`size-4 ${rung.step === "retrying" ? "motion-safe:animate-ringing" : "text-on-panel-muted"}`} />
      <span className="flex min-w-0 flex-col">
        <span className="type-small truncate font-bold">{rung.address}</span>
        <span className="type-small text-on-panel-muted">{whereOnLadder(rung)}</span>
      </span>
      <NextStep rung={rung} now={now} />
    </motion.li>
  );
}

// Every home past its first missed call, each on its own step of the reach ladder, soonest next
// step first. Silence never counts as safe: the list only ends in an answer, a reply or a door check.
export function LadderList() {
  const rungs = useQuery(api.reachLadder.unanswered);
  const now = useSimNow(1000);
  if (rungs?.length === 0) return <PanelEmpty>Every home called so far has answered.</PanelEmpty>;
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false} mode="popLayout">
        {rungs?.map((rung) => <RungRow key={rung.householdId} rung={rung} now={now} />)}
      </AnimatePresence>
    </ol>
  );
}
