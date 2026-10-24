const BAR_COUNT = 18;
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => ({
  delay: (i * 137) % 900,
  duration: 650 + ((i * 89) % 500),
  height: 0.35 + (((i * 53) % 10) / 10) * 0.65,
}));

// Bars move only while someone is talking. Agent turns are bright, resident turns are muted.
export function Waveform({ active, speaker }: { active: boolean; speaker: "agent" | "resident" | null }) {
  const tone = speaker === "resident" ? "bg-on-panel-muted" : "bg-on-panel";
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {BARS.map((bar, i) => (
        <span
          key={i}
          className={`w-[3px] origin-center rounded-full ${active ? `animate-wave ${tone}` : "bg-panel-raised"}`}
          style={{
            height: `${bar.height * 100}%`,
            transform: active ? undefined : "scaleY(0.18)",
            ["--wave-delay" as string]: `${bar.delay}ms`,
            ["--wave-duration" as string]: `${bar.duration}ms`,
          }}
        />
      ))}
    </div>
  );
}
