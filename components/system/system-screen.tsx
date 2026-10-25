"use client";

import { AppBar } from "../ui/app-bar";
import { AnswerTiles } from "./answer-tiles";
import { ChangeCasesDisclosure, CorrectionsDisclosure, FieldAccuracyDisclosure, HonestyDisclosure, LatencyDisclosure } from "./call-panels";
import { CloseRoadPanel } from "./close-road";
import { DoorFairnessDisclosure, SimulatorDisclosure } from "./dispatch-panels";
import { AuditDisclosure, CallbacksDisclosure, PlanDisclosure, RequestPipeline, useCallbackSpread } from "./live-panels";
import { Tag } from "../ui/tag";
import { AlignmentDisclosure, VoiceExamDisclosure } from "./agent-panels";
import { ArchitectureDisclosure } from "./architecture";
import { ExplorationDisclosure, NeedModelDisclosure, SensitivityDisclosure } from "./model-panels";
import { Results, useResults } from "./results";

// Four answers a judge asks for first, the live demo controls, then everything behind disclosures.
export function SystemScreen() {
  const results = useResults();
  const callbackSpread = useCallbackSpread();
  return (
    <div className="min-h-[100dvh] bg-map-paper">
      <div className="sticky top-0 z-20">
        <AppBar />
      </div>
      <main className="mx-auto flex w-full max-w-[90rem] flex-col gap-4 p-4">
        <AnswerTiles results={results} callbackSpread={callbackSpread} />
        <section aria-label="Right now" className="flex flex-col gap-2">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <CloseRoadPanel />
            <RequestPipeline />
          </div>
          <Tag>Simulated vans drive at city speed (7 m/s), sped up by the rescue map&apos;s playback speed</Tag>
        </section>
        <ArchitectureDisclosure />
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 lg:grid-cols-2">
          <CallEvidence results={results} />
          <DispatchEvidence results={results} />
        </div>
      </main>
    </div>
  );
}

function CallEvidence({ results }: { results: Results | null }) {
  const evaluation = results?.evaluation ?? null;
  return (
    <div className="flex flex-col gap-2">
      <FieldAccuracyDisclosure evaluation={evaluation} />
      <CorrectionsDisclosure evaluation={evaluation} />
      <LatencyDisclosure evaluation={evaluation} />
      <HonestyDisclosure honesty={results?.honesty ?? null} />
      <ChangeCasesDisclosure cases={results?.changeCases ?? null} />
      <AlignmentDisclosure alignment={results?.alignment ?? null} />
      <VoiceExamDisclosure exam={results?.voiceExam ?? null} />
    </div>
  );
}

function DispatchEvidence({ results }: { results: Results | null }) {
  const simulator = results?.simulator ?? null;
  return (
    <div className="flex flex-col gap-2">
      <SimulatorDisclosure simulator={simulator} />
      <SensitivityDisclosure simulator={simulator} />
      <ExplorationDisclosure simulator={simulator} />
      <DoorFairnessDisclosure fairness={results?.doorFairness ?? null} />
      <NeedModelDisclosure model={results?.needModel ?? null} />
      <PlanDisclosure />
      <CallbacksDisclosure />
      <AuditDisclosure />
    </div>
  );
}
