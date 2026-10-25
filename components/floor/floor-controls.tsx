"use client";

import { useMutation } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Fire, Hurricane, Minus, Pause, PhoneIncoming, Play, Plus, Pulse, SlidersHorizontal, Waves } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Hazard } from "@/convex/hazards";
import { SegmentedControl } from "../ui/segmented-control";
import { AnimatedNumber } from "../ui/animated-number";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useDismiss } from "../ui/use-dismiss";
import { DemoNumbers } from "./demo-numbers";

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
    <Button variant="onPanel" onClick={() => void setDialer({ running: !running })} size="sm" className="w-[6.5rem]">
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
      <Button variant="onPanelQuiet" size="sm" square aria-label="Close two lines" onClick={() => void setMax({ value: value - 2 })}>
        <Minus weight="bold" className="size-4" />
      </Button>
      <span className="flex w-14 items-baseline justify-center gap-1">
        <AnimatedNumber value={value} className="type-figure text-lg" />
        <span className="type-small text-on-panel-muted">lines</span>
      </span>
      <Button variant="onPanelQuiet" size="sm" square aria-label="Open two more lines" onClick={() => void setMax({ value: value + 2 })}>
        <Plus weight="bold" className="size-4" />
      </Button>
    </div>
  );
}

type StandInKey = "simulateVoice" | "simulateNeedModel" | "simulateDispatch" | "simulateDrivers" | "autoApprove";

const STAND_INS: { key: StandInKey; label: string }[] = [
  { key: "simulateVoice", label: "Voice agent, dialer and callbacks" },
  { key: "simulateDispatch", label: "Dispatcher and vehicle movement" },
  { key: "simulateDrivers", label: "Drivers not on the driver page" },
  { key: "autoApprove", label: "Dispatcher approval" },
  { key: "simulateNeedModel", label: "Need model" },
];

// Each piece of the system has a stand-in until someone switches it to Real. The switches are
// for the team, not the audience, so they live behind one button. Ending the night lives in the app
// bar's Restart menu.
function StandIns({ control }: { control: ControlState }) {
  const setStandIns = useMutation(api.control.setStandIns);
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const real = STAND_INS.filter((entry) => control[entry.key] === false).length;
  return (
    <div ref={ref} className="relative">
      <Button variant="onPanelQuiet" size="sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <SlidersHorizontal weight="bold" className="size-4" />
        <span className="sm:hidden">Settings</span>
        <span className="max-sm:hidden">Simulation settings</span>
      </Button>
      {/* On a phone the button can sit mid-bar, so the menu spans the bar instead: the bar's backdrop blur
          makes it the containing block for `fixed`. */}
      {open && (
        <div
          role="dialog"
          aria-label="Simulation settings"
          className="absolute top-full right-0 z-30 mt-2 flex w-80 flex-col bg-panel text-on-panel shadow-popover max-sm:fixed max-sm:inset-x-4 max-sm:w-auto"
        >
          <p className="type-small border-b border-panel-raised px-3 py-2.5 text-on-panel-muted">
            <span className="font-semibold text-on-panel tabular-nums">
              {real} of {STAND_INS.length}
            </span>{" "}
            parts run for real. Switch one off to use its stand-in.
          </p>
          {STAND_INS.map((entry) => (
            <Switch
              key={entry.key}
              checked={control[entry.key] === false}
              onChange={(isReal) => void setStandIns({ [entry.key]: !isReal })}
              label={entry.label}
              hint={control[entry.key] === false ? "Real" : "Stand-in"}
            />
          ))}
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
        <DemoNumbers />
        <StandIns control={control} />
      </>
    );
  }
  // On a phone the bar wraps: settings sits beside the warning clock, the call controls get the row below.
  return (
    <>
      <div className="flex items-center gap-2 bg-panel-raised/60 pr-2 max-sm:order-1">
        <LineStepper value={control.maxConcurrentCalls} />
        <Button variant="onPanelQuiet" size="sm" onClick={() => void surge({})}>
          <PhoneIncoming weight="bold" className="size-4" />
          <span className="sm:hidden">Surge</span>
          <span className="max-sm:hidden">Inbound surge</span>
        </Button>
      </div>
      <div className="max-sm:order-1">
        <DialerToggle running={control.dialerRunning} />
      </div>
      <DemoNumbers />
      <StandIns control={control} />
    </>
  );
}
