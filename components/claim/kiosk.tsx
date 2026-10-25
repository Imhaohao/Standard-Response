"use client";

import { useQuery } from "convex/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ReactNode, useCallback, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { ClaimedCard } from "./claimed-card";
import { ClaimMap, FlyToHome, KioskHome } from "./claim-map";
import { HousePanel } from "./house-panel";
import { HouseRecord } from "./house-form";
import { PickGuide } from "./pick-guide";
import { SignInCard } from "./sign-in-card";
import { useKioskSession } from "./use-kiosk-session";

type Claimed = { address: string; residentName: string; phoneEnding: string | null };
type Edits = { householdId: Id<"households">; record: HouseRecord };
type Selection = ReturnType<typeof useSelection>;

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const NO_HOMES: KioskHome[] = [];

// Cards rise into place and the house panel slides in from the edge it sits on. With reduced
// motion they only fade, so every step still changes visibly.
function useEntrance(from: { x?: number; y?: number }) {
  const reduceMotion = useReducedMotion();
  const offset = reduceMotion ? {} : from;
  return {
    initial: { opacity: 0, ...offset },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, ...offset, transition: { duration: 0.15 } },
    transition: { duration: 0.28, ease: EASE_OUT },
  };
}

function Centered({ children }: { children: ReactNode }) {
  const entrance = useEntrance({ y: 16 });
  return (
    <motion.div {...entrance} className="absolute inset-0 grid place-items-center overflow-y-auto p-4 sm:p-8">
      {children}
    </motion.div>
  );
}

// The house being edited, and the record the judge has changed it to so far.
function useSelection(homes: KioskHome[]) {
  const [selectedId, setSelectedId] = useState<Id<"households"> | null>(null);
  const [edits, setEdits] = useState<Edits | null>(null);
  const [flyTo, setFlyTo] = useState<FlyToHome | null>(null);
  const selected = homes.find((home) => home._id === selectedId) ?? null;
  const draft = useQuery(api.claims.draft, selectedId ? { householdId: selectedId } : "skip");
  const record = edits?.householdId === selectedId ? edits.record : (draft?.record ?? null);

  const select = useCallback((home: KioskHome) => setSelectedId(home._id), []);
  const surprise = useCallback(() => {
    const open = homes.filter((home) => home.state === "open" && home._id !== selectedId);
    const home = open[Math.floor(Math.random() * open.length)];
    if (!home) return;
    setSelectedId(home._id);
    setFlyTo((last) => ({ householdId: home._id, key: (last?.key ?? 0) + 1 }));
  }, [homes, selectedId]);
  const clear = useCallback(() => {
    setSelectedId(null);
    setEdits(null);
  }, []);
  const edit = useCallback((next: HouseRecord) => selectedId && setEdits({ householdId: selectedId, record: next }), [selectedId]);
  return { selected, selectedId, address: draft?.address ?? selected?.address ?? null, record, flyTo, select, surprise, clear, edit };
}

// Step two and three over the live map: the key in one corner, the picked house's panel at the edge.
function PickLayer({ code, phoneEnding, openCount, selection, onStartOver, onClaimed }: { code: string; phoneEnding: string; openCount: number; selection: Selection; onStartOver: () => void; onClaimed: (taken: Omit<Claimed, "phoneEnding">) => void }) {
  const panelEntrance = useEntrance({ x: 32 });
  const guideEntrance = useEntrance({ x: -24 });
  const { selected, address } = selection;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-start justify-between gap-3 p-3 sm:p-4">
      <motion.div {...guideEntrance}>
        <PickGuide phoneEnding={phoneEnding} openCount={openCount} onSurprise={selection.surprise} onStartOver={onStartOver} />
      </motion.div>
      <AnimatePresence>
        {selected && address && (
          <motion.div key={selected._id} {...panelEntrance} className="flex max-h-full min-h-0">
            <HousePanel
              code={code}
              householdId={selected._id}
              address={address}
              record={selection.record}
              stillOpen={selected.state === "open"}
              onChange={selection.edit}
              onClose={selection.clear}
              onClaimed={onClaimed}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const stepOf = (claimed: Claimed | null, phoneEnding: string | null) => (claimed ? "claimed" : phoneEnding ? "pick" : "signin");

// The judges' kiosk at `/`: sign in with a phone number, take an open demo house on the map, say who
// lives there, and hand the screen to the next judge.
export function Kiosk() {
  const kiosk = useKioskSession();
  const homes = useQuery(api.claims.homes) ?? NO_HOMES;
  const selection = useSelection(homes);
  const [claimed, setClaimed] = useState<Claimed | null>(null);
  const openCount = useMemo(() => homes.filter((home) => home.state === "open").length, [homes]);
  const { code, phoneEnding, restart } = kiosk;
  const { clear } = selection;

  const nextJudge = useCallback(() => {
    setClaimed(null);
    clear();
    void restart();
  }, [clear, restart]);
  const onClaimed = useCallback((taken: Omit<Claimed, "phoneEnding">) => setClaimed({ ...taken, phoneEnding }), [phoneEnding]);

  const step = stepOf(claimed, phoneEnding);
  const picking = step === "pick";

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      <ClaimMap homes={homes} selectedId={picking ? selection.selectedId : null} onSelect={selection.select} flyTo={selection.flyTo} picking={picking} />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-map-paper/75 backdrop-blur-[3px]"
        initial={false}
        animate={{ opacity: picking ? 0 : 1 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
      />
      <AnimatePresence mode="wait" initial={false}>
        {step === "signin" && (
          <Centered key={`signin-${code}`}>
            <SignInCard code={code} error={kiosk.error} />
          </Centered>
        )}
        {claimed && (
          <Centered key="claimed">
            <ClaimedCard address={claimed.address} residentName={claimed.residentName} phoneEnding={claimed.phoneEnding} onNext={nextJudge} />
          </Centered>
        )}
      </AnimatePresence>
      {picking && code && phoneEnding && <PickLayer code={code} phoneEnding={phoneEnding} openCount={openCount} selection={selection} onStartOver={nextJudge} onClaimed={onClaimed} />}
    </div>
  );
}
