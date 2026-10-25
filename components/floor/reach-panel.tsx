"use client";

import { useQuery } from "convex/react";
import { Fragment } from "react";
import { ArrowRight, ChatText, DoorOpen, PhoneSlash } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { AnimatedNumber } from "../ui/animated-number";
import { HOME_KINDS, HomeKind, homeKind, HomeMark, PANEL_TONE } from "./household-mark";

const COLUMNS = 20;
const CELL = 14;

function useKindCounts() {
  const homes = useQuery(api.households.coverage);
  const counts = new Map<HomeKind, number>(HOME_KINDS.map(({ kind }) => [kind, 0]));
  for (const home of homes ?? []) {
    const kind = homeKind(home);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return { counts, total: homes?.length ?? 0 };
}

// One cell per household, sorted by what we learned, so the chart fills from the top as the agents
// get answers. The cells use the same marks as the map.
function ReachChart({ counts, total }: { counts: Map<HomeKind, number>; total: number }) {
  const cells = HOME_KINDS.flatMap(({ kind }) => Array.from({ length: counts.get(kind) ?? 0 }, () => kind));
  const rows = Math.max(1, Math.ceil(total / COLUMNS));
  return (
    <svg viewBox={`0 0 ${COLUMNS * CELL} ${rows * CELL}`} className="block h-auto w-full" aria-hidden>
      {cells.map((kind, index) => (
        <g key={index} transform={`translate(${(index % COLUMNS) * CELL + CELL / 2} ${Math.floor(index / COLUMNS) * CELL + CELL / 2})`}>
          <HomeMark kind={kind} r={CELL * 0.36} tone={PANEL_TONE} quiet />
        </g>
      ))}
    </svg>
  );
}

// Each count says what it counts: the chart above uses the same marks, so this doubles as its key.
function Legend({ counts }: { counts: Map<HomeKind, number> }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
      {HOME_KINDS.map(({ kind, label }) => (
        <li key={kind} className="flex items-center gap-2">
          <svg viewBox="-7 -7 14 14" className="size-4 shrink-0" aria-hidden>
            <HomeMark kind={kind} r={5} tone={PANEL_TONE} />
          </svg>
          <AnimatedNumber value={counts.get(kind) ?? 0} className="type-heading w-6 shrink-0 tabular-nums" />
          <span className="type-small min-w-0 text-on-panel-muted">{label}</span>
        </li>
      ))}
    </ul>
  );
}

const LADDER = [
  { status: "no_answer", label: "To redial", Icon: PhoneSlash },
  { status: "texted", label: "Texted", Icon: ChatText },
  { status: "door_check", label: "Door check", Icon: DoorOpen },
] as const;

// "Never treat silence as safe": the path an unanswered home takes, and how many are on each step.
// Each step opens the list of those homes and when their next step fires.
function RetryLadder({ onOpen }: { onOpen: () => void }) {
  const counts = useQuery(api.households.counts);
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="type-small font-semibold text-on-panel-muted">Homes that didn&apos;t answer</h3>
      <ol className="flex items-center gap-1">
        {LADDER.map(({ status, label, Icon }, index) => (
          <Fragment key={status}>
            <li className="flex min-w-0 flex-1">
              <button
                type="button"
                onClick={onOpen}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 bg-panel-raised px-2.5 py-1.5 text-left hover:bg-panel-raised/70 focus-visible:outline-2 focus-visible:outline-on-panel"
              >
                <span className="flex items-center gap-2">
                  <Icon weight="bold" className="size-4 shrink-0" aria-hidden />
                  <AnimatedNumber value={counts?.callStatus[status] ?? 0} className="type-figure text-xl" />
                </span>
                <span className="type-caption">{label}</span>
              </button>
            </li>
            {index < LADDER.length - 1 && <ArrowRight weight="bold" className="size-3 shrink-0 text-on-panel-muted" aria-hidden />}
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

export function ReachPanel({ onOpenLadder }: { onOpenLadder: () => void }) {
  const { counts, total } = useKindCounts();
  const answered = total - (counts.get("waiting") ?? 0) - (counts.get("on_phone") ?? 0);
  return (
    <section aria-label="Households reached" className="flex flex-col gap-3 bg-panel/96 p-3 text-on-panel backdrop-blur-md">
      <p className="flex items-baseline gap-2">
        <AnimatedNumber value={answered} className="type-figure text-5xl" />
        <span className="type-heading text-on-panel-muted">of {total} homes answered</span>
      </p>
      <ReachChart counts={counts} total={total} />
      <Legend counts={counts} />
      <RetryLadder onOpen={onOpenLadder} />
    </section>
  );
}
