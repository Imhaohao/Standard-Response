"use client";

import { useMutation } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Pause, Play, PhoneIncoming, Plus } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { AREA_NAME, PRODUCT_NAME } from "@/lib/brand";
import { formatElapsed, useNow } from "@/lib/time";
import { Button } from "./ui/button";
import { AnimatedNumber } from "./ui/animated-number";

export type ControlState = FunctionReturnType<typeof api.control.get>;

const ICON_SWAP = {
  initial: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
  transition: { type: "spring", duration: 0.3, bounce: 0 },
} as const;

function WarningClock({ issuedAt }: { issuedAt: number }) {
  const now = useNow();
  return (
    <div className="flex items-baseline gap-2">
      <span className="type-small text-ink-muted">Since warning</span>
      <span className="type-figure text-xl">{formatElapsed(now - issuedAt)}</span>
    </div>
  );
}

function DialerToggle({ running }: { running: boolean }) {
  const setDialer = useMutation(api.control.setDialer);
  return (
    <Button variant="primary" onClick={() => void setDialer({ running: !running })} className="w-[9.5rem]">
      <span className="relative size-4">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={running ? "pause" : "play"} className="absolute inset-0" {...ICON_SWAP}>
            {running ? <Pause weight="fill" className="size-4" /> : <Play weight="fill" className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </span>
      {running ? "Pause dialer" : "Resume dialer"}
    </Button>
  );
}

function LineStepper({ value }: { value: number }) {
  const setMax = useMutation(api.control.setMaxConcurrentCalls);
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Open phone lines">
      <Button variant="quiet" className="!px-0 w-10" aria-label="Close one line" onClick={() => void setMax({ value: value - 2 })}>
        <Minus weight="bold" className="size-4" />
      </Button>
      <span className="flex w-20 flex-col items-center leading-none">
        <AnimatedNumber value={value} className="type-figure text-lg" />
        <span className="type-small text-ink-muted">lines</span>
      </span>
      <Button variant="quiet" className="!px-0 w-10" aria-label="Open one more line" onClick={() => void setMax({ value: value + 2 })}>
        <Plus weight="bold" className="size-4" />
      </Button>
    </div>
  );
}

export function HeaderBar({ control }: { control: ControlState | undefined }) {
  const surge = useMutation(api.control.inboundSurge);
  const issuedAt = control?.warningIssuedAt;

  return (
    <header className="z-20 border-b lg:sticky lg:top-0 border-line bg-surface/92 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="size-3.5 shrink-0 bg-signal" aria-hidden />
          <span className="type-title">{PRODUCT_NAME}</span>
          <span className="type-small hidden truncate text-ink-muted sm:inline">Call floor, {AREA_NAME}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3 md:gap-5">
          {issuedAt && <WarningClock issuedAt={issuedAt} />}
          {issuedAt && control && (
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
              <LineStepper value={control.maxConcurrentCalls} />
              <Button variant="quiet" onClick={() => void surge({})}>
                <PhoneIncoming weight="bold" className="size-4" />
                Simulate inbound surge
              </Button>
              <DialerToggle running={control.dialerRunning} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
