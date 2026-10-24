import { ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { progress } from "../geometry";
import { color, ease, SAFE, type } from "../theme";

type Props = { words: string; start: number; end: number; lead?: ReactNode; size?: number; align?: "start" | "center"; tone?: "panel" | "bare" };

function Word({ word, index, start, end }: { word: string; index: number; start: number; end: number }) {
  const frame = useCurrentFrame();
  const rise = progress(frame, start + 6 + index * 3, start + 24 + index * 3);
  const fall = progress(frame, end - 10, end, ease.standard);
  return (
    <span style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.08em", marginBottom: "-0.08em", verticalAlign: "top" }}>
      <span style={{ display: "inline-block", translate: `0 ${(1 - rise) * 110 - fall * 40}%`, opacity: 1 - fall }}>{word}</span>
    </span>
  );
}

// The one line of copy a frame gets: a panel wipes open, then the words rise into it.
export function Headline({ words, start, end, lead, size = 92, align = "start", tone = "panel" }: Props) {
  const frame = useCurrentFrame();
  const open = progress(frame, start, start + 16, ease.inOut);
  const close = progress(frame, end - 8, end + 4, ease.inOut);
  if (frame < start || frame > end + 4) return null;
  const panel = tone === "panel";
  return (
    <AbsoluteFill style={{ padding: SAFE, justifyContent: align === "center" ? "center" : "flex-end", alignItems: align === "center" ? "center" : "flex-start" }}>
      <div
        style={{
          background: panel ? color.panel : "transparent",
          color: color.onPanel,
          padding: panel ? "30px 44px 36px" : 0,
          clipPath: `inset(0 ${(1 - open) * 100}% 0 ${close * 100}%)`,
          display: "flex",
          flexDirection: "column",
          gap: 18,
          alignItems: align === "center" ? "center" : "flex-start",
          maxWidth: 1700,
        }}
      >
        {lead && <div style={{ opacity: interpolate(open, [0.5, 1], [0, 1], { extrapolateLeft: "clamp" }) }}>{lead}</div>}
        <div style={{ ...type.display, fontSize: size, display: "flex", flexWrap: "wrap", columnGap: "0.24em", rowGap: 6, justifyContent: align === "center" ? "center" : "flex-start" }}>
          {words.split(" ").map((word, index) => (
            <Word key={index} word={word} index={index} start={start} end={end} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}
