"use client";

import { useMutation } from "convex/react";
import { motion } from "motion/react";
import { ArrowsClockwise, Check, HourglassMedium, X } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Button } from "../ui/button";
import { InsideFacts } from "../ready/profile";
import { RideNeeds } from "./ride-needs";
import { Stop } from "./stops";

const ENTER = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 6, transition: { duration: 0.15 } },
  transition: { type: "spring", duration: 0.35, bounce: 0 },
} as const;

function StopHeading({ stop }: { stop: Stop }) {
  const riderName = stop.rider?.residentName;
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="type-title text-3xl">{riderName ?? stop.address}</h2>
        {riderName && <p className="type-body font-semibold">{stop.address}</p>}
      </div>
      <span className="flex shrink-0 items-baseline gap-1" aria-label={`${stop.etaMinutes} minutes away`}>
        <span className="type-figure text-6xl">{stop.etaMinutes}</span>
        <span className="type-heading">min</span>
      </span>
    </div>
  );
}

function AnswerButtons({ stop, onChanged, onDeclined }: { stop: Stop; onChanged: () => void; onDeclined: () => void }) {
  const accept = useMutation(api.offers.accept);
  const decline = useMutation(api.offers.decline);
  return (
    <div className="grid grid-cols-[2fr_1fr] gap-2">
      <Button
        variant="onPanel"
        size="lg"
        onClick={() => void accept({ assignmentId: stop._id }).then((result) => result === "changed" && onChanged())}
      >
        <Check weight="bold" className="size-6" />
        Accept
      </Button>
      <Button
        variant="onPanelQuiet"
        size="lg"
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
      {stop.rider?.ready && <InsideFacts ready={stop.rider.ready} />}
      {waiting ? (
        <p className="type-heading flex items-center gap-2">
          <HourglassMedium weight="bold" className="size-6 shrink-0" />
          Dispatcher reviewing
        </p>
      ) : (
        <AnswerButtons stop={stop} onChanged={onChanged} onDeclined={onDeclined} />
      )}
    </motion.li>
  );
}

// A re-plan took this one away. The dark card turns to hatched paper with the address struck
// through, and the driver has to clear it by hand.
export function ChangedCard({ stop, onDismiss }: { stop: Stop; onDismiss: () => void }) {
  return (
    <motion.li layout {...ENTER} role="alert" className="flex flex-col gap-3 bg-map-paper px-4 pt-0 pb-4 text-map-ink">
      <span className="hatch -mx-4 block h-3" aria-hidden />
      <div className="flex items-center gap-3">
        <ArrowsClockwise weight="bold" className="size-10 shrink-0" />
        <div className="flex min-w-0 flex-col">
          <p className="type-title text-3xl">Assignment changed</p>
          <p className="type-body truncate font-semibold line-through decoration-2">{stop.address}</p>
        </div>
      </div>
      <p className="type-heading">Don&apos;t drive there.</p>
      <Button variant="onPaper" size="lg" onClick={onDismiss}>
        Got it
      </Button>
    </motion.li>
  );
}
