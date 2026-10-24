import { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-ink text-canvas hover:bg-ink/88",
  quiet: "bg-surface-sunk text-ink hover:bg-line",
  onPanel: "bg-on-panel text-panel hover:bg-on-panel/88",
  onPanelQuiet: "bg-panel-raised text-on-panel hover:bg-panel-raised/80",
  onPaper: "bg-map-ink text-map-paper hover:bg-map-ink/88",
} as const;

// sm is the dense control inside panels and bars; md is a form action; lg is a phone page's main action.
const SIZES = {
  sm: { box: "h-8 rounded-lg text-sm", padding: "px-3", square: "w-8" },
  md: { box: "h-11 rounded-xl text-sm", padding: "px-4", square: "w-11" },
  lg: { box: "h-14 rounded-xl text-base", padding: "px-6", square: "w-14" },
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  square?: boolean;
};

export function Button({ variant = "primary", size = "md", square = false, className = "", ...props }: ButtonProps) {
  const sizing = SIZES[size];
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 select-none items-center justify-center gap-2 font-bold whitespace-nowrap transition-[background-color,scale,opacity] duration-150 ease-[var(--ease-standard)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-40 ${sizing.box} ${square ? sizing.square : sizing.padding} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
