"use client";

import { ReactNode, useState } from "react";
import { CaretDown, Check, Flame, Info, Phone } from "@phosphor-icons/react";
import { deathsIfUnserved, expectedDeaths } from "@/convex/fatalityRisk";
import { ESCALATION_LABELS, phoneForPeople } from "@/lib/labels";
import { useSimNow } from "@/lib/use-sim-now";
import { Button, ButtonLink } from "../ui/button";
import { Panel, PanelEmpty } from "../ui/panel";
import { OpenRequest, byUrgency } from "./marks";
import { ESCALATION_SHORT, RequestBadge, VanChip, needStage } from "./request-badge";
import { useApprove } from "./use-approve";
import { Assignment, Person } from "./use-rescue-board";

export type FocusProps = {
  focusId: string | null;
  onFocus: (person: Person) => void;
  onHover: (person: Person | null) => void;
};

const URGENT_MINUTES = 60;

// "1673 Olive Ave" tells a dispatcher little; the street tells them which part of town, and the
// pin on the map (lit when the row is hovered) tells them exactly where.
export function streetOf(address: string) {
  return address.replace(/^\d+[A-Za-z]?\s+/, "");
}

function minutesLeft(person: Person, now: number) {
  return Math.max(0, Math.round((person.deadlineAt - now) / 60_000));
}

function TimeLeft({ minutes }: { minutes: number }) {
  const urgent = minutes < URGENT_MINUTES;
  const text = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60}`;
  return (
    <span
      className={`type-small inline-flex shrink-0 items-center gap-1 font-bold tabular-nums ${urgent ? "text-signal" : "text-on-panel-muted"}`}
      title={`Has to be out within ${text}`}
    >
      <Flame weight="fill" className="size-3.5" />
      {text}
    </span>
  );
}

function ApproveButton({ assignment }: { assignment: Assignment }) {
  const approve = useApprove();
  return (
    <Button
      variant="onPanel"
      aria-label="Approve this van"
      title="Approve this van"
      size="sm" square
      onClick={(event) => {
        event.stopPropagation();
        void approve([assignment._id]);
      }}
    >
      <Check weight="bold" className="size-4" />
    </Button>
  );
}

type PersonRowProps = { person: Person; now: number; focus: FocusProps; trailing?: ReactNode; action?: ReactNode };

// The row opens the person on the map; an action (approving a van) sits beside it, never inside it.
function PersonRow({ person, now, focus, trailing, action }: PersonRowProps) {
  const selected = focus.focusId === person._id;
  const escalation = person.escalation;
  return (
    <li className={`flex items-center transition-colors duration-150 hover:bg-surface-sunk ${selected ? "bg-surface-sunk" : ""} ${action ? "pr-4" : ""}`}>
      <button
        type="button"
        onClick={() => focus.onFocus(person)}
        onMouseEnter={() => focus.onHover(person)}
        onMouseLeave={() => focus.onHover(null)}
        onFocus={() => focus.onHover(person)}
        onBlur={() => focus.onHover(null)}
        className={`flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-4 text-left ${action ? "pr-1.5" : "pr-4"}`}
        aria-pressed={selected}
      >
        <RequestBadge request={person} />
        <span className="flex min-w-0 flex-1 flex-col">
          {escalation && (
            <span className="type-small font-bold text-signal" title={ESCALATION_LABELS[escalation]}>
              {ESCALATION_SHORT[escalation]}
            </span>
          )}
          <span className={`type-small truncate ${escalation ? "text-on-panel-muted" : "font-semibold"}`} title={person.address}>
            {streetOf(person.address)}
          </span>
        </span>
        {trailing ?? <TimeLeft minutes={minutesLeft(person, now)} />}
      </button>
      {action}
    </li>
  );
}

const NO_ADDRESS = "Address not confirmed";

// A caller we couldn't place on the map. No van can be sent until someone learns where they are,
// so the row's one action is calling them back.
function UnplacedRow({ request }: { request: OpenRequest }) {
  const heard = request.address === NO_ADDRESS ? undefined : request.address;
  const who = request.residentName ?? heard ?? "Caller";
  const number = request.callbackNumber;
  return (
    <li className="flex items-center gap-2.5 px-4 py-1.5">
      <RequestBadge request={request} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-small font-bold text-signal" title={ESCALATION_LABELS.address_unconfirmed}>
          No address
        </span>
        <span className="type-small truncate text-on-panel-muted" title={heard ? `Heard: ${heard}` : undefined}>
          {heard && who !== heard ? `${who}, maybe ${streetOf(heard)}` : who}
        </span>
      </span>
      {number && (
        <ButtonLink href={`tel:${number}`} variant="onPanelQuiet" size="sm" aria-label={`Call ${who} back at ${phoneForPeople(number)}`}>
          <Phone weight="bold" className="size-4" />
          <span className="tabular-nums">{phoneForPeople(number)}</span>
        </ButtonLink>
      )}
    </li>
  );
}

function OfferedVan({ person }: { person: Person }) {
  if (!person.assignment || !person.vehicle) return null;
  return <VanChip label={person.vehicle.label} busy={false} title={`${person.vehicle.label} offered, waiting for the driver`} />;
}

const approval = (person: Person) => (person.assignment?.status === "proposed" ? <ApproveButton assignment={person.assignment} /> : undefined);

function Group({ title, count, tone, children }: { title: string; count: number; tone: "signal" | "ink"; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-col">
      <h3 className={`type-small flex items-baseline justify-between px-4 pt-2 pb-1 font-bold ${tone === "signal" ? "text-signal" : "text-on-panel"}`}>
        {title}
        <span className="type-figure text-xl tabular-nums">{count}</span>
      </h3>
      <ol className="flex flex-col">{children}</ol>
    </div>
  );
}

function OnTheirWay({ people, focus }: { people: Person[]; focus: FocusProps }) {
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col border-t border-line">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="type-small flex items-center gap-2 px-4 py-2.5 text-left font-bold hover:bg-surface-sunk"
      >
        <span className="type-figure text-xl tabular-nums">{people.length}</span>
        <span className="flex-1">with a van on the way</span>
        <CaretDown weight="bold" className={`size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="flex flex-col pb-2">
          {people.map((person) => (
            <PersonRow
              key={person._id}
              person={person}
              now={0}
              focus={focus}
              trailing={
                <span className="flex shrink-0 items-center gap-2">
                  {person.assignment && <span className="type-small tabular-nums text-on-panel-muted">{Math.round(person.assignment.etaMinutes)} min</span>}
                  {person.vehicle && <VanChip label={person.vehicle.label} busy />}
                </span>
              }
            />
          ))}
        </ol>
      )}
    </div>
  );
}

