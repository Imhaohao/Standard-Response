"use client";

import { useEffect, useState } from "react";

export type Interval = [number, number];
export type Rate = { correct?: number; flagged?: number; total?: number; graded?: number; accuracy?: number; rate?: number; ci95: Interval };
export type Spread = { median: number; p5: number; p95: number; n: number };
export type MeanSpread = { mean: number; p5: number; p95: number };

export type Evaluation = {
  label: string;
  caveat?: string;
  agent: string;
  personas: number;
  completed: number;
  fields: Record<string, Rate>;
  allFieldsCorrect: Rate;
  corrections: Rate & { byWhen: Record<string, Rate> };
  latency: { turnMsP50: number; turnMsP95: number };
  completion: { secondsMedian: number; secondsP95: number };
};

export type Honesty = {
  label: string;
  linesGraded: number;
  lexical: Rate;
  model: Rate | null;
  byStatus: Record<string, Rate | null>;
  humanSpotCheck?: unknown;
};

export type SimComparison = { policies: Record<string, Record<string, Spread>>; difference: Record<string, Spread>; differenceMeaning: string; headline: string };

export type SensitivityRow = {
  factor: string;
  factorLabel: string;
  level: number;
  dispatchOnly: { pickupsOnTimeDifference: Spread };
  combined: { pickupsOnTimeDifference: Spread };
};

export type ExplorationScenario = "ownPace" | "withCalls" | "everyoneAtOnce";

export type Exploration = {
  label: string;
  question: string;
  seeds: number;
  scenarios: Record<ExplorationScenario, Record<string, Spread>>;
  scenarioMeaning: Record<ExplorationScenario, string>;
};

export type Simulator = {
  label: string;
  seeds: number;
  results: { dispatchOnly: SimComparison; outreachOnly: SimComparison; combined: SimComparison; todayProcess: { headline: string } };
  whereWeDontHelp?: string | string[];
  sensitivity?: SensitivityRow[];
  sensitivitySeeds?: number;
  exploration?: Exploration;
};

export type AlignmentEval = {
  key?: string;
  name: string;
  description: string;
  passed?: number;
  total?: number;
  rate?: number;
  ci95?: Interval;
  status?: string;
  byLanguage?: Record<"en" | "es", Record<string, number>>;
};

export type Alignment = { label: string; grader: string; evals: AlignmentEval[] };

export type VoiceExam = {
  label: string;
  verdict: "PASS" | "FAIL";
  passBar: number;
  items: number;
  criticalFailures: number;
  latencyMs: { p50: number; p95: number; budget: number };
  modules: { module: string; name: string; measures: string; passed: number; total: number; pass: boolean }[];
};

export type NeedScores = { auc: MeanSpread; top10Precision: MeanSpread; calibration: MeanSpread };

export type NeedModel = {
  label: string;
  censusPriorOnly: NeedScores;
  chosen: NeedScores & { kernelMeters: number; priorStrength: number };
  withNominations: NeedScores;
  readingTheResult: string;
};

export type DoorFairness = {
  label: string;
  results: Record<string, Record<string, Record<string, MeanSpread>>>;
  headlines: string[];
};

export type ChangeCases = {
  passed: number;
  total: number;
  results: { id: string; title: string; riderHears: string; pass: boolean; checks: { name: string; pass: boolean }[] }[];
};

export type Results = {
  simulator: Simulator | null;
  evaluation: Evaluation | null;
  honesty: Honesty | null;
  doorFairness: DoorFairness | null;
  changeCases: ChangeCases | null;
  alignment: Alignment | null;
  voiceExam: VoiceExam | null;
  needModel: NeedModel | null;
};

// The result files Tracks B, C and D write into data/. Re-read every 30 s so a fresh run shows up.
export function useResults() {
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/results")
        .then((response) => response.json() as Promise<Results>)
        .then((data) => live && setResults(data));
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return results;
}

export const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
