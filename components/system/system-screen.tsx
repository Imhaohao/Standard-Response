"use client";

import { ReactNode } from "react";
import { AppBar } from "../ui/app-bar";
import { ChangeCasesPanel, CallAccuracy, HonestyPanel, LatencyPanel } from "./call-panels";
import { CloseRoadPanel } from "./close-road";
import { DoorFairnessPanel, SimulatorPanel } from "./dispatch-panels";
import { AuditTrail, CallbackTiming, ReplanPanel, RequestFlow } from "./live-panels";
import { useResults } from "./results";

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3">
      <h2 className="type-heading text-map-ink">{title}</h2>
      {children}
    </section>
  );
}

// Three columns, one per question a judge asks: what is happening right now, can the calls be
// trusted, and does the dispatch help.
export function SystemScreen() {
  const results = useResults();
  return (
    <div className="min-h-[100dvh] bg-map-paper">
      <div className="sticky top-0 z-20">
        <AppBar />
      </div>
      <main className="grid gap-x-4 gap-y-8 p-4 lg:grid-cols-3">
        <Column title="Right now">
          <CloseRoadPanel />
          <ReplanPanel />
          <RequestFlow />
          <CallbackTiming />
          <div className="flex max-h-[32rem] min-h-0 flex-col">
            <AuditTrail />
          </div>
        </Column>
        <Column title="The calls">
          <CallAccuracy evaluation={results?.evaluation ?? null} />
          <LatencyPanel evaluation={results?.evaluation ?? null} />
          <HonestyPanel honesty={results?.honesty ?? null} />
          <ChangeCasesPanel cases={results?.changeCases ?? null} />
        </Column>
        <Column title="The dispatch">
          <SimulatorPanel simulator={results?.simulator ?? null} />
          <DoorFairnessPanel fairness={results?.doorFairness ?? null} />
        </Column>
      </main>
    </div>
  );
}
