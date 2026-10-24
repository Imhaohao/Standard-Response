"use client";

import { useMutation } from "convex/react";
import { ArrowLeft, ArrowRight, CheckCircle, Minus, PawPrint, Plus, type Icon } from "@phosphor-icons/react";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { Button } from "../ui/button";
import { HomePicker } from "./home-picker";
import { ASSIST_LABELS, Assistance, Bedroom, BedroomDiagram, bedroomLabel, CARE_OPTIONS, CareNeed, EXIT_OPTIONS, ExitPlan, InsideFacts, Mobility, MOBILITY_OPTIONS } from "./profile";
import { PhoneScreen } from "@/components/ui/phone-screen";

// A household signs itself up for the Ready check on its own phone: one question a screen, big
// targets, nothing to type that a tap can answer. The agent calls back to confirm before it counts.

type Medical = "oxygen" | "dialysis" | "other";

type Answers = {
  phone: string;
  address: string;
  language: "en" | "es";
  at: LatLng | null;
  residentName: string;
  peopleCount: number;
  mobility?: Mobility;
  assistanceRequired?: Assistance;
  medical: Medical[];
  care: CareNeed[];
  pets: boolean;
  bedroom?: Bedroom;
  exitPlan?: ExitPlan;
  helperName: string;
  helperPhone: string;
  helperRelation: string;
  note: string;
};

const START: Answers = {
  phone: "",
  address: "",
  language: "en",
  at: null,
  residentName: "",
  peopleCount: 1,
  medical: [],
  care: [],
  pets: false,
  helperName: "",
  helperPhone: "",
  helperRelation: "",
  note: "",
};

type StepProps = { answers: Answers; set: (patch: Partial<Answers>) => void };

const INPUT = "type-body h-12 w-full rounded-xl border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="type-small font-semibold">{label}</span>
      {children}
    </label>
  );
}

