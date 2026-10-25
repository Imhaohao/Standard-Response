// Phosphor's FireSimple (fill) on its 256 grid, shrunk to the lower left so two call arcs fit above it.
const FLAME =
  "M143.38,17.85a8,8,0,0,0-12.63,3.41l-22,60.41L84.59,58.26a8,8,0,0,0-11.93.89C51,87.53,40,116.08,40,144a88,88,0,0,0,176,0C216,84.55,165.21,36,143.38,17.85Z";
const ARCS = ["M146,62A62,62,0,0,1,208,124", "M146,18A106,106,0,0,1,252,124"];

// The product mark: a flame giving off a phone's call arcs, so the fire itself is calling.
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={`shrink-0 overflow-visible text-signal ${className}`} aria-hidden>
      <path d={FLAME} fill="currentColor" transform="translate(-2 66) scale(0.75)" />
      {ARCS.map((arc) => (
        <path key={arc} d={arc} fill="none" stroke="currentColor" strokeWidth={22} strokeLinecap="round" />
      ))}
    </svg>
  );
}
