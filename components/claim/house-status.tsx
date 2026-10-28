"use client";

import { Check, FireSimple, HouseLine, Key } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { BrandMark } from "@/components/ui/brand-mark";
import { PhoneScreen } from "@/components/ui/phone-screen";
import { Tag } from "@/components/ui/tag";
import { PRODUCT_NAME } from "@/lib/brand";
import { HouseFacts, HouseStage, isVerdict, stageOf } from "@/lib/claim-stage";
import { simTime } from "@/lib/sim-clock";
import { useNow } from "@/lib/time";
import { FireStatus } from "./fire-status";
import { copyFor } from "./house-status-copy";
import { NightTrack } from "./night-track";
import { forgetStatusToken, rememberStatusToken } from "./status-link";

const stageKey = (stage: HouseStage) => (stage.kind === "live" ? `live-${stage.step}` : stage.kind);

function minutesUntil(at: number | null, now: number) {
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 60_000));
}

// Safe and lost differ by shape as well as color: a round green seal with a check against a square
// red block with a flame. A night the fire passed by gets the plain house.
function VerdictEmblem({ stage }: { stage: HouseStage }) {
  const reduceMotion = useReducedMotion();
  const shape = {
    safe: { box: "rounded-full bg-leaving", icon: <Check weight="bold" className="size-10 text-canvas" aria-hidden /> },
    lost: { box: "bg-signal", icon: <FireSimple weight="fill" className="size-10 text-canvas" aria-hidden /> },
    spared: { box: "rounded-full bg-surface-sunk", icon: <HouseLine weight="fill" className="size-10 text-ink" aria-hidden /> },
  }[stage.kind as "safe" | "lost" | "spared"];
  return (
    <motion.div
      className={`grid size-20 place-items-center ${shape.box}`}
      initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.1 }}
    >
      {shape.icon}
    </motion.div>
  );
}

function StageIcon({ stage }: { stage: HouseStage }) {
  if (isVerdict(stage)) return <VerdictEmblem stage={stage} />;
  if (stage.kind === "given_back") return <Key weight="bold" className="size-10" aria-hidden />;
  return <HouseLine weight="fill" className="size-10" aria-hidden />;
}

// Before a verdict, the clock the whole night runs against: minutes until the fire reaches the home.
function FireClock({ minutes }: { minutes: number | null }) {
  if (minutes === null) {
    return <p className="type-small text-ink-muted">The fire isn&apos;t forecast to reach your home.</p>;
  }
  return (
    <div aria-live="off" className="flex flex-col gap-1 rounded-2xl bg-surface p-5 shadow-inset-line">
      <p className="flex items-center gap-2.5">
        <FireSimple weight="fill" className="size-8 shrink-0 text-ember" aria-hidden />
        <span className="type-figure text-6xl">{minutes}</span>
      </p>
      <p className="type-body text-ink-muted">{minutes === 1 ? "minute" : "minutes"} until the fire reaches your home</p>
    </div>
  );
}

function Body({ stage, facts, now }: { stage: HouseStage; facts: HouseFacts | null; now: number }) {
  const minutesAway = stage.kind === "live" && stage.ride.state === "coming" ? minutesUntil(stage.ride.etaAt, now) : null;
  const copy = copyFor(stage, facts, minutesAway);
  const lost = stage.kind === "lost";
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <StageIcon stage={stage} />
        <h1 className={`type-display ${lost ? "text-signal" : ""}`}>{copy.title}</h1>
        <p className="type-body text-ink-muted">{copy.body}</p>
      </div>
      {stage.kind === "live" && <FireClock minutes={stage.minutesToFire} />}
      {facts && stage.kind !== "given_back" && <NightTrack stage={stage} facts={facts} />}
      {facts && stage.kind !== "waiting" && stage.kind !== "given_back" && (
        <p className="type-small flex items-center gap-2 text-ink-muted">
          <HouseLine weight="fill" className="size-4 shrink-0" aria-hidden />
          {facts.address}
        </p>
      )}
    </div>
  );
}

function useHouseStage(token: string) {
  const status = useQuery(api.claimStatus.forToken, { token });
  const real = useNow(1000);
  const now = simTime(status?.clock ?? undefined, real);
  const facts = status?.facts ?? null;
  const ready = status !== undefined && real !== 0;
  return { ready, facts, now, stage: stageOf(facts, now) };
}

// The judge's phone after they took a house on the kiosk: where the night stands for that house, and
// in the end whether the resident got out before the fire.
export function HouseStatus({ token }: { token: string }) {
  const { ready, facts, now, stage } = useHouseStage(token);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!ready) return;
    if (stage.kind === "given_back") forgetStatusToken(token);
    else rememberStatusToken(token);
  }, [ready, stage.kind, token]);
  return (
    <PhoneScreen surface="canvas">
      <div className="claim-face flex flex-1 flex-col gap-10 px-5 pt-6 pb-8">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-6" />
          <span className="type-heading font-brand">{PRODUCT_NAME}</span>
          <span className="ml-auto">
            <Tag title="The fire, the calls and the rides are a simulated night">Simulation</Tag>
          </span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={ready ? stageKey(stage) : "loading"}
            initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            aria-live="polite"
          >
            {ready ? <Body stage={stage} facts={facts} now={now} /> : <div className="h-64 animate-pulse rounded-2xl bg-surface-sunk" aria-hidden />}
          </motion.div>
        </AnimatePresence>
        {ready && stage.kind !== "given_back" && <FireStatus />}
      </div>
    </PhoneScreen>
  );
}
