import { ReactNode } from "react";

// A value and its range on one track: the line spans the range, the dot is the value. Every
// simulator and evaluation number on this screen is drawn this way, so a range is never left out.
export function RangeRow({
  label,
  value,
  low,
  high,
  domain,
  readout,
  emphasis = false,
  zero,
}: {
  label: ReactNode;
  value: number;
  low: number;
  high: number;
  domain: [number, number];
  readout: string;
  emphasis?: boolean;
  zero?: number;
}) {
  const [d0, d1] = domain;
  const at = (x: number) => `${Math.min(100, Math.max(0, ((x - d0) / (d1 - d0)) * 100))}%`;
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5" title={readout}>
      <span className={`type-small truncate ${emphasis ? "font-bold" : "text-on-panel-muted"}`}>{label}</span>
      <span className="relative h-4" aria-hidden>
        <span className="absolute inset-x-0 top-1/2 h-px bg-panel-raised" />
        {zero !== undefined && <span className="absolute inset-y-0 w-px bg-on-panel-muted" style={{ left: at(zero) }} />}
        <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-on-panel/45" style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
        <span
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-panel shadow-[0_0_0_2px_var(--panel)] ${emphasis ? "size-3" : "size-2"}`}
          style={{ left: at(value) }}
        />
      </span>
      <span className={`type-small text-right tabular-nums ${emphasis ? "font-bold" : ""}`}>{readout}</span>
    </li>
  );
}

// The headline number of a panel, with the unit and range beside it in the body size.
export function Figure({ value, unit, note }: { value: string; unit?: string; note?: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="type-figure text-4xl">{value}</span>
      {unit && <span className="type-body text-on-panel-muted">{unit}</span>}
      {note && <span className="type-small text-on-panel-muted">{note}</span>}
    </p>
  );
}

// The source label each team asked to keep visible next to its numbers.
export function SourceLabel({ children }: { children: ReactNode }) {
  return <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">{children}</p>;
}
