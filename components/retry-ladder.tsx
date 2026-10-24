"use client";

import { FunctionReturnType } from "convex/server";
import { ArrowRight, ChatText, DoorOpen, PhoneSlash } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { AnimatedNumber } from "./ui/animated-number";
import { Section } from "./ui/section";

type Counts = FunctionReturnType<typeof api.households.counts>;

const STEPS = [
  { status: "no_answer", label: "Waiting to redial", Icon: PhoneSlash },
  { status: "texted", label: "Texted, waiting for a reply", Icon: ChatText },
  { status: "door_check", label: "On the door-check list", Icon: DoorOpen },
] as const;

// "Never treat silence as safe": the path an unanswered home takes.
export function RetryLadder({ counts, className = "" }: { counts: Counts | undefined; className?: string }) {
  return (
    <Section title="Unanswered homes" className={className}>
      <ol className="flex flex-col gap-1 p-4">
        {STEPS.map(({ status, label, Icon }, i) => (
          <li key={status} className="flex flex-col">
            <div className="flex items-center gap-3 bg-surface-sunk px-3 py-3">
              <Icon weight="bold" className="size-5 shrink-0" />
              <span className="type-small flex-1">{label}</span>
              <AnimatedNumber value={counts?.callStatus[status] ?? 0} className="type-figure text-2xl" />
            </div>
            {i < STEPS.length - 1 && <ArrowRight weight="bold" className="mx-auto my-0.5 size-3.5 rotate-90 text-ink-muted" aria-hidden />}
          </li>
        ))}
      </ol>
    </Section>
  );
}
