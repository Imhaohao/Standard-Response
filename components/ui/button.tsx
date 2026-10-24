import { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  primary: "bg-ink text-canvas hover:bg-ink/88",
  quiet: "bg-surface-sunk text-ink hover:bg-line",
  onPanel: "bg-on-panel text-panel hover:bg-on-panel/88",
  onPanelQuiet: "bg-panel-raised text-on-panel hover:bg-panel-raised/80",
  onPaper: "bg-map-ink text-map-paper hover:bg-map-ink/88",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  const sizing = size === "lg" ? "h-14 px-6 text-base" : "h-11 px-4 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-xl font-bold whitespace-nowrap transition-[background-color,scale,opacity] duration-150 ease-[var(--ease-standard)] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-40 ${sizing} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
