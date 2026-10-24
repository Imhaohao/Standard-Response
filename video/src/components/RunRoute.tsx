import { useMemo } from "react";
import { useCurrentFrame } from "remotion";
import type { Run } from "../data/scene";
import { cumulative, distanceTo, pathD, pointAt, progress } from "../geometry";
import { color, ease } from "../theme";
import { useZoom } from "./Camera";
import { Pin } from "./MapPieces";

type Props = { run: Run; id: string; draw: [number, number]; committedAt?: number; opacity?: number; drive?: [number, number, number] };

// A van's run along real streets: dashed while it is only an offer, solid once a driver accepts.
// The line draws itself out from the van and each pickup pops as the line reaches it.
export function RunRoute({ run, id, draw, committedAt, opacity = 1, drive }: Props) {
  const frame = useCurrentFrame();
  const zoom = useZoom();
  const lengths = useMemo(() => cumulative(run.path), [run.path]);
  const total = lengths[lengths.length - 1];
  const stopDistances = useMemo(() => run.stops.map((stop) => distanceTo(run.path, lengths, stop.at)), [run, lengths]);
  const drawn = progress(frame, draw[0], draw[1], ease.inOut) * total;
  const solid = committedAt === undefined ? 0 : progress(frame, committedAt, committedAt + 12, ease.standard);
  const d = pathD(run.path);
  const dash = 8 / zoom;
  const vanAt = drive ? pointAt(run.path, lengths, progress(frame, drive[0], drive[1], ease.inOut) * total * drive[2]) : null;
  return (
    <g opacity={opacity}>
      <mask id={id} maskUnits="userSpaceOnUse">
        <path d={d} fill="none" stroke="white" strokeWidth={12 / zoom} strokeDasharray={`${drawn} ${total + 1}`} strokeLinecap="round" strokeLinejoin="round" />
      </mask>
      <g mask={`url(#${id})`}>
        <path d={d} fill="none" stroke={color.mapPaper} strokeWidth={7 / zoom} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke={color.mapInk} strokeWidth={2.8 / zoom} strokeDasharray={`${dash} ${dash * 0.8}`} strokeDashoffset={-frame * 0.6 / zoom} opacity={1 - solid} />
        <path d={d} fill="none" stroke={color.mapInk} strokeWidth={4.2 / zoom} strokeLinecap="round" strokeLinejoin="round" opacity={solid} />
      </g>
      {run.stops.map((stop, i) => {
        const reached = Math.min(1, Math.max(0, (drawn - stopDistances[i]) / (40 / zoom)));
        return <Pin key={i} at={stop.at} lift={stop.lift} scale={reached > 0 ? ease.overshoot(reached) : 0} />;
      })}
      {vanAt && (
        <g transform={`translate(${vanAt[0]} ${vanAt[1]}) scale(${2.2 / zoom})`}>
          <rect x={-12} y={-8.5} width={24} height={17} fill={color.mapPaper} />
          <rect x={-10.5} y={-7} width={21} height={14} fill={color.mapInk} />
        </g>
      )}
    </g>
  );
}