function Tile({ selected, onClick, Icon, label, glyph }: { selected: boolean; onClick: () => void; Icon?: Icon; label: string; glyph?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-center transition-[background-color,scale] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        selected ? "bg-ink text-canvas" : "bg-surface-sunk text-ink hover:bg-line"
      }`}
    >
      {Icon ? <Icon weight={selected ? "fill" : "bold"} className="size-7" /> : <span className="type-figure text-2xl">{glyph}</span>}
      <span className="type-small font-semibold">{label}</span>
    </button>
  );
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);

function WhereStep({ answers, set }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Your address">
        <input className={INPUT} value={answers.address} onChange={(event) => set({ address: event.target.value })} placeholder="1182 Mariposa St" autoComplete="street-address" />
      </Field>
      <Field label="Phone number we can call">
        <input className={INPUT} value={answers.phone} onChange={(event) => set({ phone: event.target.value })} placeholder="(626) 555-0142" inputMode="tel" autoComplete="tel" />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="type-small font-semibold">Tap your home</span>
        <HomePicker value={answers.at} onPick={(at) => set({ at })} />
      </div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Language for calls">
        <Tile selected={answers.language === "en"} onClick={() => set({ language: "en" })} glyph="En" label="English" />
        <Tile selected={answers.language === "es"} onClick={() => set({ language: "es" })} glyph="Es" label="Español" />
      </div>
    </div>
  );
}

function PeopleStep({ answers, set }: StepProps) {
  const limited = answers.mobility !== undefined && answers.mobility !== "walks";
  return (
    <div className="flex flex-col gap-5">
      <Field label="Name of the person who might need help">
        <input className={INPUT} value={answers.residentName} onChange={(event) => set({ residentName: event.target.value })} placeholder="Walter" autoComplete="name" />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="type-small font-semibold">People living here</span>
        <div className="flex items-center justify-between rounded-2xl bg-surface-sunk p-2">
          <Button variant="quiet" size="lg" square className="!bg-surface" aria-label="One fewer" onClick={() => set({ peopleCount: Math.max(1, answers.peopleCount - 1) })}>
            <Minus weight="bold" className="size-6" />
          </Button>
          <span className="type-figure text-5xl tabular-nums">{answers.peopleCount}</span>
          <Button variant="quiet" size="lg" square className="!bg-surface" aria-label="One more" onClick={() => set({ peopleCount: answers.peopleCount + 1 })}>
            <Plus weight="bold" className="size-6" />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5" role="group" aria-label="Getting around">
        <span className="type-small font-semibold">Getting around</span>
        <div className="grid grid-cols-3 gap-2">
          {MOBILITY_OPTIONS.map(({ key, label, Icon }) => (
            <Tile key={key} selected={answers.mobility === key} onClick={() => set({ mobility: key })} Icon={Icon} label={label} />
          ))}
        </div>
      </div>
      {limited && (
        <div className="flex flex-col gap-1.5" role="group" aria-label="Help getting out of the house">
          <span className="type-small font-semibold">Help getting out of the house</span>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(ASSIST_LABELS) as Assistance[]).map((key) => (
              <Tile key={key} selected={answers.assistanceRequired === key} onClick={() => set({ assistanceRequired: key })} glyph={key === "none" ? "0" : key === "one_person_assist" ? "1" : "2"} label={ASSIST_LABELS[key]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const MEDICAL: { key: Medical; label: string; glyph: string }[] = [
  { key: "oxygen", label: "Oxygen", glyph: "O₂" },
  { key: "dialysis", label: "Dialysis", glyph: "D" },
  { key: "other", label: "Other medical", glyph: "+" },
];

function HealthStep({ answers, set }: StepProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5" role="group" aria-label="Medical needs">
        <span className="type-small font-semibold">Medical needs</span>
        <div className="grid grid-cols-3 gap-2">
          {MEDICAL.map(({ key, label, glyph }) => (
            <Tile key={key} selected={answers.medical.includes(key)} onClick={() => set({ medical: toggle(answers.medical, key) })} glyph={glyph} label={label} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5" role="group" aria-label="Anything else a crew should plan for">
        <span className="type-small font-semibold">Anything else a crew should plan for</span>
        <div className="grid grid-cols-3 gap-2">
          {CARE_OPTIONS.map(({ key, label, Icon }) => (
            <Tile key={key} selected={answers.care.includes(key)} onClick={() => set({ care: toggle(answers.care, key) })} Icon={Icon} label={label} />
          ))}
          <Tile selected={answers.pets} onClick={() => set({ pets: !answers.pets })} Icon={PawPrint} label="Pets" />
        </div>
      </div>
    </div>
  );
}

function SleepStep({ answers, set }: StepProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <BedroomDiagram bedroom={answers.bedroom} onPick={(bedroom) => set({ bedroom })} large />
      <p className="type-heading h-6" aria-live="polite">
        {answers.bedroom ? bedroomLabel(answers.bedroom) : "Tap the room"}
      </p>
    </div>
  );
}

function PlanStep({ answers, set }: StepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="How you'd get out">
        {EXIT_OPTIONS.map(({ key, label, Icon }) => (
          <Tile key={key} selected={answers.exitPlan === key} onClick={() => set({ exitPlan: key })} Icon={Icon} label={label} />
        ))}
      </div>
      {answers.exitPlan === "helper" && (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-sunk p-3">
          <Field label="Their name">
            <input className={INPUT} value={answers.helperName} onChange={(event) => set({ helperName: event.target.value })} placeholder="Ana" />
          </Field>
          <Field label="Their phone">
            <input className={INPUT} value={answers.helperPhone} onChange={(event) => set({ helperPhone: event.target.value })} placeholder="(626) 555-0199" inputMode="tel" />
          </Field>
          <Field label="Who they are to you">
            <input className={INPUT} value={answers.helperRelation} onChange={(event) => set({ helperRelation: event.target.value })} placeholder="Neighbor, daughter, friend from church" />
          </Field>
        </div>
      )}
      <Field label="Anything a crew should know (optional)">
        <textarea className={`${INPUT} h-24 resize-none py-2`} value={answers.note} onChange={(event) => set({ note: event.target.value })} placeholder="Key under the planter, gate code, the dog is friendly" />
      </Field>
    </div>
  );
}

type Step = { title: string; Body: (props: StepProps) => ReactNode; ready: (answers: Answers) => boolean };

const helperComplete = (answers: Answers) => answers.exitPlan !== "helper" || (answers.helperName.trim() !== "" && answers.helperPhone.trim() !== "");

const STEPS: Step[] = [
  { title: "Where do you live?", Body: WhereStep, ready: (a) => a.address.trim() !== "" && a.phone.trim() !== "" && a.at !== null },
  { title: "Who lives here?", Body: PeopleStep, ready: (a) => a.mobility !== undefined },
  { title: "What should a crew know?", Body: HealthStep, ready: () => true },
  { title: "Where do they sleep?", Body: SleepStep, ready: (a) => a.bedroom !== undefined },
  { title: "If you had to leave tonight, how would you get out?", Body: PlanStep, ready: (a) => a.exitPlan !== undefined && helperComplete(a) },
];

function submission(answers: Answers) {
  const at = answers.at!;
  const blank = (value: string) => (value.trim() === "" ? undefined : value.trim());
  const helper = answers.exitPlan === "helper" ? { name: answers.helperName.trim(), phone: answers.helperPhone.trim(), relation: blank(answers.helperRelation) } : undefined;
  return {
    phone: answers.phone.trim(),
    address: answers.address.trim(),
    lat: at.lat,
    lng: at.lng,
    language: answers.language,
    residentName: blank(answers.residentName),
    peopleCount: answers.peopleCount,
    mobility: answers.mobility,
    assistanceRequired: answers.mobility === "walks" ? "none" as const : answers.assistanceRequired,
    medical: answers.medical,
    pets: answers.pets,
    hasCar: answers.exitPlan === "own_car",
    exitPlan: answers.exitPlan!,
    bedroom: answers.bedroom,
    care: answers.care,
    note: blank(answers.note),
    helper,
  };
}

function Done({ answers, onAgain }: { answers: Answers; onAgain: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-5 px-5 py-8">
      <CheckCircle weight="fill" className="size-14" />
      <h1 className="type-display">You&apos;re on the Ready list</h1>
      <p className="type-body text-ink-muted">We&apos;ll call {answers.phone} to confirm. If an evacuation is ever ordered, we call {answers.exitPlan === "helper" ? answers.helperName : "you"} first, and send a van if that falls through.</p>
      <div className="card p-4">
        <InsideFacts ready={{ at: 0, via: "form", verified: false, exitPlan: answers.exitPlan!, bedroom: answers.bedroom, care: answers.care, note: answers.note.trim() || undefined }} />
      </div>
      <Button variant="quiet" className="self-start" onClick={onAgain}>
        Sign up another home
      </Button>
    </div>
  );
}

function Progress({ step }: { step: number }) {
  return (
    <ol className="flex gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((_, index) => (
        <li key={index} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${index <= step ? "bg-ink" : "bg-line"}`} />
      ))}
    </ol>
  );
}