const RISK_MODEL_NOTE =
  "Assumed risk model, not a prediction: each rider's risk grows with their need, is zero when they are aboard a vehicle by their deadline, and reaches its maximum at fire arrival. The solver plans to make the first number as small as it can.";

// When the van is expected to have the rider aboard: its arrival plus the time it takes to board.
function boardingDone(person: Person) {
  const { assignment } = person;
  if (!assignment) return null;
  const from = assignment.etaUpdatedAt ?? assignment.offeredAt ?? assignment.proposedAt;
  return from + (assignment.etaMinutes + person.boardingMinutes) * 60_000;
}

// Nobody can be sent to a caller with no address, so they count as unserved under both numbers.
function deathEstimates(people: Person[], unplaced: OpenRequest[]) {
  const unreachable = unplaced.reduce((sum, request) => sum + deathsIfUnserved(request), 0);
  let withPlan = unreachable;
  let withoutRides = unreachable;
  for (const person of people) {
    withoutRides += deathsIfUnserved(person);
    if (needStage(person) !== "pickedUp") withPlan += expectedDeaths(person, boardingDone(person));
  }
  return { withPlan, withoutRides, unreachable };
}

const callers = (count: number) => (count === 1 ? "the one caller hasn't" : `${count} callers haven't`);

// Why the two numbers match, when they do, and what would change that.
function estimateNote(people: Person[], unplaced: OpenRequest[], estimates: ReturnType<typeof deathEstimates>) {
  if (people.length === 0) return `No vehicle can be sent: ${callers(unplaced.length)} given an address. Call them back for it.`;
  const parts = [];
  if (estimates.withoutRides - estimates.withPlan < 0.05) parts.push("No vehicle is on its way to anyone yet.");
  if (unplaced.length > 0) parts.push(`${estimates.unreachable.toFixed(1)} of it is callers with no address, whom no vehicle can reach yet.`);
  return parts.join(" ");
}

