"use client";

import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowCounterClockwise, Check } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Button } from "./ui/button";
import { Section } from "./ui/section";
import type { ControlState } from "./header-bar";

type StandInKey = "simulateVoice" | "simulateNeedModel";

const STAND_INS: { key: StandInKey; label: string; owner: string }[] = [
  { key: "simulateVoice", label: "Voice agent and dialer", owner: "Jerry" },
  { key: "simulateNeedModel", label: "Need model", owner: "David" },
];

function SourceSwitch({ label, owner, simulated, onChange }: { label: string; owner: string; simulated: boolean; onChange: (simulated: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 not-last:border-b not-last:border-line">
      <span className="flex flex-col">
        <span className="type-heading">{label}</span>
        <span className="type-small text-ink-muted">Owner: {owner}</span>
      </span>
      <div className="relative grid grid-cols-2 bg-surface-sunk p-0.5" role="group" aria-label={`${label} source`}>
        <motion.span
          className="absolute inset-y-0.5 w-[calc(50%-2px)] bg-surface shadow-[0_1px_2px_oklch(0_0_0/0.12)]"
          initial={false}
          animate={{ x: simulated ? 2 : "calc(100% + 2px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        />
        {[true, false].map((option) => (
          <button
            key={String(option)}
            type="button"
            aria-pressed={simulated === option}
            onClick={() => onChange(option)}
            className={`type-small relative flex h-8 items-center justify-center gap-1 px-3 font-semibold focus-visible:outline-2 focus-visible:outline-signal ${simulated === option ? "text-ink" : "text-ink-muted"}`}
          >
            {simulated === option && <Check weight="bold" className="size-3.5" />}
            {option ? "Stand-in" : "Real"}
          </button>
        ))}
      </div>
    </div>
  );
}

function ResetButton() {
  const reset = useMutation(api.control.reset);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  return (
    <Button
      variant={armed ? "primary" : "quiet"}
      className="w-full"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        void reset({});
      }}
    >
      <ArrowCounterClockwise weight="bold" className="size-4" />
      {armed ? "Click again to erase every call and record" : "Reset the simulation"}
    </Button>
  );
}

export function HarnessPanel({ control }: { control: ControlState | undefined }) {
  const setStandIns = useMutation(api.control.setStandIns);
  return (
    <Section title="Stand-ins">
      <p className="type-small border-b border-line px-4 py-2.5 text-ink-muted">
        Switch a piece to Real once its service writes to Convex. The stand-in stops so the two never fight over a record.
      </p>
      {STAND_INS.map((s) => (
        <SourceSwitch
          key={s.key}
          label={s.label}
          owner={s.owner}
          simulated={control?.[s.key] ?? true}
          onChange={(simulated) => void setStandIns({ [s.key]: simulated })}
        />
      ))}
      <div className="border-t border-line p-4">
        <ResetButton />
      </div>
    </Section>
  );
}
