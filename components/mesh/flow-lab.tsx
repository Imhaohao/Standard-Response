"use client";

import { Pause, Play } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { ChromeSurface, MapViewControl } from "@/components/map/map-bar";
import { MapStage, SurfaceMode } from "@/components/map/map-stage";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TOWN_FRAME } from "@/components/map/projection";
import { AppBar } from "@/components/ui/app-bar";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { buildGround, Ground } from "@/lib/crowd/grid";
import { Household } from "@/lib/crowd/langevin";
import { Checkpoint, DEFAULT_WORLD, FlowWorld } from "@/lib/flow/world";
import { ScenarioGeoJson } from "@/lib/ink-map/fire-field";
import { useHazard } from "@/lib/ink-map/hazard";
import { DEFAULT_TRAINING } from "@/lib/mesh/federated";
import { privacySpent } from "@/lib/mesh/privacy";
import { seededRandom } from "@/lib/mesh/random";
import { AgentLayer, BlockedStreetLayer, MeetingLayer } from "./flow-layers";
import { Figure, Figures, formatRange, Range } from "./figures";
import { HowItWorks, TechTags } from "./technology";

const VIEW = { kind: "overview", fit: TOWN_FRAME } as const;
// The browser runs a quarter of the synthetic town on a 30 m grid; scripts/mesh/simulate.ts runs more.
const SAMPLE = 0.25;
const CELL_METERS = 30;
const END_MINUTES = 300;
const CHECKPOINT_MINUTES = 10;
const FRAME_BUDGET_MS = 24;
const RENDER_EVERY_MS = 100;
const SPEEDS = [1, 3, 8].map((times) => ({ value: String(times), label: `${times}×` }));

type Comparison = { meshOn: Range; meshOff: Range; difference: Range };
type FlowResults = { label: string; seeds: number; householdsPerRun: number; results: Record<string, Comparison> };

function useFlowInputs() {
  const [inputs, setInputs] = useState<{ households: Household[]; results: FlowResults | null; scenario: ScenarioGeoJson | null } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([fetch("/api/flow").then((r) => r.json()), fetch("/api/scenario").then((r) => r.json())]).then(([flow, scenario]) => {
      if (live) setInputs({ households: flow.households ?? [], results: flow.results ?? null, scenario });
    });
    return () => {
      live = false;
    };
  }, []);
  return inputs;
}

function makeWorld(ground: Ground, households: Household[], mesh: boolean, seed: number) {
  const random = seededRandom(1000 + seed);
  const sample = households.filter(() => random() < SAMPLE);
  return new FlowWorld(ground, sample, { ...DEFAULT_WORLD, seed, mesh, crowd: { ...DEFAULT_WORLD.crowd, dt: 1 } });
}

