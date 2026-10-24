import { ReactNode } from "react";

// Label-and-number rows for the dark panels, in the same rhythm as the rescue map's panels.
export function Figures({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-1 px-3 py-2">{children}</dl>;
}

export function Figure({ label, value, tone, hint }: { label: string; value: ReactNode; tone?: "signal"; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-small min-w-0 text-on-panel-muted">
        {label}
        {hint && <span className="block text-[0.75rem] leading-tight opacity-80">{hint}</span>}
      </dt>
      <dd className={`type-small shrink-0 font-semibold tabular-nums ${tone === "signal" ? "text-signal" : ""}`}>{value}</dd>
    </div>
  );
}

export type Range = { median: number | null; p5: number | null; p95: number | null; n: number };

export function formatRange(range: Range | undefined, digits = 0, scale = 1) {
  if (!range || range.median === null) return "—";
  const f = (x: number | null) => (x === null ? "—" : (x * scale).toFixed(digits));
  return range.n > 1 ? `${f(range.median)} (${f(range.p5)} to ${f(range.p95)})` : f(range.median);
}
