import { useMemo } from "react";
import type { PaperHazardProps } from "../types";

const STILL_BURNING_MINUTES = 15;
const AHEAD_MINUTES = 30;

// The fire at the minute on the clock, traced from the same arrival times the 3D map shades: all the
// ground it has reached in fire colour, a shade deeper behind the last quarter hour, a firm red line
// on the edge, and a dashed line where it will be in half an hour. A hazard that doesn't burn leaves
// grey ground instead.
export function FirePaper({ trace, burns, minutes }: PaperHazardProps) {
  const outlines = useMemo(
    () => ({ edge: trace(minutes), cooled: trace(minutes - STILL_BURNING_MINUTES), ahead: trace(minutes + AHEAD_MINUTES) }),
    [trace, minutes],
  );
  if (!outlines.edge) return <path d={outlines.ahead} fill="none" stroke="var(--signal)" strokeWidth={1.4} strokeDasharray="6 5" />;
  return (
    <g>
      {burns ? (
        <>
          <path d={outlines.edge} fill="var(--ember)" fillOpacity={0.55} />
          <path d={outlines.cooled} fill="var(--signal)" fillOpacity={0.22} />
        </>
      ) : (
        <path d={outlines.edge} fill="var(--map-ink)" fillOpacity={0.22} />
      )}
      <path d={outlines.ahead} fill="none" stroke="var(--signal)" strokeWidth={1.4} strokeDasharray="6 5" />
      <path d={outlines.edge} fill="none" stroke="var(--signal)" strokeWidth={2.4} strokeLinejoin="round" />
    </g>
  );
}
