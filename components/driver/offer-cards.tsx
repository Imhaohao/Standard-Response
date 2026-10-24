"use client";

import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { ArrowsClockwise, Check, HourglassMedium, Van, X } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { OFFER_TTL_MS } from "@/convex/model";
import { formatElapsed, useNow } from "@/lib/time";
import { Button } from "../ui/button";
import { RideNeeds } from "./ride-needs";
import { Stop } from "./stops";

const ENTER = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6, transition: { duration: 0.15 } },
  transition: { type: "spring", duration: 0.35, bounce: 0 },
} as const;

function useSecondsLeft(offeredAt: number) {
  const now = useNow(250);
  return Math.max(0, offeredAt + OFFER_TTL_MS - now);
}

function StopHeading({ stop }: { stop: Stop }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <h2 className="type-title text-2xl">{stop.address}</h2>
        {stop.rider?.residentName && <span className="type-body text-on-panel-muted">{stop.rider.residentName}</span>}
      </div>
      <span className="flex shrink-0 items-center gap-1.5" aria-label={`${stop.etaMinutes} minutes away`}>
        <Van weight="fill" className="size-6" />
        <span className="type-figure text-2xl">{stop.etaMinutes} min</span>
      </span>
    </div>
  );
}

// The time to answer lives on the Accept button itself: a fuse along its bottom edge that burns
// down, and the seconds beside the word.
function AcceptButton({ offeredAt, onAccept }: { offeredAt: number; onAccept: () => void }) {
  const left = useSecondsLeft(offeredAt);
  return (
    <Button variant="onPanel" className="relative !h-16 overflow-hidden !text-lg" onClick={onAccept} aria-describedby="offer-clock">
      <Check weight="bold" className="size-6" />
      Accept
      <span id="offer-clock" className="type-figure ml-1 text-base text-panel/60 tabular-nums" role="timer" aria-label={`${formatElapsed(left)} left to answer`}>
        {formatElapsed(left)}
      </span>
      <span className="absolute inset-x-3 bottom-2 h-1 overflow-hidden rounded-full bg-panel/15" aria-hidden>
        <span className="block h-full origin-left bg-panel transition-transform duration-300 ease-linear" style={{ transform: `scaleX(${left / OFFER_TTL_MS})` }} />
      </span>
    </Button>
  );
}

function AnswerButtons({ stop, onChanged, onDeclined }: { stop: Stop; onChanged: () => void; onDeclined: () => void }) {
  const accept = useMutation(api.offers.accept);
  const decline = useMutation(api.offers.decline);
  return (
    <div className="grid grid-cols-[1.6fr_1fr] gap-2">
      <AcceptButton
        offeredAt={stop.offeredAt!}
        onAccept={() => void accept({ assignmentId: stop._id }).then((result) => result === "changed" && onChanged())}
      />
      <Button
        variant="onPanelQuiet"
        className="!h-16 !text-lg"
        onClick={() => {
          onDeclined();
          void decline({ assignmentId: stop._id });
        }}
      >
        <X weight="bold" className="size-5" />
        Decline
      </Button>
    </div>
  );
}

export function OfferCard({ stop, onChanged, onDeclined }: { stop: Stop; onChanged: () => void; onDeclined: () => void }) {
  const waiting = stop.status === "proposed" || !stop.offeredAt;
  return (
    <motion.li layout {...ENTER} className="flex flex-col gap-4 bg-panel px-4 pt-5 pb-4">
      <StopHeading stop={stop} />
      <RideNeeds stop={stop} />
      {waiting ? (
        <p className="type-body flex items-center gap-2 text-on-panel-muted">
          <HourglassMedium weight="bold" className="size-5 shrink-0" />
          The dispatcher has not approved this yet.
        </p>
      ) : (
        <AnswerButtons stop={stop} onChanged={onChanged} onDeclined={onDeclined} />
      )}
    </motion.li>
  );
}

// A re-plan took this one away. It must be impossible to miss: the dark card turns to hatched
// paper, the address is struck through, and the driver has to clear it by hand.
export function ChangedCard({ stop, onDismiss }: { stop: Stop; onDismiss: () => void }) {
  return (
    <motion.li layout {...ENTER} role="alert" className="flex flex-col gap-3 bg-map-paper px-4 pt-0 pb-4 text-map-ink">
      <span className="hatch -mx-4 block h-3" aria-hidden />
      <div className="flex items-center gap-3">
        <ArrowsClockwise weight="bold" className="size-9 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <p className="type-title text-2xl">This assignment changed</p>
          <p className="type-body truncate line-through decoration-2">{stop.address}</p>
        </div>
      </div>
      <p className="type-body">Don&apos;t drive there. Nothing was promised to the rider.</p>
      <Button variant="onPaper" size="lg" onClick={onDismiss}>
        Got it
      </Button>
    </motion.li>
  );
}