// Steps the night inside a per-frame time budget, so the page stays responsive at any speed.
function useRunner(world: FlowWorld | null, playing: boolean, speed: number) {
  const [, setFrame] = useState(0);
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  useEffect(() => {
    if (!world) return;
    let raf = 0;
    let last = performance.now();
    let rendered = 0;
    let debt = 0;
    let nextCheckpoint = Math.floor(world.minutes / CHECKPOINT_MINUTES + 1) * CHECKPOINT_MINUTES;
    const loop = (t: number) => {
      const elapsed = Math.min(t - last, 250);
      last = t;
      if (playing && world.minutes < END_MINUTES) {
        debt = Math.min(debt + ((elapsed / 1000) * speed * 60) / world.params.crowd.dt, 600);
        const start = performance.now();
        while (debt >= 1 && performance.now() - start < FRAME_BUDGET_MS) {
          world.step();
          debt -= 1;
        }
        if (world.minutes >= nextCheckpoint) {
          setCheckpoint(world.checkpoint());
          nextCheckpoint += CHECKPOINT_MINUTES;
        }
      }
      if (t - rendered > RENDER_EVERY_MS) {
        rendered = t;
        setFrame((frame) => frame + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [world, playing, speed]);
  return checkpoint;
}

function NightPanel({ world, checkpoint }: { world: FlowWorld; checkpoint: Checkpoint | null }) {
  const stats = world.crowd.stats();
  return (
    <Panel title="Tonight, simulated" aside={<span className="type-small tabular-nums text-on-panel-muted">{world.crowd.count} homes</span>}>
      <TechTags uses={["langevin", "departure"]} />
      <Figures>
        <Figure label="Out of the zone" value={stats.arrived} />
        <Figure label="On the road" value={stats.moving} />
        <Figure label="Not left yet" value={stats.home} />
        <Figure label="Can't leave without help" value={stats.waiting} tone="signal" />
        <Figure label="Reached by the fire front" value={stats.overrun} />
        <Figure label="Drove into a blocked street they didn't know about" value={stats.discoveries} />
        {checkpoint && <Figure label="Traffic moving under 1 m/s" value={`${Math.round(checkpoint.crowd.jammedShare * 100)}%`} />}
      </Figures>
      <Bottlenecks world={world} />
    </Panel>
  );
}

// Where crowding costs the most driving time so far: cars through a street times the share of its
// free-flow speed they didn't get.
function Bottlenecks({ world }: { world: FlowWorld }) {
  const rows = world.crowd.bottlenecks(3);
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-panel-raised px-3 py-2">
      <p className="type-small mb-1 text-on-panel-muted">Slowest busy streets</p>
      <ol className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.segment} className="flex items-baseline justify-between gap-3">
            <span className="type-small truncate">{world.ground.segments[row.segment].name || "Unnamed road"}</span>
            <span className="type-small shrink-0 tabular-nums text-on-panel-muted">
              {row.entries} cars, {Math.round(row.meanSpeed * 3.6)} of {Math.round(row.freeSpeed * 3.6)} km/h
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MeshPanel({ world, checkpoint }: { world: FlowWorld; checkpoint: Checkpoint | null }) {
  return (
    <Panel title="Phones near each other">
      <TechTags uses={["mesh"]} />
      <Figures>
        <Figure label="Meetings so far" value={world.params.mesh ? world.meetings.toLocaleString() : "mesh off"} />
        <Figure label="Phones that know of a blocked street" value={checkpoint?.phonesKnowingABlockage ?? "—"} />
        <Figure label="Reports at the agency" value={world.agency.reportCount()} hint="Anonymous: a street, blocked or open, the minute" />
        <Figure label="Blocked streets the agency knows" value={checkpoint ? `${checkpoint.agencyKnowsBlocked} of ${checkpoint.phonesKnowBlocked} seen` : "—"} />
      </Figures>
    </Panel>
  );
}

const PRIVACY = privacySpent(DEFAULT_TRAINING.noiseMultiplier, DEFAULT_TRAINING.maxContributions);

function ModelPanel({ world, checkpoint }: { world: FlowWorld; checkpoint: Checkpoint | null }) {
  return (
    <Panel title="Shared model, trained on the phones">
      <TechTags uses={["federated"]} />
      <Figures>
        <Figure label="Version" value={world.agency.model.version} hint={`New version every ${world.params.roundMass} phones' worth of updates`} />
        <Figure label="Updates uploaded" value={`${Math.round(world.massUploaded)} phones' worth`} hint="Always mixed, at least 5 phones per upload" />
        <Figure label="Ranks blocked streets (AUC)" value={checkpoint ? checkpoint.auc.shared.toFixed(2) : "—"} hint="0.5 is guessing, 1 is perfect" />
        <Figure label="Same model with all raw data in one place" value={checkpoint ? checkpoint.auc.pooled.toFixed(2) : "—"} hint="What privacy costs: compare the two" />
        <Figure label="Most any one phone gives away" value={`ε ${PRIVACY.epsilon.toFixed(1)}`} hint={`δ = 1e-5, at most ${DEFAULT_TRAINING.maxContributions} updates each`} />
      </Figures>
      <HowItWorks tech="federated">Here: the phones in this simulated night train the model, and this panel tracks it.</HowItWorks>
    </Panel>
  );
}

const RESULT_ROWS = [
  { key: "phonesInformedAt30", label: "Phones that know of a blocked street, 30 min in", digits: 0 },
  { key: "discoveriesByDriving", label: "Drivers who hit a blocked street unaware", digits: 0 },
  { key: "sharedModelAuc", label: "Shared model AUC", digits: 2 },
  { key: "centralModelAuc", label: "Central model AUC (no privacy)", digits: 2 },
  { key: "agencyShareOfSeen", label: "Seen blockages the agency hears of", digits: 0, scale: 100 },
] as const;

function ResultsPanel({ results }: { results: FlowResults | null }) {
  if (!results) return null;
  return (
    <Panel title={`${results.seeds} nights, mesh on and off`}>
      <TechTags uses={["langevin", "mesh", "federated"]} />
      <dl className="flex flex-col gap-2 px-3 py-2">
        {RESULT_ROWS.map((row) => {
          const comparison = results.results[row.key];
          const scale = "scale" in row ? row.scale : 1;
          const unit = scale === 100 ? "%" : "";
          return (
            <div key={row.key}>
              <dt className="type-small text-on-panel-muted">{row.label}</dt>
              <dd className="type-small flex justify-between gap-3 tabular-nums">
                <span className="font-semibold">
                  On {formatRange(comparison?.meshOn, row.digits, scale)}
                  {unit}
                </span>
                <span className="text-on-panel-muted">
                  Off {formatRange(comparison?.meshOff, row.digits, scale)}
                  {unit}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="type-small border-t border-panel-raised px-3 py-2 text-on-panel-muted">
        Median (5th to 95th percentile) over {results.seeds} seeds, {results.householdsPerRun.toLocaleString()} homes each. Without the mesh no phone
        ever holds five phones&apos; worth of updates, so the shared model can&apos;t form at all.
      </p>
    </Panel>
  );
}

// What the night runs on, with the crowd model open: it is what moves every dot on the map.
function TechnologyPanel() {
  return (
    <Panel title="How this night is simulated">
      <HowItWorks tech="langevin" open>
        Here: every moving ink dot is a car under these dynamics, and they produce &ldquo;On the road&rdquo; and &ldquo;Slowest busy streets&rdquo;.
      </HowItWorks>
      <HowItWorks tech="departure">Here: when a faint dot (a home not left yet) starts moving.</HowItWorks>
      <HowItWorks tech="mesh">Here: the hairlines between dots are phones meeting, and heavy broken lines are blocked streets the agency has heard about.</HowItWorks>
      <HowItWorks tech="federated">Here: the shared model panel on the right.</HowItWorks>
    </Panel>
  );
}

function Controls(props: {
  world: FlowWorld;
  playing: boolean;
  speed: number;
  mesh: boolean;
  mode: SurfaceMode;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  onMesh: (mesh: boolean) => void;
  onNewNight: () => void;
  onMode: (mode: SurfaceMode) => void;
}) {
  const { world, playing, speed, mesh, mode } = props;
  return (
    <ChromeSurface className="flex flex-wrap items-center gap-2 p-1.5">
      <Button variant="onPanel" size="sm" square onClick={() => props.onPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <Pause weight="fill" className="size-4" /> : <Play weight="fill" className="size-4" />}
      </Button>
      <span className="type-figure w-28 text-center text-lg tabular-nums">{Math.floor(world.minutes)} min</span>
      <SegmentedControl options={SPEEDS} value={String(speed)} onChange={(next) => props.onSpeed(Number(next))} ariaLabel="Playback speed" />
      <div className="w-52">
        <Switch checked={mesh} onChange={props.onMesh} label="Phones share with each other" />
      </div>
      <Button variant="onPanelQuiet" size="sm" onClick={props.onNewNight}>
        Another night
      </Button>
      <MapViewControl mode={mode} onMode={props.onMode} />
    </ChromeSurface>
  );
}

export function FlowLab() {
  const data = useInkMapData();
  const hazard = useHazard(data?.origin);
  const inputs = useFlowInputs();
  const ground = useMemo(() => (inputs ? buildGround(CELL_METERS, inputs.scenario) : null), [inputs]);
  const [mesh, setMesh] = useState(true);
  const [seed, setSeed] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(3);
  const [mode, setMode] = useState<SurfaceMode>("ink");
  const world = useMemo(() => (ground && inputs ? makeWorld(ground, inputs.households, mesh, seed) : null), [ground, inputs, mesh, seed]);
  const checkpoint = useRunner(world, playing, speed);

  if (!data || !world) return <p className="type-body grid h-[100dvh] place-items-center text-ink-muted">Setting up the simulated night…</p>;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      {/* The fire on the map moves a whole minute at a time, so the 3D surface redraws once per minute, not per frame. */}
      <MapStage data={data} view={VIEW} mode={mode} hazard={hazard} minutes={Math.floor(world.minutes)} className="absolute inset-0">
        <BlockedStreetLayer truth={world.crowd.trulyBlocked()} known={world.agencyKnownBlocked()} />
        <MeetingLayer world={world} />
        <AgentLayer world={world} />
      </MapStage>
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <AppBar>
          <Link href="/mesh" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            A resident&apos;s phone
          </Link>
          <Link href="/mesh/agency" className="type-small font-semibold text-on-panel-muted hover:text-on-panel">
            What the agency received
          </Link>
        </AppBar>
        <div className="flex min-h-0 flex-1 items-stretch gap-3 p-3">
          <div className="pointer-events-auto flex w-[20rem] max-w-[40vw] shrink-0 flex-col gap-3 overflow-y-auto pr-1 *:shrink-0">
            <TechnologyPanel />
            <NightPanel world={world} checkpoint={checkpoint} />
            <MeshPanel world={world} checkpoint={checkpoint} />
          </div>
          <div className="min-w-0 flex-1" />
          <div className="pointer-events-auto flex w-[22rem] max-w-[40vw] shrink-0 flex-col gap-3 overflow-y-auto pl-1 *:shrink-0">
            <ModelPanel world={world} checkpoint={checkpoint} />
            <ResultsPanel results={inputs?.results ?? null} />
          </div>
        </div>
        <div className="flex items-end justify-center p-3">
          <Controls
            world={world}
            playing={playing}
            speed={speed}
            mesh={mesh}
            mode={mode}
            onPlaying={setPlaying}
            onSpeed={setSpeed}
            onMesh={setMesh}
            onNewNight={() => setSeed((s) => s + 1)}
            onMode={setMode}
          />
        </div>
      </div>
    </div>
  );
}
