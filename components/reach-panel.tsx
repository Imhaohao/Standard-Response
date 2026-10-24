"use client";

import { useMutation } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { motion } from "motion/react";
import { useState } from "react";
import { Siren } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { OUTCOMES } from "@/lib/labels";
import { AREA_NAME } from "@/lib/brand";
import { AnimatedNumber } from "./ui/animated-number";
import { Button } from "./ui/button";
import type { ControlState } from "./header-bar";

type Counts = FunctionReturnType<typeof api.households.counts>;

const ENTER = { initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 } };
const stagger = (i: number) => ({ type: "spring" as const, stiffness: 120, damping: 20, delay: 0.08 * i });

function BeforeWarning() {
  const issueWarning = useMutation(api.control.issueWarning);
  const [pending, setPending] = useState(false);
  return (
    <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-end md:p-10">
      <div className="flex max-w-[44rem] flex-col gap-4">
        <motion.h1 className="type-display" {...ENTER} transition={stagger(0)}>
          Nobody in {AREA_NAME} has been called yet.
        </motion.h1>
        <motion.p className="type-body max-w-[34rem] text-on-panel-muted" {...ENTER} transition={stagger(1)}>
          Issuing the warning seeds 200 simulated households and starts the calling agents. Every unanswered home gets a
          retry, then a text, then a door check.
        </motion.p>
      </div>
      <motion.div {...ENTER} transition={stagger(2)}>
        <Button
          variant="onPanel"
          size="lg"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void issueWarning({}).finally(() => setPending(false));
          }}
        >
          <Siren weight="fill" className="size-5 text-signal" />
          Issue evacuation warning
        </Button>
      </motion.div>
    </div>
  );
}

function OutcomeFigure({ label, color, value, index }: { label: string; color: string; value: number; index: number }) {
  return (
    <motion.div className="flex flex-col gap-2 bg-panel-raised/60 p-4" {...ENTER} transition={stagger(index + 1)}>
      <span className="flex items-center gap-2">
        <span className="size-2.5 shrink-0" style={{ background: color }} aria-hidden />
        <span className="type-small text-on-panel-muted">{label}</span>
      </span>
      <AnimatedNumber value={value} className="type-figure text-4xl" />
    </motion.div>
  );
}

function OutcomeStrip({ counts }: { counts: Counts }) {
  return (
    <div className="flex h-2 w-full overflow-hidden bg-panel-raised" aria-hidden>
      {OUTCOMES.map((o) => (
        <motion.span
          key={o.key}
          className="h-full"
          style={{ background: o.colorVar }}
          initial={false}
          animate={{ width: `${(counts.outcome[o.key] / Math.max(counts.total, 1)) * 100}%` }}
          transition={{ type: "spring", stiffness: 80, damping: 20 }}
        />
      ))}
    </div>
  );
}

function AfterWarning({ counts }: { counts: Counts }) {
  const reached = counts.total - counts.outcome.unknown;
  return (
    <div className="flex flex-col gap-6 p-6 md:p-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-end">
        <div className="flex flex-col gap-3">
          <motion.h1 className="type-display" {...ENTER} transition={stagger(0)}>
            <AnimatedNumber value={reached} /> of {counts.total} households have an answer.
          </motion.h1>
          <motion.dl className="type-body flex flex-wrap gap-x-6 gap-y-1 text-on-panel-muted" {...ENTER} transition={stagger(1)}>
            <div className="flex gap-2">
              <dt>On the phone</dt>
              <dd className="font-semibold text-on-panel">
                <AnimatedNumber value={counts.callStatus.in_call} />
              </dd>
            </div>
            <div className="flex gap-2">
              <dt>Not called yet</dt>
              <dd className="font-semibold text-on-panel">
                <AnimatedNumber value={counts.callStatus.not_called} />
              </dd>
            </div>
          </motion.dl>
        </div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {OUTCOMES.map((o, i) => (
            <OutcomeFigure key={o.key} label={o.label} color={o.colorVar} value={counts.outcome[o.key]} index={i} />
          ))}
        </div>
      </div>
      <OutcomeStrip counts={counts} />
    </div>
  );
}

export function ReachPanel({ control, counts }: { control: ControlState | undefined; counts: Counts | undefined }) {
  const loading = control === undefined || counts === undefined;
  return (
    <section className="relative overflow-hidden bg-panel text-on-panel" aria-label="Who has been reached">
      <span className="absolute inset-x-0 top-0 h-1 bg-signal" aria-hidden />
      {loading ? (
        <div className="h-[15.5rem] animate-pulse bg-panel-raised/40" />
      ) : control.warningIssuedAt ? (
        <AfterWarning counts={counts} />
      ) : (
        <BeforeWarning />
      )}
    </section>
  );
}
