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
import { ActivityList } from "./activity-list";
import { FloorControls } from "./floor-controls";
import { FloorMap } from "./floor-map";
import { LineList } from "./line-list";
import { ListeningPanel } from "./listening-panel";
import { QueueList } from "./queue-list";
import { ReachPanel } from "./reach-panel";

type Tab = "lines" | "queue" | "activity";

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

function BeforeWarning() {
  const issueWarning = useMutation(api.control.issueWarning);
  const [pending, setPending] = useState(false);
  const ready = useReadyCount();
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.6, bounce: 0 }}
      className="pointer-events-auto flex max-w-xl flex-col gap-6 bg-panel/96 p-8 text-on-panel backdrop-blur-md"
    >
      <h1 className="type-display">
        {ready.onFile > 0 ? `${ready.onFile} of ${ready.total} homes are on file. Nobody has been warned yet.` : `Nobody in ${AREA_NAME} has been called yet.`}
      </h1>
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
      className={`type-small flex h-10 flex-1 items-center justify-center gap-1.5 font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
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
  const [listening, setListening] = useState(true);
  const pin = (id: Id<"calls"> | null) => {
    setPinnedId(id);
    setListening(true);
  };
  return { calls: sorted, followed, pinned: Boolean(pinned), pin, listening, close: () => setListening(false) };
}

function WorkColumn({ floor }: { floor: ReturnType<typeof useFollowedCall> }) {
  const [tab, setTab] = useState<Tab>("lines");
  const [open, setOpen] = useState(true);
  return (
    <div className="pointer-events-auto flex min-h-0 w-[23rem] max-w-[40vw] shrink-0 flex-col gap-3">
      <ReachPanel />
      <section className={`flex min-h-0 flex-col overflow-hidden card ${open ? "flex-1" : ""}`}>
        <div role="tablist" aria-label="Call floor lists" className="flex border-b border-panel-raised">
          <TabButton active={tab === "lines"} onClick={() => setTab("lines")}>
            On the phone <span className="tabular-nums text-on-panel-muted">{floor.calls.length}</span>
          </TabButton>
          <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
            Next to call
          </TabButton>
          <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
            Activity
          </TabButton>
          <button
            type="button"
            aria-label={open ? "Hide the lists" : "Show the lists"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="grid w-10 shrink-0 place-items-center text-on-panel-muted hover:text-on-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
          >
            <CaretDown weight="bold" className={`size-4 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
          </button>
        </div>
        <div role="tabpanel" hidden={!open} className="min-h-0 flex-1 overflow-y-auto">
          {tab === "lines" && <LineList calls={floor.calls} selectedId={floor.followed?._id ?? null} onSelect={floor.pin} />}
          {tab === "queue" && <QueueList />}
          {tab === "activity" && <ActivityList />}
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
      <FloorMap followed={followed} />
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <AppBar>
          {issuedAt && <WarningClock issuedAt={issuedAt} />}
          <FloorControls control={control} />
        </AppBar>
        {control && !issuedAt && (
          <div className="grid flex-1 place-items-center p-6">
            <BeforeWarning />
          </div>
        )}
        {issuedAt && (
          <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
            <WorkColumn floor={floor} />
            <div className="min-w-0 flex-1" />
            <div className="pointer-events-auto flex min-h-0 w-[27rem] max-w-[40vw] shrink-0 flex-col">
              {floor.listening && (
                <ListeningPanel callId={floor.followed?._id ?? null} pinned={floor.pinned} onFollowLive={() => floor.pin(null)} onClose={floor.close} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
