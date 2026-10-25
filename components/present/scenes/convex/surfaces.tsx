import { Check, Headset, PhoneCall } from "@phosphor-icons/react";

// Simplified drawings of the four product surfaces that read and write the one database.

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex size-full flex-col gap-3 rounded-[36px] bg-night-raised p-3 shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
      <span className="mx-auto h-1.5 w-16 shrink-0 rounded-full bg-on-night/15" />
      <div className="flex flex-1 flex-col gap-3 overflow-hidden rounded-[26px] bg-night px-4 py-5">{children}</div>
    </div>
  );
}

function Bubble({ width, ours }: { width: number; ours: boolean }) {
  return <span className={`block h-7 rounded-2xl ${ours ? "self-start bg-on-night/15" : "self-end bg-on-night/35"}`} style={{ width }} />;
}

export function CallScreen() {
  return (
    <PhoneFrame>
      <span className="flex items-center gap-2 text-on-night">
        <PhoneCall size={26} weight="fill" aria-hidden />
        <span className="type-deck-note font-semibold">Roseland</span>
      </span>
      <Bubble width={130} ours />
      <Bubble width={90} ours={false} />
      <Bubble width={150} ours />
      <Bubble width={70} ours={false} />
      <Bubble width={110} ours />
    </PhoneFrame>
  );
}

export function DriverPhone() {
  return (
    <PhoneFrame>
      <span className="type-deck-note font-semibold text-on-night">Pickup offer</span>
      <span className="mt-auto flex items-baseline gap-2 text-on-night">
        <span className="type-deck-title leading-none">6</span>
        <span className="type-deck-note">min</span>
      </span>
      <span className="block h-3 w-28 rounded-full bg-on-night/15" />
      <span className="flex h-14 items-center justify-center rounded-2xl bg-on-night text-night">
        <Check size={30} weight="bold" aria-hidden />
      </span>
    </PhoneFrame>
  );
}

const STREETS = [
  "M0 60 L440 40",
  "M0 150 L440 132",
  "M0 240 L440 226",
  "M70 0 L96 340",
  "M190 0 L208 340",
  "M310 0 L322 340",
];
const HOMES: { x: number; y: number; tone: string }[] = [
  { x: 120, y: 96, tone: "var(--signal)" },
  { x: 260, y: 186, tone: "var(--ride)" },
  { x: 360, y: 90, tone: "var(--leaving)" },
  { x: 150, y: 280, tone: "var(--leaving)" },
  { x: 380, y: 270, tone: "var(--unknown)" },
  { x: 40, y: 200, tone: "var(--unknown)" },
];

export function RescueMap() {
  return (
    <div className="relative size-full overflow-hidden rounded-[32px] bg-night-raised shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
      <svg viewBox="0 0 440 340" className="absolute inset-0 size-full" aria-hidden>
        {STREETS.map((d) => (
          <path key={d} d={d} stroke="var(--on-night-muted)" strokeOpacity={0.3} strokeWidth={6} />
        ))}
        <path d="M260 186 L254 140 L200 136 L196 96 L120 96" fill="none" stroke="var(--on-night)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
        {HOMES.map((home) => (
          <circle key={`${home.x}-${home.y}`} cx={home.x} cy={home.y} r={12} fill={home.tone} stroke="var(--night-raised)" strokeWidth={5} />
        ))}
      </svg>
    </div>
  );
}

const LINES = [0.7, 0.45, 0.85, 0.55, 0.65];

export function CallFloor() {
  return (
    <div className="flex size-full flex-col gap-2 overflow-hidden rounded-[32px] bg-night-raised p-5 shadow-[0_30px_80px_oklch(0_0_0/0.45)]">
      <span className="mb-1 flex items-center gap-2 text-on-night">
        <Headset size={28} weight="bold" aria-hidden />
        <span className="type-deck-note font-semibold">Call floor</span>
      </span>
      {LINES.map((share, i) => (
        <span key={i} className="flex h-11 items-center gap-3 rounded-xl bg-night/60 px-3">
          <PhoneCall size={20} weight="fill" className="shrink-0 text-on-night-muted" aria-hidden />
          <span className="block h-2.5 rounded-full bg-on-night/25" style={{ width: `${share * 60}%` }} />
          <Waveform seed={i} />
        </span>
      ))}
    </div>
  );
}

function Waveform({ seed }: { seed: number }) {
  return (
    <span className="ml-auto flex h-5 items-center gap-[3px]">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="block w-[3px] rounded-full bg-on-night/50" style={{ height: `${30 + (((i + 1) * (seed + 3) * 37) % 70)}%` }} />
      ))}
    </span>
  );
}
