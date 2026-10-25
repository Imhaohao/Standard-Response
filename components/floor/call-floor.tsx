"use client";

import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { ReactNode, useState } from "react";
import { CaretDown, PhoneCall, Siren } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AREA_NAME } from "@/lib/brand";
import { AppBar, WarningClock } from "../ui/app-bar";
import { Button } from "../ui/button";
import { skippedCount } from "../rescue/unreached";
import { StandInWarning } from "../rescue/unreached-panel";
import { ActivityList } from "./activity-list";
import { FloorControls } from "./floor-controls";
import { FloorMap } from "./floor-map";
import { LadderList } from "./ladder-list";
import { LineList } from "./line-list";
import { ListeningPanel } from "./listening-panel";
import { QueueList } from "./queue-list";
import { ReachPanel } from "./reach-panel";

type Tab = "lines" | "queue" | "ladder" | "activity";

// What the Ready check already knows before anyone is warned.
function useReadyCount() {
  const homes = useQuery(api.households.coverage);
  const control = useQuery(api.control.get);
  return {
    onFile: homes?.filter((home) => home.exitPlan).length ?? 0,
    total: homes?.length ?? 0,
    running: control !== undefined && "readyCheckRunning" in control && control.readyCheckRunning === true,
  };
}

function ReadyCheckButton({ running }: { running: boolean }) {
  const start = useMutation(api.ready.start);
  const stop = useMutation(api.ready.stop);
  return (
    <Button variant="onPanelQuiet" size="lg" onClick={() => void (running ? stop() : start())}>
      <PhoneCall weight={running ? "fill" : "bold"} className={`size-5 ${running ? "motion-safe:animate-ringing" : ""}`} />
      {running ? "Pause the Ready check" : "Ready check: call every home"}
    </Button>
  );
}

// Real homes the voice stand-in would never ring if the warning went out now.
function useSkippedBeforeWarning() {
  const control = useQuery(api.control.get);
  const homes = useQuery(api.households.coverage);
  if (!control || !homes) return 0;
  return skippedCount(homes, control.simulateVoice);
}

function BeforeWarning() {
  const issueWarning = useMutation(api.control.issueWarning);
  const [pending, setPending] = useState(false);
  const ready = useReadyCount();
  const skipped = useSkippedBeforeWarning();
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.6, bounce: 0 }}
      className="pointer-events-auto flex max-w-xl flex-col gap-6 bg-panel/96 p-8 text-on-panel backdrop-blur-md"
    >
      <h1 className="type-display">
        {ready.onFile > 0 ? `${ready.onFile} of ${ready.total} homes on file` : `No homes in ${AREA_NAME} on file yet`}
      </h1>
      {skipped > 0 && <StandInWarning count={skipped} />}
      <div className="flex flex-wrap gap-3">
        <ReadyCheckButton running={ready.running} />
        <Button
          variant="onPanel"
          size="lg"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void issueWarning({}).finally(() => setPending(false));
          }}
        >
          <Siren weight="fill" className="size-5 text-signal" />
          Issue evacuation warning
        </Button>
      </div>
    </motion.section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`type-small flex h-10 flex-auto items-center justify-center gap-1.5 whitespace-nowrap px-1.5 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
        active ? "text-on-panel shadow-[inset_0_-2px_0_var(--on-panel)]" : "text-on-panel-muted hover:text-on-panel"
      }`}
    >
      {children}
    </button>
  );
}

function useFollowedCall() {
  const calls = useQuery(api.calls.active);
  const [pinnedId, setPinnedId] = useState<Id<"calls"> | null>(null);
  const sorted = [...(calls ?? [])].sort((a, b) => a.startedAt - b.startedAt);
  const pinned = sorted.find((call) => call._id === pinnedId);
  const oldestLive = sorted.find((call) => call.phase === "live");
  const followed = pinned ?? oldestLive ?? null;
  // A call opened from the activity list, which may have ended: it stays open until the operator follows a line again.
  const [reviewId, setReviewId] = useState<Id<"calls"> | null>(null);
  const [listening, setListening] = useState(true);
  const pin = (id: Id<"calls"> | null) => {
    setPinnedId(id);
    setReviewId(null);
    setListening(true);
  };
  const review = (id: Id<"calls">) => {
    setReviewId(id);
    setListening(true);
  };
  return {
    calls: sorted,
    followed,
    shownId: reviewId ?? followed?._id ?? null,
    reviewing: reviewId !== null,
    pinned: Boolean(pinned) || reviewId !== null,
    pin,
    review,
    listening,
    close: () => setListening(false),
  };
}

