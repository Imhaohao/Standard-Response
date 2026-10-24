"use client";

import { useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { Heartbeat, PawPrint, Users, UsersThree, X, type Icon } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMapStage } from "@/components/map/map-stage";
import { LatLng } from "@/lib/geo";
import { Point } from "@/lib/ink-map/data";
import { ASSIST_LABELS, EXIT_OPTIONS, InsideFacts, MOBILITY_OPTIONS } from "../ready/profile";
import { Home } from "./marks";

type Card = NonNullable<FunctionReturnType<typeof api.ready.card>>;

const CARD_WIDTH = 320;
const GAP = 18;
const EDGE = 12;
const PICK_RADIUS_METERS = 28;

// The household under a click on the map, if one is close enough to mean it.
export function nearestHome(homes: Home[], point: Point, toLocal: (at: LatLng) => Point) {
  let best: Home | null = null;
  let bestDistance = PICK_RADIUS_METERS;
  for (const home of homes) {
    const [x, y] = toLocal(home);
    const distance = Math.hypot(x - point[0], y - point[1]);
    if (distance < bestDistance) {
      best = home;
      bestDistance = distance;
    }
  }
  return best;
}

type Tile = { key: string; label: string; Icon?: Icon; glyph?: string; count?: number };

function tilesOf(card: Card): Tile[] {
  const mobility = MOBILITY_OPTIONS.find((option) => option.key === card.mobility);
  const candidates: (Tile | false)[] = [
    card.peopleCount !== undefined && { key: "people", label: card.peopleCount === 1 ? "person" : "people", Icon: Users, count: card.peopleCount },
    mobility !== undefined && mobility.key !== "walks" && { key: "mobility", label: mobility.label, Icon: mobility.Icon },
    card.assistanceRequired === "two_person_lift" && { key: "lift", label: ASSIST_LABELS.two_person_lift, Icon: UsersThree },
    card.medical?.includes("oxygen") === true && { key: "oxygen", label: "oxygen", glyph: "O₂" },
    card.medical?.includes("dialysis") === true && { key: "dialysis", label: "dialysis", Icon: Heartbeat },
    card.pets === true && { key: "pets", label: "pets", Icon: PawPrint },
  ];
  return candidates.filter((tile): tile is Tile => Boolean(tile));
}

function NeedTiles({ card }: { card: Card }) {
  const tiles = tilesOf(card);
  if (tiles.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tiles.map(({ key, label, Icon, glyph, count }) => (
        <li key={key} className="flex min-w-16 flex-col items-center gap-0.5 rounded-xl bg-panel-raised px-2.5 py-1.5">
          <span className="flex items-center gap-1">
            {Icon ? <Icon weight="bold" className="size-5" /> : <span className="type-figure text-lg">{glyph}</span>}
            {count !== undefined && <span className="type-figure text-xl tabular-nums">{count}</span>}
          </span>
          <span className="type-small font-semibold">{label}</span>
        </li>
      ))}
    </ul>
  );
}

const PICKUP_STATUS: Record<NonNullable<Card["pickup"]>["status"], string> = {
  arranged: "on file",
  checking: "calling now",
  coming: "on the way",
  done: "picked them up",
  fell_through: "fell through",
};

function ExitPlan({ card }: { card: Card }) {
  const plan = EXIT_OPTIONS.find((option) => option.key === card.ready?.exitPlan);
  if (!plan) return null;
  const pickup = card.pickup;
  const broken = pickup?.status === "fell_through";
  return (
    <p className={`type-small flex items-center gap-2 rounded-xl px-3 py-2 ${broken ? "bg-signal-soft" : "bg-panel-raised"}`}>
      <plan.Icon weight="bold" className={`size-5 shrink-0 ${broken ? "text-signal" : ""}`} />
      {pickup ? (
        <span>
          <span className="font-bold">{pickup.helperName}</span>
          {pickup.relation && <span className="text-on-panel-muted">, {pickup.relation}</span>}
          <span className={`font-semibold ${broken ? "text-signal" : ""}`}> {PICKUP_STATUS[pickup.status]}</span>
        </span>
      ) : (
        <span className="font-semibold">{plan.label}</span>
      )}
    </p>
  );
}

function provenance(card: Card) {
  if (!card.ready) return card.readyMisses >= 2 ? "Not on file. Nobody answered the Ready check twice" : "Not on file yet";
  const date = new Date(card.ready.at).toLocaleDateString([], { month: "short", day: "numeric" });
  if (card.ready.via === "form") return card.ready.verified ? `Signed up ${date}, confirmed by phone` : `Signed up online ${date}, not confirmed by phone yet`;
  return `On file since a call on ${date}`;
}

function CardBody({ card, onClose }: { card: Card; onClose: () => void }) {
  const street = card.address.replace(/^\s*\d+[A-Za-z]?\s+/, "");
  return (
    <>
      <header className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="type-title truncate">{card.residentName ?? street}</h2>
          <p className="type-small truncate text-on-panel-muted">{card.address}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 grid size-9 shrink-0 place-items-center rounded-lg text-on-panel-muted hover:bg-panel-raised hover:text-on-panel focus-visible:outline-2 focus-visible:outline-on-panel">
          <X weight="bold" className="size-4" />
        </button>
      </header>
      <NeedTiles card={card} />
      {card.ready && <InsideFacts ready={card.ready} />}
      <ExitPlan card={card} />
      <p className="type-small text-on-panel-muted">{provenance(card)}</p>
    </>
  );
}

// Everything a crew should know before going in, pinned beside the home it describes.
export function HouseCard({ householdId, at, onClose }: { householdId: string; at: Point; onClose: () => void }) {
  const card = useQuery(api.ready.card, { householdId: householdId as Id<"households"> });
  const { project, size } = useMapStage();
  const spot = project(at);
  if (!card || !spot.visible) return null;
  const fitsRight = spot.x + GAP + CARD_WIDTH < size.width - EDGE;
  const left = fitsRight ? spot.x + GAP : Math.max(EDGE, spot.x - GAP - CARD_WIDTH);
  const top = Math.min(Math.max(spot.y, 190), size.height - 190);
  return (
    <section
      aria-label={`Household at ${card.address}`}
      style={{ left, top, width: CARD_WIDTH }}
      className="pointer-events-auto absolute z-10 flex -translate-y-1/2 flex-col gap-3 rounded-2xl bg-panel p-4 text-on-panel shadow-float"
    >
      <CardBody card={card} onClose={onClose} />
    </section>
  );
}
