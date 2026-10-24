"use client";

import { ArrowLeft, WifiSlash } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor, GeoLine } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { createProjection, Point } from "@/lib/ink-map/data";
import { UPLOAD_MIN_MASS } from "@/lib/prepare/mixing";
import { MAX_HOPS } from "@/lib/prepare/node";
import { answeredCount, questionsFor, Topic, TOPIC_LABELS, TOPICS } from "@/lib/prepare/survey";
import { riskOf } from "@/lib/prepare/tasks";
import { useNow } from "@/lib/time";
import { PairingCard } from "../mesh/pairing";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { HomeStep, QuestionStep, ShareStep, Step, surveySteps } from "./survey-steps";
import { SurveyHowItWorks } from "./technology";
import { SurveyPhoneState, useSurveyPhone } from "./use-survey-phone";
import { PhoneScreen } from "@/components/ui/phone-screen";

const INK = "var(--map-ink)";
const PAPER = "var(--map-paper)";
const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

const STEPS = surveySteps(TOPICS);

function Header({ survey, step, onBack }: { survey: SurveyPhoneState; step: number; onBack: (() => void) | null }) {
  return (
    <header className="sticky top-0 z-10 bg-panel/95 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-2">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" className="grid size-10 place-items-center rounded-full hover:bg-panel-raised focus-visible:outline-2 focus-visible:outline-on-panel">
            <ArrowLeft weight="bold" className="size-5" />
          </button>
        ) : (
          <span className="size-10" aria-hidden />
        )}
        <span className="flex flex-1 items-center justify-center gap-2">
          <span className="size-2.5 rounded-full bg-signal" aria-hidden />
          <span className="type-heading">Readiness survey</span>
        </span>
        <span className="grid size-10 place-items-center" title={survey.online ? undefined : "No signal. Your answers are saved on this phone."}>
          {!survey.online && <WifiSlash weight="bold" className="size-5 text-on-panel-muted" aria-label="No signal" />}
        </span>
      </div>
      <div className="h-0.5 bg-panel-raised" aria-hidden>
        <div className="h-full bg-on-panel transition-[width] duration-300 ease-[var(--ease-standard)]" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
      </div>
    </header>
  );
}

// Block groups in thin ink, the household's own outlined, and its home pin.
function AreaLayer({ survey }: { survey: SurveyPhoneState }) {
  const area = survey.phone.area;
  return (
    <g fill="none">
      {survey.shapes?.map((shape) =>
        shape.rings.map((ring, i) => (
          <GeoLine key={`${shape.id}-${i}`} route={ring} close stroke={INK} strokeOpacity={shape.id === area ? 0.9 : 0.25} strokeWidth={shape.id === area ? 2.5 : 1} />
        )),
      )}
      {survey.home && (
        <GeoAnchor at={survey.home}>
          <circle r={7} fill={PAPER} stroke={INK} strokeWidth={2.5} />
          <circle r={2.5} fill={INK} />
        </GeoAnchor>
      )}
    </g>
  );
}

function topicStatus(survey: SurveyPhoneState, topic: Topic) {
  const phone = survey.phone;
  const left = questionsFor(topic).length - answeredCount(phone.answers, topic);
  if (!phone.consent[topic]) return "Kept on this phone";
  if (left > 0) return `Counted once you answer ${left === 1 ? "the last question" : `${left} more`}`;
  if (!phone.area) return "Counted once your home is on the map";
  return "Counted";
}

function TopicSummary({ survey, topic, onChange }: { survey: SurveyPhoneState; topic: Topic; onChange: () => void }) {
  const total = questionsFor(topic).length;
  const answered = answeredCount(survey.phone.answers, topic);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-heading">{TOPIC_LABELS[topic].title}</span>
        <span className="type-small text-on-panel-muted">
          {answered} of {total} answered. {topicStatus(survey, topic)}.
        </span>
      </span>
      <Button variant="onPanelQuiet" size="sm" onClick={onChange}>
        Change
      </Button>
    </li>
  );
}

// What the shared water model says about this home, worked out on the phone.
function RiskCard({ survey }: { survey: SurveyPhoneState }) {
  const phone = survey.phone;
  const model = phone.models.water;
  const tested = phone.answers.waterTest === "failed" || phone.answers.waterTest === "passed";
  if (model.version === 0 || answeredCount(phone.answers, "water") < 4) return null;
  const risk = riskOf("water", model, phone.answers);
  return (
    <section className="flex flex-col gap-1 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-heading">Homes like yours</h2>
        <span className="type-figure text-lg tabular-nums">{Math.round(risk * 100)}%</span>
      </div>
      <p className="type-small text-on-panel-muted">
        Estimated chance that tap water in a home like yours fails a test{tested ? ", from homes that tested" : ""}. Worked out on this phone from the shared model (version {model.version}, trained by {Math.round(model.contributors)} households&apos; worth of updates).
        {risk >= 0.25 && !tested ? " The county gives out free test kits; ask for one." : ""}
      </p>
    </section>
  );
}