function EstimateFigure({ value, label, muted = false }: { value: number; label: string; muted?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 ${muted ? "items-end" : ""}`}>
      <dd className={`type-figure tabular-nums ${muted ? "text-2xl text-ink-muted" : "text-3xl text-signal"}`}>{value.toFixed(1)}</dd>
      <dt className="type-small text-on-panel-muted">{label}</dt>
    </div>
  );
}

function DeathEstimate({ people, unplaced }: { people: Person[]; unplaced: OpenRequest[] }) {
  const estimates = deathEstimates(people, unplaced);
  const note = estimateNote(people, unplaced, estimates);
  return (
    <div className="mx-4 mb-1 flex flex-col gap-2 rounded-xl bg-surface-sunk px-3 py-2.5">
      <div className="flex items-end gap-6">
        <dl className="flex flex-1 items-end justify-between gap-4">
          <EstimateFigure value={estimates.withPlan} label={people.length === 0 ? "Expected deaths" : "Expected deaths, this plan"} />
          {people.length > 0 && <EstimateFigure value={estimates.withoutRides} label="If no vehicle came" muted />}
        </dl>
        <span className="mb-0.5 text-on-panel-muted" title={RISK_MODEL_NOTE} aria-label={RISK_MODEL_NOTE} role="img">
          <Info className="size-4" />
        </span>
      </div>
      {note && <p className="type-small text-on-panel">{note}</p>}
    </div>
  );
}

function ApproveAll({ proposed }: { proposed: Assignment[] }) {
  const approve = useApprove();
  if (proposed.length === 0) return null;
  return (
    <Button variant="onPanel" size="sm" onClick={() => void approve(proposed.map((assignment) => assignment._id))}>
      Approve {proposed.length} vans
    </Button>
  );
}

const committed = (person: Person) => person.assignment?.status === "accepted" || person.status === "arrived";

// Three questions, in the order a dispatcher acts on them: who needs a person to decide something,
// who is still waiting for a van, and how many are already covered.
type NeedPanelProps = { people: Person[]; unplaced: OpenRequest[]; focus: FocusProps; className?: string };

export function NeedPanel({ people, unplaced, focus, className = "" }: NeedPanelProps) {
  const now = useSimNow(15_000);
  const sorted = [...people].sort(byUrgency);
  const needYou = sorted.filter((person) => person.escalation && !committed(person));
  const waiting = sorted.filter((person) => !person.escalation && !committed(person));
  const covered = sorted.filter(committed);
  const proposed = people.flatMap((person) => (person.assignment?.status === "proposed" ? [person.assignment] : []));

  return (
    <Panel title="Rides" aside={<ApproveAll proposed={proposed} />} className={`min-h-0 ${className}`}>
      {people.length + unplaced.length === 0 ? (
        <PanelEmpty>Nobody has asked for a ride yet.</PanelEmpty>
      ) : (
        <div className="flex min-h-0 flex-col overflow-y-auto pb-1">
          <DeathEstimate people={people} unplaced={unplaced} />
          <Group title="Need you" count={unplaced.length + needYou.length} tone="signal">
            {unplaced.map((request) => (
              <UnplacedRow key={request._id} request={request} />
            ))}
            {needYou.map((person) => (
              <PersonRow key={person._id} person={person} now={now} focus={focus} />
            ))}
          </Group>
          <Group title="Waiting for a van" count={waiting.length} tone="ink">
            {waiting.map((person) => (
              <PersonRow
                key={person._id}
                person={person}
                now={now}
                focus={focus}
                trailing={
                  <span className="flex shrink-0 items-center gap-2">
                    <TimeLeft minutes={minutesLeft(person, now)} />
                    <OfferedVan person={person} />
                  </span>
                }
                action={approval(person)}
              />
            ))}
          </Group>
          <OnTheirWay people={covered} focus={focus} />
        </div>
      )}
    </Panel>
  );
}
