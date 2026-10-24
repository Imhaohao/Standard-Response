"use client";

import { useMutation } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Fire, Hurricane, Minus, Pause, PhoneIncoming, Play, Plus, Pulse, SlidersHorizontal, Waves } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Hazard } from "@/convex/hazards";
import { SegmentedControl } from "../rescue/segmented-control";
import { AnimatedNumber } from "../ui/animated-number";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

export type ControlState = FunctionReturnType<typeof api.control.get>;

const ICON_SWAP = {
  initial: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
  transition: { type: "spring", duration: 0.3, bounce: 0 },
} as const;

function DialerToggle({ running }: { running: boolean }) {
  const setDialer = useMutation(api.control.setDialer);
  return (
    <Button variant="onPanel" onClick={() => void setDialer({ running: !running })} className="!h-8 w-[6.5rem]">
      <span className="relative size-4">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span key={running ? "pause" : "play"} className="absolute inset-0" {...ICON_SWAP}>
            {running ? <Pause weight="fill" className="size-4" /> : <Play weight="fill" className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </span>
      {running ? "Pause" : "Resume"}
    </Button>
  );
}

function LineStepper({ value }: { value: number }) {
  const setMax = useMutation(api.control.setMaxConcurrentCalls);
  return (
    <div className="flex items-center" role="group" aria-label="Open phone lines">
      <Button variant="onPanelQuiet" className="!h-8 w-8 !px-0" aria-label="Close two lines" onClick={() => void setMax({ value: value - 2 })}>
        <Minus weight="bold" className="size-4" />
      </Button>
      <span className="flex w-16 items-baseline justify-center gap-1">
        <AnimatedNumber value={value} className="type-figure text-lg" />
        <span className="type-small text-on-panel-muted">lines</span>
      </span>
      <Button variant="onPanelQuiet" className="!h-8 w-8 !px-0" aria-label="Open two more lines" onClick={() => void setMax({ value: value + 2 })}>
        <Plus weight="bold" className="size-4" />
      </Button>
    </div>
  );
}

type StandInKey = "simulateVoice" | "simulateNeedModel" | "simulateDispatch" | "simulateDrivers" | "autoApprove";

const STAND_INS: { key: StandInKey; label: string; owner: string }[] = [
  { key: "simulateVoice", label: "Voice agent, dialer and callbacks", owner: "Track B" },
  { key: "simulateDispatch", label: "Dispatcher and vehicle movement", owner: "Track C" },
  { key: "simulateDrivers", label: "Drivers not on the driver page", owner: "Track C" },
  { key: "autoApprove", label: "Dispatcher approval", owner: "Track A" },
  { key: "simulateNeedModel", label: "Need model", owner: "Track D" },
];

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
      variant={armed ? "onPanel" : "onPanelQuiet"}
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

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

// Each piece of the system has a stand-in until its owner switches it to Real. The switches are
// for the team, not the audience, so they live behind one button.
function StandIns({ control }: { control: ControlState }) {
  const setStandIns = useMutation(api.control.setStandIns);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const real = STAND_INS.filter((entry) => control[entry.key] === false).length;
  return (
    <div ref={ref} className="relative">
      <Button variant="onPanelQuiet" className="!h-8" aria-label="Stand-ins" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal weight="bold" className="size-4" />
        <span className="tabular-nums">{real}/{STAND_INS.length} real</span>
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 flex w-80 flex-col bg-panel text-on-panel shadow-[0_0_0_1px_var(--panel-raised),0_16px_40px_oklch(0_0_0/0.35)]">
          {STAND_INS.map((entry) => (
            <Switch
              key={entry.key}
              checked={control[entry.key] === false}
              onChange={(isReal) => void setStandIns({ [entry.key]: !isReal })}
              label={entry.label}
              hint={`${control[entry.key] === false ? "Real" : "Stand-in"}, owned by ${entry.owner}`}
            />
          ))}
          <div className="border-t border-panel-raised p-3">
            <ResetButton />
          </div>
        </div>
      )}
    </div>
  );
}

const HAZARD_OPTIONS = [
  { value: "wildfire", label: "Wildfire", Icon: Fire },
  { value: "earthquake", label: "Earthquake", Icon: Pulse },
  { value: "flood", label: "Flood", Icon: Waves },
  { value: "hurricane", label: "Hurricane", Icon: Hurricane },
] as const satisfies readonly { value: Hazard; label: string; Icon: unknown }[];

// Chosen before the warning: it sets the agent's safety line and the scenario the maps draw.
function HazardPicker({ hazard }: { hazard: Hazard }) {
  const setHazard = useMutation(api.control.setHazard);
  return <SegmentedControl options={HAZARD_OPTIONS} value={hazard} onChange={(next) => void setHazard({ hazard: next })} ariaLabel="Hazard" />;
}

export function FloorControls({ control }: { control: ControlState | undefined }) {
  const surge = useMutation(api.control.inboundSurge);
  if (!control) return null;
  if (!control.warningIssuedAt) {
    return (
      <>
        <HazardPicker hazard={control.hazard} />
        <StandIns control={control} />
      </>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2 bg-panel-raised/60 pr-2">
        <LineStepper value={control.maxConcurrentCalls} />
        <Button variant="onPanelQuiet" className="!h-8" onClick={() => void surge({})}>
          <PhoneIncoming weight="bold" className="size-4" />
          Inbound surge
        </Button>
      </div>
      <DialerToggle running={control.dialerRunning} />
      <StandIns control={control} />
    </>
  );
}