export function ReadySignUp() {
  const [answers, setAnswers] = useState<Answers>(START);
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = useMutation(api.ready.submit);
  const set = (patch: Partial<Answers>) => setAnswers((current) => ({ ...current, ...patch }));
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  const next = async () => {
    if (!last) return setStep(step + 1);
    setError(null);
    try {
      await submit(submission(answers));
      setSent(true);
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    }
  };

  return (
    <PhoneScreen surface="canvas">
      {sent ? (
        <Done answers={answers} onAgain={() => { setAnswers(START); setStep(0); setSent(false); }} />
      ) : (
        <>
          <header className="flex flex-col gap-4 px-5 pt-6 pb-4">
            <Progress step={step} />
            <h1 className="type-title text-2xl">{current.title}</h1>
          </header>
          <div className="flex-1 px-5 pb-28">
            <current.Body answers={answers} set={set} />
          </div>
          {error && <p role="alert" className="type-small px-5 pb-2 text-signal">{error}</p>}
          <footer className="sticky bottom-0 flex items-center gap-3 bg-canvas/95 px-5 py-4 backdrop-blur-md">
            {step > 0 && (
              <Button variant="quiet" size="lg" square aria-label="Back" onClick={() => setStep(step - 1)}>
                <ArrowLeft weight="bold" className="size-5" />
              </Button>
            )}
            <Button size="lg" className="flex-1" disabled={!current.ready(answers)} onClick={() => void next()}>
              {last ? "Put us on the Ready list" : "Next"}
              {!last && <ArrowRight weight="bold" className="size-5" />}
            </Button>
          </footer>
        </>
      )}
    </PhoneScreen>
  );
}
