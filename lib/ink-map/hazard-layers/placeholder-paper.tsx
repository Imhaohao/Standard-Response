import { useId, useMemo } from "react";
import type { PaperHazardProps } from "./types";

// The flat map's stand-in for a hazard without its own drawing: the ground it has reached, hatched
// in `color`, with a firm line on its edge. `color` is a CSS colour, normally a --map-* token.
export function PlaceholderPaper({ trace, minutes, color, angle }: PaperHazardProps & { color: string; angle: number }) {
  const pattern = useId();
  const reached = useMemo(() => trace(minutes), [trace, minutes]);
  if (!reached) return null;
  return (
    <g>
      <defs>
        <pattern id={pattern} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform={`rotate(${angle})`}>
          <line x1={0} y1={0} x2={0} y2={7} stroke={color} strokeWidth={1.4} />
        </pattern>
      </defs>
      <path d={reached} fill={color} fillOpacity={0.12} />
      <path d={reached} fill={`url(#${pattern})`} fillOpacity={0.6} />
      <path d={reached} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </g>
  );
}
