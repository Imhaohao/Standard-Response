import { CaretDown } from "@phosphor-icons/react";
import { ReactNode } from "react";
import { DEFAULT_CROWD } from "@/lib/crowd/langevin";
import { DEFAULT_DEPARTURE } from "@/lib/crowd/departure";
import { DEFAULT_TRAINING, FEATURE_NAMES, UPLOAD_MIN_MASS } from "@/lib/mesh/federated";
import { ROUND_MASS } from "@/lib/mesh/rounds";

// The technologies behind the mesh add-on's screens, named the same way everywhere they appear:
// a tag on every panel that uses one, and a "How it works" note that says what it does.

export type Technology = "langevin" | "departure" | "federated" | "mesh";

// Also used by the readiness survey add-on (components/prepare/technology.tsx) for its own entries.
export type Entry = { name: string; summary: string; equation?: string; points: string[] };

const FEATURES = FEATURE_NAMES.filter((name) => name !== "bias").map((name) => name.replaceAll("_", " "));

export const TECHNOLOGIES: Record<Technology, Entry> = {
  langevin: {
    name: "Langevin dynamics",
    summary:
      "Every evacuating car is a particle on the real street map. It steers toward the next point on its route, slows down when cars bunch up, keeps its distance from the cars around it, and jitters a little, the way real drivers hesitate and differ.",
    equation: "dx = v dt\ndv = [ (v_des − v) / τ + F_rep ] dt\n     + √(2T / τ) dW",
    points: [
      `v_des is the speed the driver wants: the street's free-flow speed, cut as the cars around get denser (Greenshields: v_free (1 − ρ / ρ_jam), jam at ${DEFAULT_CROWD.jamDensity} cars per m²).`,
      `τ = ${DEFAULT_CROWD.tau} s is how quickly a driver gets to that speed. F_rep is a soft push between cars a few metres apart (Helbing and Molnár's social force).`,
      `dW is random noise of strength T = ${DEFAULT_CROWD.temperature} m²/s²: hesitation and the spread in how people drive.`,
      "Routes are the fastest way to safety on open streets, avoiding the fire and any street the driver knows is blocked. A car that hits a blocked street it didn't know about stops, turns back and re-routes.",
      `Stepped every ${DEFAULT_CROWD.dt} s with BAOAB splitting, which solves the friction and noise exactly so the steps stay stable.`,
    ],
  },
  departure: {
    name: "Drift-diffusion",
    summary:
      "When each household leaves. A household's urge to go builds up over time, faster as the fire gets close, with random ups and downs; it leaves when the urge reaches a threshold.",
    equation: "dX = μ(t) dt + σ dW,  leave when X ≥ 1",
    points: [
      `Two kinds of household, as in UC Berkeley's survey of California wildfire evacuees: ${Math.round(DEFAULT_DEPARTURE.keenShare * 100)}% keen to leave (about ${Math.round(1 / DEFAULT_DEPARTURE.keenDrift)} minutes after the warning), the rest reluctant (about ${Math.round(1 / DEFAULT_DEPARTURE.reluctantDrift)} minutes).`,
      "The drift μ rises as the fire nears, standing in for seeing smoke or hearing from neighbours.",
      "Households that can't leave without help never leave on their own. They are shown in red, and they are who the dispatch side of the app is for.",
    ],
  },
  federated: {
    name: "Federated learning",
    summary:
      "Phones together train a model of which streets are likely blocked, without anyone sending what they saw. Only a noised change to the model leaves a phone, and only mixed with other phones' changes.",
    points: [
      `Each phone learns from the streets it drives or sees from home, blocked or open, using ${FEATURES.join(", ")}.`,
      `On the phone, its change to the model is clipped and noise is added (differential privacy). ε is the most any one phone can give away over at most ${DEFAULT_TRAINING.maxContributions} updates.`,
      `When phones meet, they add their noised changes together. The agency accepts a mix only once it holds at least ${UPLOAD_MIN_MASS} phones' worth, so no single phone's change is ever seen.`,
      `Every ${ROUND_MASS} phones' worth of updates makes a new version of the shared model, which phones pick up when they next connect or meet.`,
    ],
  },
  mesh: {
    name: "Phone mesh",
    summary:
      "Road reports pass from phone to phone over short-range radio with no internet, and reach the agency when any phone carrying them gets a connection.",
    points: [
      "A report is a street, blocked or open, and the minute. There is no phone, person or uploader id in it.",
      "Phones that meet swap the reports the other doesn't have yet. The same report arriving twice counts once.",
      "A street's status is a vote of recent reports, newer ones counting more, so a reopened street reads as open.",
    ],
  },
};

// The label on a panel: which technologies it runs on.
export function TechTags({ uses, className = "px-3 pb-1" }: { uses: Technology[]; className?: string }) {
  return <EntryTags entries={uses.map((tech) => TECHNOLOGIES[tech])} className={className} />;
}

export function EntryTags({ entries, className = "px-3 pb-1" }: { entries: Entry[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-1 ${className}`} aria-label="Technology">
      {entries.map((entry) => (
        <li key={entry.name} title={entry.summary} className="rounded-full bg-panel-raised px-2 py-0.5 text-[0.75rem] font-semibold leading-tight text-on-panel">
          {entry.name}
        </li>
      ))}
    </ul>
  );
}

function Explanation({ entry, children }: { entry: Entry; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="type-small">{entry.summary}</p>
      {children && <div className="type-small font-semibold">{children}</div>}
      {entry.equation && <pre className="whitespace-pre-wrap rounded-lg bg-panel-raised px-2 py-1.5 font-mono text-[0.75rem] leading-snug">{entry.equation}</pre>}
      <ul className="flex list-disc flex-col gap-1 pl-4">
        {entry.points.map((point) => (
          <li key={point} className="type-small text-on-panel-muted">
            {point}
          </li>
        ))}
      </ul>
    </div>
  );
}

// "How it works", folded away under a panel. `children` says what this panel uses it for.
export function HowItWorks({ tech, open = false, inset = "px-3", children }: { tech: Technology; open?: boolean; inset?: string; children?: ReactNode }) {
  return (
    <EntryHowItWorks entry={TECHNOLOGIES[tech]} open={open} inset={inset}>
      {children}
    </EntryHowItWorks>
  );
}

export function EntryHowItWorks({ entry, open = false, inset = "px-3", children }: { entry: Entry; open?: boolean; inset?: string; children?: ReactNode }) {
  return (
    <details open={open} className="group border-t border-panel-raised">
      <summary className={`type-small flex cursor-pointer list-none items-center justify-between gap-2 py-2 ${inset} font-semibold hover:bg-panel-raised/50 [&::-webkit-details-marker]:hidden`}>
        How it works: {entry.name}
        <CaretDown weight="bold" className="size-3.5 shrink-0 text-on-panel-muted transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <div className={`pb-3 ${inset}`}>
        <Explanation entry={entry}>{children}</Explanation>
      </div>
    </details>
  );
}
