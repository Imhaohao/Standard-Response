"use client";

import { Minus, Plus, type Icon } from "@phosphor-icons/react";
import { ConvexError } from "convex/values";
import { ReactNode } from "react";

// The kiosk is a touch screen judges walk up to, and the phone page is held in one hand, so every
// control here is at least 44px tall. Selected is filled ink; unselected sits on the sunk surface.

export const FIELD =
  "type-body h-12 w-full min-w-0 rounded-xl border border-line-strong bg-surface px-3.5 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

const CHOICE = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 font-semibold transition-[background-color,color,scale] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const choiceTone = (selected: boolean) => (selected ? "bg-ink text-canvas" : "bg-surface-sunk text-ink hover:bg-line");

export const failureText = (failure: unknown, fallback: string) => (failure instanceof ConvexError ? String(failure.data) : fallback);

export function Question({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="type-small mb-2 font-semibold text-ink-muted">{label}</legend>
      {children}
    </fieldset>
  );
}

type Option<Value extends string> = { value: Value; label: string; Icon?: Icon };

// One of a few answers, as a row of buttons that read as a single control.
export function OneOf<Value extends string>({ options, value, onChange }: { options: readonly Option<Value>[]; value: Value; onChange: (value: Value) => void }) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-surface-sunk p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button key={option.value} type="button" aria-pressed={selected} onClick={() => onChange(option.value)} className={`type-small ${CHOICE} ${selected ? "bg-ink text-canvas shadow-float" : "text-ink hover:bg-surface"}`}>
            {option.Icon && <option.Icon weight={selected ? "fill" : "bold"} className="size-5 shrink-0" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// A yes-or-no fact that is off until tapped, like "has pets". On, the tile turns ink and its icon
// fills in, so on and off differ by more than color.
export function Toggle({ label, on, onChange, Icon }: { label: string; on: boolean; onChange: (on: boolean) => void; Icon: Icon }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={`type-small ${CHOICE} ${choiceTone(on)}`}>
      <Icon weight={on ? "fill" : "bold"} className="size-5 shrink-0" />
      {label}
    </button>
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (value: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-surface-sunk p-1">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className={`${CHOICE} size-11 bg-surface text-ink disabled:opacity-40`}>
        <Minus weight="bold" className="size-5" />
      </button>
      <output aria-live="polite" aria-label={label} className="type-figure min-w-12 flex-1 text-center text-3xl tabular-nums">
        {value}
      </output>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className={`${CHOICE} size-11 bg-surface text-ink disabled:opacity-40`}>
        <Plus weight="bold" className="size-5" />
      </button>
    </div>
  );
}
