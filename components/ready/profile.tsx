"use client";

import { Bed, Brain, Car, Dog, EarSlash, EyeSlash, Handshake, Person, PersonSimpleWalk, Plug, Van, Wheelchair, WheelchairMotion, type Icon } from "@phosphor-icons/react";
import { Doc } from "@/convex/_generated/dataModel";

// The Ready check profile, drawn. The rescue map's house card, the driver page and the resident's
// sign-up page all show the same glyphs and the same little house, so a crew learns them once.

export type ReadyProfile = NonNullable<Doc<"households">["ready"]>;
export type CareNeed = ReadyProfile["care"][number];
export type Bedroom = NonNullable<ReadyProfile["bedroom"]>;
export type Floor = Bedroom["floor"];
export type Side = NonNullable<Bedroom["side"]>;
export type ExitPlan = ReadyProfile["exitPlan"];
export type Mobility = NonNullable<Doc<"households">["mobility"]>;
export type Assistance = NonNullable<Doc<"households">["assistanceRequired"]>;

type Option<K extends string> = { key: K; label: string; Icon: Icon };

export const CARE_OPTIONS: Option<CareNeed>[] = [
  { key: "hearing", label: "Hard of hearing", Icon: EarSlash },
  { key: "sight", label: "Low vision", Icon: EyeSlash },
  { key: "memory", label: "Memory loss", Icon: Brain },
  { key: "power_device", label: "Powered device", Icon: Plug },
  { key: "service_animal", label: "Service animal", Icon: Dog },
];

export const MOBILITY_OPTIONS: Option<Mobility>[] = [
  { key: "walks", label: "Walks", Icon: PersonSimpleWalk },
  { key: "walker", label: "Walker", Icon: Person },
  { key: "manual_wheelchair", label: "Manual chair", Icon: Wheelchair },
  { key: "power_wheelchair", label: "Power chair", Icon: WheelchairMotion },
  { key: "bedbound", label: "In bed", Icon: Bed },
];

export const EXIT_OPTIONS: Option<ExitPlan>[] = [
  { key: "own_car", label: "Own car", Icon: Car },
  { key: "helper", label: "Someone picks them up", Icon: Handshake },
  { key: "needs_ride", label: "Needs a ride", Icon: Van },
];

export const ASSIST_LABELS: Record<Assistance, string> = {
  none: "No help",
  one_person_assist: "One helper",
  two_person_lift: "Two to lift",
};

const FLOORS: { key: Floor; label: string }[] = [
  { key: "upstairs", label: "Upstairs" },
  { key: "ground", label: "Ground" },
  { key: "basement", label: "Basement" },
];
const SIDES: { key: Side; label: string }[] = [
  { key: "front", label: "Front" },
  { key: "back", label: "Back" },
];

export function bedroomLabel(bedroom: Bedroom) {
  const floor = FLOORS.find((f) => f.key === bedroom.floor)?.label ?? "";
  const side = bedroom.side ? `, ${bedroom.side}` : "";
  return `${floor} floor${side}`.replace("Basement floor", "Basement");
}

type CellProps = { floor: Floor; side: Side; chosen: boolean; large: boolean; onPick?: (bedroom: Bedroom) => void };

function Cell({ floor, side, chosen, large, onPick }: CellProps) {
  const tone = chosen ? "bg-ink text-canvas" : floor === "basement" ? "bg-surface-sunk" : "bg-surface";
  const shape = `grid place-items-center ${large ? "h-16" : "h-7"} ${tone}`;
  const glyph = chosen && <Bed weight="fill" className={large ? "size-8" : "size-4"} />;
  if (!onPick) return <span className={shape}>{glyph}</span>;
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={`${FLOORS.find((f) => f.key === floor)?.label} floor, ${side}`}
      onClick={() => onPick({ floor, side })}
      className={`${shape} transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${chosen ? "" : "hover:bg-line"}`}
    >
      {glyph}
    </button>
  );
}

// A house cut in half: roof, upstairs, ground floor and basement below the street, front on the
// left. The room where the person who needs help sleeps is filled in.
export function BedroomDiagram({ bedroom, onPick, large = false }: { bedroom?: Bedroom; onPick?: (bedroom: Bedroom) => void; large?: boolean }) {
  const width = large ? "w-56" : "w-24";
  return (
    <figure className={`flex shrink-0 flex-col ${width}`} aria-label={bedroom ? `Sleeps: ${bedroomLabel(bedroom)}` : "Where they sleep isn't on file"}>
      <svg viewBox="0 0 100 34" className="block w-full" aria-hidden>
        <path d="M 2 34 L 50 3 L 98 34 Z" fill="var(--ink)" />
      </svg>
      <div className="grid grid-cols-2 gap-px bg-ink p-px">
        {FLOORS.map((floor) => (
          <div key={floor.key} className={`contents ${floor.key === "basement" ? "[&>*]:mt-1" : ""}`}>
            {SIDES.map((side) => (
              <Cell
                key={side.key}
                floor={floor.key}
                side={side.key}
                chosen={bedroom?.floor === floor.key && (bedroom.side ?? "front") === side.key}
                large={large}
                onPick={onPick}
              />
            ))}
          </div>
        ))}
      </div>
      {large && (
        <figcaption className="type-small mt-1.5 grid grid-cols-2 text-center text-ink-muted">
          <span>Front</span>
          <span>Back</span>
        </figcaption>
      )}
    </figure>
  );
}

export function CareChips({ care, className = "" }: { care: CareNeed[]; className?: string }) {
  if (care.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {CARE_OPTIONS.filter((option) => care.includes(option.key)).map(({ key, label, Icon }) => (
        <li key={key} className="type-small flex items-center gap-1.5 rounded-lg bg-panel-raised px-2 py-1 font-semibold">
          <Icon weight="bold" className="size-4" />
          {label}
        </li>
      ))}
    </ul>
  );
}

// What a crew reads before going in: where to find the person, what else to expect, and the note.
export function InsideFacts({ ready }: { ready: ReadyProfile }) {
  return (
    <div className="flex items-start gap-3">
      <BedroomDiagram bedroom={ready.bedroom} />
      <div className="flex min-w-0 flex-col gap-1.5">
        {ready.bedroom && <p className="type-heading">{bedroomLabel(ready.bedroom)}</p>}
        <CareChips care={ready.care} />
        {ready.note && <p className="type-small text-on-panel-muted">“{ready.note}”</p>}
      </div>
    </div>
  );
}
