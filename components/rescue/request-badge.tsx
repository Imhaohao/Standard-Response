import { ReactNode } from "react";
import { Users, Van, Wheelchair } from "@phosphor-icons/react";
import { OpenRequest } from "./marks";

const WAITING: OpenRequest["status"][] = ["received", "approved", "reassigning"];
const VAN_COMING: OpenRequest["status"][] = ["driver_accepted", "en_route"];

export type NeedStage = "waiting" | "vanComing" | "pickedUp";

export function needStage(request: OpenRequest): NeedStage {
  if (WAITING.includes(request.status)) return "waiting";
  if (VAN_COMING.includes(request.status)) return "vanComing";
  return "pickedUp";
}

export const ESCALATION_SHORT: Record<NonNullable<OpenRequest["escalation"]>, string> = {
  address_unconfirmed: "Address?",
  medical: "Medical",
  flames: "Sees flames",
  hazard_at_home: "Danger at home",
  unservable: "No vehicle",
  language_barrier: "Language",
};

export function headCount(request: OpenRequest) {
  return request.load.seats + request.load.wheelchairSpaces + request.load.stretcherSpaces;
}

// The same badge the map draws: red while nobody is coming, ink once a driver said yes.
export function RequestBadge({ request }: { request: OpenRequest }) {
  const red = needStage(request) === "waiting" || Boolean(request.escalation);
  return (
    <span
      className={`type-figure grid size-8 shrink-0 place-items-center rounded-full text-base text-map-paper ${red ? "bg-signal" : "bg-map-ink"}`}
      role="img"
      aria-label={request.needsLift ? "Needs a wheelchair lift" : `${headCount(request)} people`}
    >
      {request.needsLift ? <Wheelchair weight="bold" className="size-[1.125rem]" /> : headCount(request)}
    </span>
  );
}

export function EscalationPill({ escalation }: { escalation: NonNullable<OpenRequest["escalation"]> }) {
  return <span className="type-small shrink-0 rounded-full bg-signal px-2 font-bold text-map-paper">{ESCALATION_SHORT[escalation]}</span>;
}

// A van chip, as on the map: ink when it has someone to fetch, hollow when it is free.
export function VanChip({ label, busy, title, children }: { label: string; busy: boolean; title?: string; children?: ReactNode }) {
  const look = busy ? "bg-map-ink text-map-paper" : "bg-map-paper text-map-ink ring-1 ring-map-ink";
  return (
    <span title={title} className={`type-small inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-bold ${look}`}>
      <Van weight="fill" className="size-3.5" />
      {label}
      {children}
    </span>
  );
}

export function CapacityIcons({ seats, wheelchairSpaces }: { seats: number; wheelchairSpaces: number }) {
  return (
    <span className="inline-flex items-center gap-1 font-semibold" aria-label={`${seats} seats, ${wheelchairSpaces} wheelchair spaces`}>
      {wheelchairSpaces > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <Wheelchair weight="bold" className="size-3.5" />
          {wheelchairSpaces}
        </span>
      )}
      <span className="inline-flex items-center gap-0.5">
        <Users weight="bold" className="size-3.5" />
        {seats}
      </span>
    </span>
  );
}
