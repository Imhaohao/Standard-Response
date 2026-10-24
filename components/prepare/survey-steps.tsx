"use client";

import { Check, Lock } from "@phosphor-icons/react";
import { ReactNode, useEffect, useRef } from "react";
import { areaLabel } from "@/lib/prepare/areas";
import { Question, questionsFor, Topic, TOPIC_LABELS } from "@/lib/prepare/survey";
import { TASK_IDS, TASKS } from "@/lib/prepare/tasks";
import { Button } from "../ui/button";
import { SurveyHowItWorks } from "./technology";
import { SurveyPhoneState } from "./use-survey-phone";

// The survey is a run of single screens: where home is, one question at a time, and after each
// topic a plain choice about whether its answers are counted. Each screen asks for one thing.

export type Step = { kind: "home" } | { kind: "question"; topic: Topic; index: number } | { kind: "share"; topic: Topic } | { kind: "done" };

export function surveySteps(topics: Topic[]): Step[] {
  const topicSteps = topics.flatMap((topic): Step[] => [
    ...questionsFor(topic).map((_, index): Step => ({ kind: "question", topic, index })),
    { kind: "share", topic },
  ]);
  return [{ kind: "home" }, ...topicSteps, { kind: "done" }];
}

const ADVANCE_AFTER_MS = 220;

export const TOPIC_NOUNS: Record<Topic, string> = { water: "water", money: "money", health: "power and medicine" };

function StepFooter({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col gap-2 pt-6">{children}</div>;
}

export function HomeStep({ survey, map, onNext }: { survey: SurveyPhoneState; map: ReactNode; onNext: () => void }) {
  const area = survey.phone.area;
  return (
    <>
      <h1 className="type-title">Where&apos;s home?</h1>
      <div className="relative mt-4 h-[44dvh] min-h-64 overflow-hidden rounded-2xl bg-map-paper shadow-[inset_0_0_0_1px_oklch(0_0_0/0.06)]">
        {map}
        {!survey.home && (
          <span className="type-small pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-on-panel px-3 py-1.5 font-semibold text-panel shadow-float">
            Tap your home
          </span>
        )}
      </div>
      {survey.home && <p className="type-heading mt-3">{area ? areaLabel(area) : "Outside the survey area"}</p>}
      <p className="type-small mt-2 flex items-start gap-1.5 text-on-panel-muted">
        <Lock weight="bold" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        The pin stays on this phone. Counts only use your block group, a few hundred homes.
      </p>
      <StepFooter>
        <Button variant="onPanel" size="lg" disabled={!survey.home} onClick={onNext}>
          Continue
        </Button>
        {!survey.home && <QuietAction onClick={onNext}>Skip for now</QuietAction>}
      </StepFooter>
    </>
  );
}

function QuietAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="type-small h-11 rounded-xl font-semibold text-on-panel-muted hover:bg-panel-raised hover:text-on-panel focus-visible:outline-2 focus-visible:outline-on-panel">
      {children}
    </button>
  );
}

function TopicProgress({ topic, index }: { topic: Topic; index: number }) {
  const total = questionsFor(topic).length;
  return (
    <div className="flex items-center gap-3">
      <span className="type-small font-semibold text-on-panel-muted">{TOPIC_LABELS[topic].title}</span>
      <span className="flex flex-1 gap-1" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-on-panel" : "bg-panel-raised"}`} />
        ))}
      </span>
      <span className="type-small tabular-nums text-on-panel-muted">
        {index + 1} of {total}
      </span>
    </div>
  );
}

function AnswerOption({ label, chosen, onChoose }: { label: string; chosen: boolean; onChoose: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={chosen}
      onClick={onChoose}
      className={`type-body flex min-h-13 w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left font-semibold transition-[background-color,scale] duration-150 ease-[var(--ease-standard)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-panel ${
        chosen ? "bg-on-panel text-panel" : "bg-panel-raised text-on-panel hover:bg-line"
      }`}
    >
      {label}
      {chosen && <Check weight="bold" className="size-5 shrink-0" aria-hidden />}
    </button>
  );
}

export function QuestionStep({ survey, topic, index, onNext }: { survey: SurveyPhoneState; topic: Topic; index: number; onNext: () => void }) {
  const question: Question = questionsFor(topic)[index];
  const value = survey.phone.answers[question.id];
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const choose = (option: string) => {
    survey.answer({ [question.id]: option });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(onNext, ADVANCE_AFTER_MS);
  };
  return (
    <>
      <TopicProgress topic={topic} index={index} />
      {index === 0 && <p className="type-small mt-4 text-on-panel-muted">{TOPIC_LABELS[topic].why}</p>}
      <h1 className="type-title mt-5">{question.prompt}</h1>
      <div className="mt-5 flex flex-col gap-2">
        {question.options.map((option) => (
          <AnswerOption key={option.value} label={option.label} chosen={value === option.value} onChoose={() => choose(option.value)} />
        ))}
      </div>
      <StepFooter>
        <QuietAction onClick={onNext}>{value ? "Next" : "Skip this question"}</QuietAction>
      </StepFooter>
    </>
  );
}

const trainsModel = (topic: Topic) => TASK_IDS.some((task) => TASKS[task].topic === topic);

export function ShareStep({ survey, topic, onNext }: { survey: SurveyPhoneState; topic: Topic; onNext: () => void }) {
  const agreed = survey.phone.consent[topic];
  const choose = (share: boolean) => {
    survey.setConsent(topic, share);
    onNext();
  };
  return (
    <>
      <h1 className="type-title">Count your answers about {TOPIC_NOUNS[topic]}?</h1>
      <p className="type-body mt-3 text-on-panel-muted">
        Your answers never leave this phone. If you say yes, it sends a coin-flipped version of each one{trainsModel(topic) ? " and a blurred update to a shared model" : ""}, mixed with
        other households&apos; before the county sees anything.
      </p>
      <div className="mt-4 -mx-4">
        <SurveyHowItWorks tech="randomized" inset="px-4" />
        {trainsModel(topic) && <SurveyHowItWorks tech="federated" inset="px-4" />}
      </div>
      <StepFooter>
        <Button variant="onPanel" size="lg" onClick={() => choose(true)}>
          {agreed && <Check weight="bold" className="size-5" aria-hidden />}
          Count my answers
        </Button>
        <Button variant="onPanelQuiet" size="lg" onClick={() => choose(false)}>
          Keep them to myself
        </Button>
      </StepFooter>
    </>
  );
}