function SharingCard({ survey }: { survey: SurveyPhoneState }) {
  const held = survey.phone.pool.totalMass();
  const upload = survey.upload;
  const meeting = survey.lastMeeting;
  // The clock comes from an effect, so the server render never reads it.
  const now = useNow(30_000);
  const hops = now ? survey.phone.hops(now) : MAX_HOPS;
  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
        <h2 className="type-heading">Phones nearby</h2>
        <span className="type-figure text-lg tabular-nums">{survey.tabPeers + survey.links}</span>
      </div>
      <p className="type-small px-4 text-on-panel-muted">
        {survey.tabPeers} on this device, {survey.links} paired.
        {meeting && (meeting.massReceived > 0 || meeting.modelsUpdated > 0) ? ` Last meeting brought ${meeting.massReceived.toFixed(1)} households' worth${meeting.modelsUpdated ? " and a newer model" : ""}.` : ""}
      </p>
      <Switch
        checked={survey.gateway}
        onChange={survey.setGateway}
        label="Upload for others when I have internet"
        hint={`Sends the mixed sums this phone carries once they hold ${UPLOAD_MIN_MASS} or more households' worth. Nobody's answers are in them.`}
      />
      <dl className="flex flex-col gap-0.5 px-4 py-3">
        <Row label="Carrying" value={`${held.toFixed(1)} households' worth${held >= UPLOAD_MIN_MASS ? ", ready to upload" : ""}`} />
        <Row label="Steps to a gateway" value={hops >= MAX_HOPS ? "not known yet" : String(hops)} />
        {upload && <Row label="Last upload" value={upload.error ? upload.error : `${upload.households.toFixed(1)} households' worth`} />}
      </dl>
      <SurveyHowItWorks tech="mixing" inset="px-4">
        Here: what this phone carries for the households around it.
      </SurveyHowItWorks>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="type-small text-on-panel-muted">{label}</dt>
      <dd className="type-small text-right font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function DoneStep({ survey, onChangeTopic }: { survey: SurveyPhoneState; onChangeTopic: (topic: Topic) => void }) {
  return (
    <div className="-mx-4 flex flex-col divide-y divide-panel-raised">
      <h1 className="type-title px-4 pb-4">That&apos;s everything</h1>
      <ul className="flex flex-col">
        {TOPICS.map((topic) => (
          <TopicSummary key={topic} survey={survey} topic={topic} onChange={() => onChangeTopic(topic)} />
        ))}
      </ul>
      <RiskCard survey={survey} />
      <SharingCard survey={survey} />
      <PairingCard addLink={survey.addLink} links={survey.links} />
      <nav className="flex justify-between gap-3 px-4 py-4">
        <Link href="/mesh" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
          Road reports on the mesh
        </Link>
        <Link href="/prepare/county" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
          What the county learns
        </Link>
      </nav>
    </div>
  );
}

function SurveyMap({ survey }: { survey: SurveyPhoneState }) {
  const data = useInkMapData();
  const projection = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);
  const { setHome } = survey;
  const pick = useCallback((point: Point) => setHome(projection.toLatLng(point)), [projection, setHome]);
  if (!data) return <p className="type-small grid h-full place-items-center text-ink-muted">Loading the map…</p>;
  return (
    <MapStage data={data} view={VIEW} mode="paper" onPick={pick} interactive className="absolute inset-0">
      <AreaLayer survey={survey} />
    </MapStage>
  );
}

function StepScreen({ survey, step, onNext, onJump }: { survey: SurveyPhoneState; step: Step; onNext: () => void; onJump: (topic: Topic) => void }) {
  if (step.kind === "home") return <HomeStep survey={survey} map={<SurveyMap survey={survey} />} onNext={onNext} />;
  if (step.kind === "question") return <QuestionStep key={`${step.topic}-${step.index}`} survey={survey} topic={step.topic} index={step.index} onNext={onNext} />;
  if (step.kind === "share") return <ShareStep survey={survey} topic={step.topic} onNext={onNext} />;
  return <DoneStep survey={survey} onChangeTopic={onJump} />;
}

export function SurveyPhoneView() {
  const survey = useSurveyPhone();
  const [step, setStep] = useState(0);
  const go = useCallback((next: number) => {
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
    window.scrollTo({ top: 0 });
  }, []);
  const jumpToTopic = useCallback((topic: Topic) => go(STEPS.findIndex((candidate) => candidate.kind === "question" && candidate.topic === topic)), [go]);

  return (
    <PhoneScreen>
      <Header survey={survey} step={step} onBack={step > 0 ? () => go(step - 1) : null} />
      <div className="flex flex-1 flex-col px-4 pt-5 pb-6">
        <StepScreen survey={survey} step={STEPS[step]} onNext={() => go(step + 1)} onJump={jumpToTopic} />
      </div>
    </PhoneScreen>
  );
}
