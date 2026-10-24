"use client";

import { Lock, WifiHigh, WifiSlash } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useMemo } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { GeoAnchor, GeoLine } from "@/components/map/layers";
import { MapStage } from "@/components/map/map-stage";
import { TOWN_FRAME } from "@/components/map/projection";
import { createProjection, Point } from "@/lib/ink-map/data";
import { areaLabel } from "@/lib/prepare/areas";
import { UPLOAD_MIN_MASS } from "@/lib/prepare/mixing";
import { MAX_HOPS } from "@/lib/prepare/node";
import { answeredCount, Question, questionsFor, Topic, TOPIC_LABELS, TOPICS } from "@/lib/prepare/survey";
import { riskOf, SURVEY_TRAINING, TASK_IDS, TASKS } from "@/lib/prepare/tasks";
import { PRODUCT_NAME } from "@/lib/brand";
import { useNow } from "@/lib/time";
import { PairingCard } from "../mesh/pairing";
import { Switch } from "../ui/switch";
import { SurveyHowItWorks, SurveyTags } from "./technology";
import { SurveyPhoneState, useSurveyPhone } from "./use-survey-phone";

const INK = "var(--map-ink)";
const PAPER = "var(--map-paper)";
const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;

function Header({ survey }: { survey: SurveyPhoneState }) {
  return (
    <header className="flex items-center gap-3 px-4 py-3">
      <span className="size-3 shrink-0 bg-signal" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-heading">Readiness survey</span>
        <span className="type-small text-on-panel-muted">{PRODUCT_NAME}. Your answers stay on this phone.</span>
      </div>
      <span className="type-small flex items-center gap-1.5 font-semibold">
        {survey.online ? <WifiHigh weight="bold" className="size-4" /> : <WifiSlash weight="bold" className="size-4" />}
        {survey.online ? "Online" : "No signal"}
      </span>
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

function HomeCard({ survey }: { survey: SurveyPhoneState }) {
  const area = survey.phone.area;
  return (
    <section className="flex flex-col gap-1 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-heading">Where you live</h2>
        <span className="type-small text-on-panel-muted">{area ? areaLabel(area) : survey.home ? "Outside the survey area" : "Tap your home on the map"}</span>
      </div>
      <p className="type-small flex items-start gap-1.5 text-on-panel-muted">
        <Lock weight="bold" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        The pin stays on this phone. Only your census block group, a few hundred homes, goes into the counts.
      </p>
    </section>
  );
}

function QuestionRow({ question, value, onAnswer }: { question: Question; value: string | undefined; onAnswer: (value: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="type-small pb-1 font-semibold">{question.prompt}</legend>
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onAnswer(option.value)}
            className={`type-small min-h-8 px-2.5 py-1 text-left font-semibold ${value === option.value ? "bg-on-panel text-panel" : "bg-panel-raised text-on-panel"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function topicStatus(survey: SurveyPhoneState, topic: Topic) {
  const phone = survey.phone;
  const left = questionsFor(topic).length - answeredCount(phone.answers, topic);
  if (!phone.consent[topic]) return left > 0 ? `${left} question${left === 1 ? "" : "s"} left. Nothing is shared.` : "Answered. Nothing is shared.";
  if (left > 0) return `Shared once you've answered the last ${left === 1 ? "question" : `${left} questions`}.`;
  if (!phone.area) return "Shared once you've put your home on the map.";
  const spent = phone.privacy(topic);
  const tasks = TASK_IDS.filter((task) => TASKS[task].topic === topic);
  const updates = tasks.length ? ` Model updates: ${spent.updates} of ${SURVEY_TRAINING.maxContributions}.` : "";
  return `Counted.${updates} Privacy spent: ε ${spent.epsilon.toFixed(1)}.`;
}

function TopicCard({ survey, topic }: { survey: SurveyPhoneState; topic: Topic }) {
  const phone = survey.phone;
  const tasks = TASK_IDS.filter((task) => TASKS[task].topic === topic);
  return (
    <section className="flex flex-col gap-3 py-4">
      <div className="flex flex-col gap-1 px-4">
        <h2 className="type-heading">{TOPIC_LABELS[topic].title}</h2>
        <p className="type-small text-on-panel-muted">{TOPIC_LABELS[topic].why}</p>
      </div>
      <div className="flex flex-col gap-3 px-4">
        {questionsFor(topic).map((question) => (
          <QuestionRow key={question.id} question={question} value={phone.answers[question.id]} onAnswer={(value) => survey.answer({ [question.id]: value })} />
        ))}
      </div>
      <div className="flex flex-col">
        <SurveyTags uses={tasks.length ? ["randomized", "federated"] : ["randomized"]} className="px-4 pb-1" />
        <Switch
          checked={phone.consent[topic]}
          onChange={(agreed) => survey.setConsent(topic, agreed)}
          label={tasks.length ? "Count my answers and help train the model" : "Count my answers"}
          hint="Your answers never leave this phone. A coin-flipped yes or no, and a noised change to the model, go out mixed with other households'."
        />
        <p className="type-small px-4 pt-1 text-on-panel-muted">{topicStatus(survey, topic)}</p>
      </div>
    </section>
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
      <SurveyTags uses={["federated"]} className="pb-1" />
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
      <SurveyTags uses={["mixing"]} className="px-4 pt-1 pb-1" />
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

export function SurveyPhoneView() {
  const data = useInkMapData();
  const survey = useSurveyPhone();
  const projection = useMemo(() => createProjection(data?.origin ?? { lat: 0, lng: 0 }), [data?.origin]);
  const { setHome } = survey;
  const pick = useCallback((point: Point) => setHome(projection.toLatLng(point)), [projection, setHome]);

  return (
    <div className="min-h-[100dvh] bg-map-paper">
      <main className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col bg-panel text-on-panel shadow-[0_0_0_1px_oklch(0_0_0/0.08),0_24px_60px_oklch(0_0_0/0.18)]">
        <Header survey={survey} />
        <div className="relative h-[34dvh] min-h-56 overflow-hidden">
          {data ? (
            <MapStage data={data} view={VIEW} mode="paper" onPick={pick} interactive className="absolute inset-0">
              <AreaLayer survey={survey} />
            </MapStage>
          ) : (
            <p className="type-small grid h-full place-items-center bg-map-paper text-ink-muted">Loading the map…</p>
          )}
        </div>
        <div className="flex flex-col divide-y divide-panel-raised">
          <HomeCard survey={survey} />
          {TOPICS.map((topic) => (
            <TopicCard key={topic} survey={survey} topic={topic} />
          ))}
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
      </main>
    </div>
  );
}
