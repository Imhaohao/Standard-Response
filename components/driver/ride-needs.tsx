import { Bed, Elevator, FirstAid, Users, UsersThree, Wheelchair, type Icon } from "@phosphor-icons/react";
import { needsSummary } from "@/lib/labels";
import type { Stop } from "./stops";

type Need = { key: string; label: string; count?: number; Icon?: Icon; glyph?: string };

// A lift needs a second pair of hands, and that is the thing a driver most needs to know before
// agreeing.
function needsLifting(stop: Stop) {
  const rider = stop.rider;
  return Boolean(stop.needsLift || rider?.assistanceRequired === "two_person_lift" || rider?.mobility === "bedbound");
}

function needsOf(stop: Stop): Need[] {
  const load = stop.load ?? { seats: 0, wheelchairSpaces: 0, stretcherSpaces: 0 };
  const people = stop.rider?.peopleCount ?? load.seats;
  const crew = stop.crewNeeded ?? 1;
  const medical = stop.rider?.medical ?? [];
  const candidates: (Need | false)[] = [
    { key: "people", label: people === 1 ? "person" : "people", count: people, Icon: Users },
    load.wheelchairSpaces > 0 && { key: "wheelchair", label: "wheelchair", count: load.wheelchairSpaces, Icon: Wheelchair },
    load.stretcherSpaces > 0 && { key: "stretcher", label: "stretcher", count: load.stretcherSpaces, Icon: Bed },
    crew > 1 && { key: "crew", label: "crew", count: crew, Icon: UsersThree },
    needsLifting(stop) && { key: "lift", label: "lift", Icon: Elevator },
    medical.includes("oxygen") && { key: "oxygen", label: "oxygen", glyph: "O₂" },
    medical.some((need) => need !== "oxygen") && { key: "medical", label: "medical", Icon: FirstAid },
  ];
  return candidates.filter((need): need is Need => Boolean(need));
}

function NeedTile({ need, large }: { need: Need; large: boolean }) {
  const { Icon, glyph, count, label } = need;
  return (
    <li className={`flex flex-col items-center justify-center gap-1 bg-panel-raised ${large ? "min-h-20 min-w-24 px-3 py-2.5" : "min-h-12 min-w-16 px-2 py-1.5"}`}>
      <span className="flex items-center gap-1.5">
        {Icon ? <Icon weight="bold" className={large ? "size-7" : "size-5"} /> : <span className={`type-figure ${large ? "text-2xl" : "text-lg"}`}>{glyph}</span>}
        {count !== undefined && <span className={`type-figure ${large ? "text-3xl" : "text-xl"}`}>{count}</span>}
      </span>
      <span className="type-small text-on-panel-muted">{label}</span>
    </li>
  );
}

// Who is getting in the van, read at arm's length: a glyph and a count per need, no sentences.
export function RideNeeds({ stop, large = true }: { stop: Stop; large?: boolean }) {
  return (
    <ul className="flex flex-wrap gap-1" aria-label={stop.load ? `Needs ${needsSummary(stop.load, stop.crewNeeded ?? 1)}` : undefined}>
      {needsOf(stop).map((need) => (
        <NeedTile key={need.key} need={need} large={large} />
      ))}
    </ul>
  );
}
