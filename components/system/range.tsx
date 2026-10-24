import { ReactNode } from "react";

type TrackProps = { value: number; low: number; high: number; domain: [number, number]; zero?: number; large?: boolean };

// The line spans the range, the dot is the value.
export function RangeTrack({ value, low, high, domain, zero, large = false }: TrackProps) {
  const [d0, d1] = domain;
  const at = (x: number) => `${Math.min(100, Math.max(0, ((x - d0) / (d1 - d0)) * 100))}%`;
  return (
    <span className={`relative block ${large ? "h-6" : "h-4"}`} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-panel-raised" />
      {zero !== undefined && <span className="absolute inset-y-0 w-px bg-on-panel-muted" style={{ left: at(zero) }} />}
      <span className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-on-panel/45 ${large ? "h-2" : "h-1"}`} style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }} />
      <span
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-on-panel shadow-[0_0_0_2px_var(--panel)] ${large ? "size-4" : "size-3"}`}
        style={{ left: at(value) }}
      />
    </span>
  );
}

// Every simulator and evaluation number on this screen is drawn with its range, so a range is never left out.
export function RangeRow({
  label,
  readout,
  emphasis = false,
  ...track
}: TrackProps & { label: ReactNode; readout: string; emphasis?: boolean }) {
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5" title={readout}>
      <span className={`type-small truncate ${emphasis ? "font-bold" : "text-on-panel-muted"}`}>{label}</span>
      <RangeTrack {...track} />
      <span className={`type-small text-right tabular-nums ${emphasis ? "font-bold" : ""}`}>{readout}</span>
    </li>
  );
}

// A teammate-required caveat, kept visible as a chip.
export function Tag({ children }: { children: ReactNode }) {
  return <span className="type-small inline-flex w-fit items-center rounded-full bg-panel-raised px-2.5 py-0.5 text-on-panel-muted">{children}</span>;
}
