"use client";

import { formatSinceWarning } from "@/lib/time";

// The rescue map's hazard progress bar, made draggable: a signal-red fill up to a round knob on a hairline track.
const SCRUBBER = [
  "h-6 min-w-0 max-w-md flex-1 cursor-pointer appearance-none bg-transparent focus-visible:outline-none",
  "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full",
  "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--color-signal)_var(--filled),var(--color-line)_var(--filled))]",
  "[&::-webkit-slider-thumb]:-mt-1.5 [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
  "[&::-webkit-slider-thumb]:bg-signal [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-panel)]",
  "focus-visible:[&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--color-panel),0_0_0_4px_var(--color-on-panel)]",
  "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-line",
  "[&::-moz-range-progress]:h-1 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-signal",
  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-signal",
  "[&::-moz-range-thumb]:shadow-[0_0_0_2px_var(--color-panel)]",
  "focus-visible:[&::-moz-range-thumb]:shadow-[0_0_0_2px_var(--color-panel),0_0_0_4px_var(--color-on-panel)]",
].join(" ");

// `first` starts the track later than the warning, for a hazard that arrives hours after it.
export function ScenarioScrubber({
  minutes,
  last,
  onMinutes,
  label = "Hazard scenario",
  step = 1,
  first = 0,
}: {
  minutes: number;
  last: number;
  onMinutes: (minutes: number) => void;
  label?: string;
  step?: number;
  first?: number;
}) {
  const max = Math.max(last, first + 1);
  const filled = `${Math.min(100, Math.max(0, ((minutes - first) / (max - first)) * 100))}%`;
  return (
    <>
      <input
        type="range"
        min={first}
        max={max}
        step={step}
        value={minutes}
        onChange={(event) => onMinutes(Number(event.target.value))}
        className={SCRUBBER}
        style={{ "--filled": filled } as React.CSSProperties}
        aria-label={label}
        aria-valuetext={`${formatSinceWarning(minutes)} after the warning`}
      />
      <span className="type-small w-16 shrink-0 font-semibold tabular-nums" title="After the warning">
        {formatSinceWarning(minutes)}
      </span>
    </>
  );
}
