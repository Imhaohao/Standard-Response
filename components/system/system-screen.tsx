"use client";

import { AppBar } from "../ui/app-bar";
import { AnswerTiles } from "./answer-tiles";
import { ChangeCasesDisclosure, CorrectionsDisclosure, FieldAccuracyDisclosure, HonestyDisclosure, LatencyDisclosure } from "./call-panels";
import { CloseRoadPanel } from "./close-road";
import { DoorFairnessDisclosure, SimulatorDisclosure } from "./dispatch-panels";
import { AuditDisclosure, CallbacksDisclosure, PlanDisclosure, RequestPipeline, useCallbackSpread } from "./live-panels";
import { Tag } from "./range";
import { useResults } from "./results";

// Four answers a judge asks for first, the live demo controls, then everything behind disclosures.
export function SystemScreen() {
  const results = useResults();
  const callbackSpread = useCallbackSpread();
  const evaluation = results?.evaluation ?? null;
  return (
    <div className="min-h-[100dvh] bg-map-paper">
      <div className="sticky top-0 z-20">
        <AppBar />
      </div>
      <main className="mx-auto flex w-full max-w-[90rem] flex-col gap-4 p-4">
        <AnswerTiles results={results} callbackSpread={callbackSpread} />
        <section aria-label="Right now" className="flex flex-col gap-2">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <CloseRoadPanel />
            <RequestPipeline />
          </div>
          <Tag>Vehicle movement is simulated, 4x</Tag>
        </section>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <FieldAccuracyDisclosure evaluation={evaluation} />
            <CorrectionsDisclosure evaluation={evaluation} />
            <LatencyDisclosure evaluation={evaluation} />
            <HonestyDisclosure honesty={results?.honesty ?? null} />
            <ChangeCasesDisclosure cases={results?.changeCases ?? null} />
          </div>
          <div className="flex flex-col gap-2">
            <SimulatorDisclosure simulator={results?.simulator ?? null} />
            <DoorFairnessDisclosure fairness={results?.doorFairness ?? null} />
            <PlanDisclosure />
            <CallbacksDisclosure />
            <AuditDisclosure />
          </div>
        </div>
      </main>
    </div>
  );
}
