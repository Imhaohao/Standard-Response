import { Doc } from "@/convex/_generated/dataModel";

type Home = Pick<Doc<"households">, "outcome" | "callStatus">;

// What a household looks like everywhere on the call floor: on the map, in the reach chart and in
// the legend. Red is someone who needs a ride; everything else is told apart by shape and tone.
export type HomeKind = "needs_accessible" | "needs_ride" | "on_phone" | "leaving" | "unreachable" | "waiting";

export const HOME_KINDS: { kind: HomeKind; label: string }[] = [
  { kind: "needs_accessible", label: "Needs accessible van" },
  { kind: "needs_ride", label: "Needs a ride" },
  { kind: "on_phone", label: "On the phone now" },
  { kind: "leaving", label: "Leaving on their own" },
  { kind: "unreachable", label: "Unreachable" },
  { kind: "waiting", label: "No answer yet" },
];

export function homeKind(home: Home): HomeKind {
  if (home.callStatus === "in_call") return "on_phone";
  if (home.outcome === "unknown") return "waiting";
  return home.outcome;
}

export type MarkTone = { ink: string; paper: string; signal: string };

export const MAP_TONE: MarkTone = { ink: "var(--map-ink)", paper: "var(--map-paper)", signal: "var(--signal)" };
export const PANEL_TONE: MarkTone = { ink: "var(--on-panel)", paper: "var(--panel)", signal: "var(--signal)" };

// Drawn around 0,0 at radius r, so the same mark sits on a roof or in a chart cell.
// In a dense chart "no answer yet" is a faint dot, so the answers stand out from the empty cells.
export function HomeMark({ kind, r, tone, quiet = false }: { kind: HomeKind; r: number; tone: MarkTone; quiet?: boolean }) {
  const { ink, paper, signal } = tone;
  if (quiet && kind === "waiting") return <circle r={r * 0.3} fill={ink} fillOpacity={0.35} />;
  switch (kind) {
    case "needs_accessible":
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} fill={signal} stroke={paper} strokeWidth={r * 0.35} />;
    case "needs_ride":
      return <circle r={r} fill={signal} stroke={paper} strokeWidth={r * 0.35} />;
    case "on_phone":
      return (
        <>
          <circle r={r} fill={ink} stroke={paper} strokeWidth={r * 0.35} />
          <circle r={r * 0.4} fill={paper} />
        </>
      );
    case "leaving":
      return <circle r={r * 0.6} fill={ink} fillOpacity={0.45} />;
    case "unreachable":
      return (
        <path
          d={`M${-r * 0.75} ${-r * 0.75}L${r * 0.75} ${r * 0.75}M${r * 0.75} ${-r * 0.75}L${-r * 0.75} ${r * 0.75}`}
          stroke={ink}
          strokeWidth={r * 0.45}
          strokeLinecap="round"
        />
      );
    case "waiting":
      return <circle r={r * 0.8} fill={paper} stroke={ink} strokeOpacity={0.85} strokeWidth={r * 0.35} />;
  }
}
