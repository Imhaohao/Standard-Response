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

function Legend({ counts }: { counts: Map<HomeKind, number> }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
      {HOME_KINDS.map(({ kind, label }) => (
        <li key={kind} className="flex items-center gap-2">
          <svg viewBox="-7 -7 14 14" className="size-3.5 shrink-0" aria-hidden>
            <HomeMark kind={kind} r={5} tone={PANEL_TONE} />
          </svg>
          <span className="type-small min-w-0 flex-1 truncate text-on-panel-muted">{label}</span>
          <AnimatedNumber value={counts.get(kind) ?? 0} className="type-small font-bold tabular-nums" />
        </li>
      ))}
    </ul>
  );
}

const LADDER = [
  { status: "no_answer", label: "Redial", Icon: PhoneSlash },
  { status: "texted", label: "Texted", Icon: ChatText },
  { status: "door_check", label: "Door check", Icon: DoorOpen },
] as const;

// "Never treat silence as safe": the path an unanswered home takes, and how many are on each step.
function RetryLadder() {
  const counts = useQuery(api.households.counts);
  return (
    <ol className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5" aria-label="Unanswered homes">
      {LADDER.map(({ status, label, Icon }, index) => (
        <Fragment key={status}>
          <li className="flex flex-col gap-0.5 bg-panel-raised px-2 py-1.5">
            <span className="flex items-center justify-between gap-1.5">
              <Icon weight="bold" className="size-4 shrink-0" />
              <AnimatedNumber value={counts?.callStatus[status] ?? 0} className="type-figure text-lg" />
            </span>
            <span className="type-small text-on-panel-muted">{label}</span>
          </li>
          {index < LADDER.length - 1 && (
            <li aria-hidden>
              <ArrowRight weight="bold" className="size-3 text-on-panel-muted" />
            </li>
          )}
        </Fragment>
      ))}
    </ol>
  );
}

export function ReachPanel() {
  const { counts, total } = useKindCounts();
  const answered = total - (counts.get("waiting") ?? 0) - (counts.get("on_phone") ?? 0);
  return (
    <section aria-label="Households reached" className="flex flex-col gap-3 bg-panel/96 p-3 text-on-panel backdrop-blur-md">
      <p className="flex items-baseline gap-2">
        <AnimatedNumber value={answered} className="type-figure text-5xl" />
        <span className="type-body text-on-panel-muted">of {total} households answered</span>
      </p>
      <ReachChart counts={counts} total={total} />
      <Legend counts={counts} />
      <RetryLadder />
    </section>
  );
}