type TabsProps = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  warned: boolean;
  lines: number;
  open: boolean;
  onToggle: () => void;
};

function ListTabs({ tab, onTab, warned, lines, open, onToggle }: TabsProps) {
  return (
    <div role="tablist" aria-label="Call floor lists" className="flex overflow-x-auto border-b border-panel-raised">
      <TabButton active={tab === "lines"} onClick={() => onTab("lines")}>
        <span className="sm:hidden">Calls</span>
        <span className="max-sm:hidden">On the phone</span> <span className="tabular-nums text-on-panel-muted">{lines}</span>
      </TabButton>
      {warned && (
        <TabButton active={tab === "queue"} onClick={() => onTab("queue")}>
          Next to call
        </TabButton>
      )}
      {warned && (
        <TabButton active={tab === "ladder"} onClick={() => onTab("ladder")}>
          No answer
        </TabButton>
      )}
      <TabButton active={tab === "activity"} onClick={() => onTab("activity")}>
        Activity
      </TabButton>
      <button
        type="button"
        aria-label={open ? "Hide the lists" : "Show the lists"}
        aria-expanded={open}
        onClick={onToggle}
        className="grid w-10 shrink-0 place-items-center text-on-panel-muted hover:text-on-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
      >
        <CaretDown weight="bold" className={`size-4 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
      </button>
    </div>
  );
}

// Before the warning only the Ready check is calling: no reach to count, no warning queue and
// nobody on the reach ladder yet.
function WorkColumn({ floor, warned }: { floor: ReturnType<typeof useFollowedCall>; warned: boolean }) {
  const [chosenTab, setTab] = useState<Tab>("lines");
  const [open, setOpen] = useState(true);
  const tab = !warned && (chosenTab === "queue" || chosenTab === "ladder") ? "lines" : chosenTab;
  const openLadder = () => {
    setTab("ladder");
    setOpen(true);
  };
  return (
    <div className="pointer-events-auto flex min-h-0 w-full max-w-[23rem] shrink-0 flex-col gap-3 sm:w-[23rem] sm:max-w-[40vw]">
      {warned && <ReachPanel onOpenLadder={openLadder} />}
      <section className={`flex min-h-0 flex-col overflow-hidden card ${open ? "flex-1" : ""}`}>
        <ListTabs
          tab={tab}
          onTab={setTab}
          warned={warned}
          lines={floor.calls.length}
          open={open}
          onToggle={() => setOpen(!open)}
        />
        <div role="tabpanel" hidden={!open} className="min-h-0 flex-1 overflow-y-auto">
          {tab === "lines" && <LineList calls={floor.calls} selectedId={floor.reviewing ? null : floor.shownId} onSelect={floor.pin} />}
          {tab === "queue" && <QueueList />}
          {tab === "ladder" && <LadderList />}
          {tab === "activity" && <ActivityList selectedCallId={floor.reviewing ? floor.shownId : null} onOpenCall={floor.review} />}
        </div>
      </section>
    </div>
  );
}

export function CallFloor() {
  const control = useQuery(api.control.get);
  const floor = useFollowedCall();
  const issuedAt = control?.warningIssuedAt;
  const followed = floor.followed ? { householdId: floor.followed.householdId, address: floor.followed.address } : null;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      <FloorMap followed={followed} listeningPanelOpen={Boolean(issuedAt) && floor.listening && floor.shownId !== null} />
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <AppBar>
          {issuedAt && <WarningClock issuedAt={issuedAt} />}
          <FloorControls control={control} />
        </AppBar>
        {control && (
          <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
            <WorkColumn floor={floor} warned={Boolean(issuedAt)} />
            <div className="grid min-w-0 flex-1 place-items-center">{!issuedAt && <BeforeWarning />}</div>
            {/* Only the panel takes clicks: the empty column must not swallow clicks meant for the map. */}
            <div className="flex min-h-0 w-[27rem] max-w-[40vw] shrink-0 flex-col max-sm:hidden [&>*]:pointer-events-auto">
              {floor.listening && (
                <ListeningPanel callId={floor.shownId} pinned={floor.pinned} onFollowLive={() => floor.pin(null)} onClose={floor.close} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
