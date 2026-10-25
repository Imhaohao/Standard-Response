"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInkMapData } from "@/components/ink-map/ink-map-canvas";
import { ChromeSurface } from "@/components/map/map-bar";
import { MapStage } from "@/components/map/map-stage";
import { ReplayOverlay, ReplayTally, replayLastMinute, useReplay, useReplayCount, useReplayHighlights } from "@/components/replay/replay-layer";
import { ScenarioScrubber } from "@/components/map/scenario-scrubber";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { CITIES, City, cityById } from "@/lib/cities";
import type { Hazard } from "@/lib/ink-map/hazard";
import type { InkMapRenderer } from "@/lib/ink-map/renderer";
import { cityView, frameByName } from "@/lib/ink-map/scene-frames";
import { useScenario } from "@/lib/ink-map/use-scenario";
import { usePlayback, useSceneDriver } from "./use-scene-driver";

export type SceneParams = {
  city: string | null;
  minutes: number | null;
  play: boolean;
  speed: number | null;
  frame: string | null;
  chrome: boolean;
  replay: boolean;
};

const DEFAULT_SPEED = 5;

function useWindowAspect() {
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => setAspect(Math.round((window.innerWidth / window.innerHeight) * 100) / 100);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return aspect;
}

// Keeps the address bar in step, so the URL on screen always reopens this exact scene.
function useSceneUrl(city: City, frame: string) {
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("city", city.id);
    url.searchParams.set("frame", frame);
    window.history.replaceState(null, "", url);
  }, [city.id, frame]);
}

const scenarioLastMinute = (hazard: Hazard | null) => hazard?.scenario?.clock.minutesShown ?? hazard?.field.fronts.at(-1)?.minutes ?? 0;

// A hazard that arrives hours after the warning (the Lower Ninth's breach is at minute 1050) opens half
// an hour before its first front, so the scene starts on the water rather than on a quiet town.
const LATE_ARRIVAL_MINUTES = 60;
const LEAD_MINUTES = 30;

function scenarioFirstMinute(hazard: Hazard | null) {
  const arrival = hazard?.field.fronts[0]?.minutes ?? 0;
  return arrival > LATE_ARRIVAL_MINUTES ? arrival - LEAD_MINUTES : 0;
}

// Moves the clock to the start of a late hazard's window once it loads, unless the address asked for a minute.
function useStartNearArrival(hazard: Hazard | null, asked: number | null, setMinutes: (minutes: number) => void) {
  const first = scenarioFirstMinute(hazard);
  useEffect(() => {
    if (asked === null && first > 0) setMinutes(first);
  }, [first, asked, setMinutes]);
  return first;
}

// One city's disaster, full bleed, on a fixed camera, with nothing that needs Convex: the bench the
// hazard renderers are built on and the page the video recorder drives through window.__scene.
export function SceneLab({ params }: { params: SceneParams }) {
  const [city, setCity] = useState(() => cityById(params.city));
  const data = useInkMapData(city.id);
  const hazard = useScenario(city.id);
  const [frameName, setFrameName] = useState(() => frameByName(city, params.frame).name);
  const frame = frameByName(city, frameName);
  const aspect = useWindowAspect();
  const view = useMemo(() => (aspect ? cityView(city, frame, aspect) : null), [city, frame, aspect]);
  const replay = useReplay(params.replay ? city.id : null);
  const last = Math.max(scenarioLastMinute(hazard), replayLastMinute(replay));
  const playback = usePlayback(last, { minutes: params.minutes ?? 0, play: params.play, speed: params.speed ?? DEFAULT_SPEED });
  const first = useStartNearArrival(hazard, params.minutes, playback.setMinutes);
  const [renderer, setRenderer] = useState<InkMapRenderer | null>(null);
  useSceneUrl(city, frame.name);

  const { setPlaying, setSpeed } = playback;
  const play = useCallback(
    (speed?: number) => {
      if (speed !== undefined) setSpeed(speed);
      setPlaying(true);
    },
    [setPlaying, setSpeed],
  );
  const pause = useCallback(() => setPlaying(false), [setPlaying]);
  const highlights = useReplayHighlights(replay, data, playback.minutes);
  const count = useReplayCount(replay, playback.minutes);
  useSceneDriver({
    renderer,
    hazardShown: hazard !== null,
    minutes: playback.minutes,
    last,
    frames: city.frames.map((each) => each.name),
    frame: frame.name,
    setMinutes: playback.setMinutes,
    play,
    pause,
    setFrame: setFrameName,
  });

  const chooseCity = (id: string) => {
    const next = cityById(id);
    setCity(next);
    setFrameName(next.frames[0].name);
    playback.setMinutes(0);
  };

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-map-paper">
      <SceneMap data={data} view={view} hazard={hazard} minutes={playback.minutes} replay={replay} highlights={highlights} onRenderer={setRenderer} />
      {count && (
        <div className="pointer-events-none absolute start-4 top-4">
          <ReplayTally count={count} />
        </div>
      )}
      {params.chrome && (
        <SceneControls
          city={city}
          frameName={frame.name}
          onCity={chooseCity}
          onFrame={setFrameName}
          minutes={playback.minutes}
          first={first}
          last={last}
          playing={playback.playing}
          onMinutes={playback.setMinutes}
          onPlaying={playback.setPlaying}
        />
      )}
    </div>
  );
}

type SceneMapProps = {
  data: ReturnType<typeof useInkMapData>;
  view: ReturnType<typeof cityView> | null;
  hazard: Hazard | null;
  minutes: number;
  replay: ReturnType<typeof useReplay>;
  highlights: ReturnType<typeof useReplayHighlights>;
  onRenderer: (renderer: InkMapRenderer | null) => void;
};

function SceneMap({ data, view, hazard, minutes, replay, highlights, onRenderer }: SceneMapProps) {
  if (!data || !view) return null;
  return (
    <MapStage data={data} view={view} hazard={hazard} minutes={minutes} highlights={replay ? highlights : undefined} onRenderer={onRenderer}>
      {replay && <ReplayOverlay replay={replay} minute={minutes} />}
    </MapStage>
  );
}

type ControlsProps = {
  city: City;
  frameName: string;
  onCity: (id: string) => void;
  onFrame: (name: string) => void;
  minutes: number;
  first: number;
  last: number;
  playing: boolean;
  onMinutes: (minutes: number) => void;
  onPlaying: (playing: boolean) => void;
};

function SceneControls({ city, frameName, onCity, onFrame, minutes, first, last, playing, onMinutes, onPlaying }: ControlsProps) {
  const frames = city.frames.map((frame) => ({ value: frame.name, label: frame.label }));
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-4 flex justify-center">
      <ChromeSurface className="flex w-full max-w-4xl flex-wrap items-center gap-3 p-2 text-on-panel">
        <Button variant="onPanel" size="sm" square onClick={() => onPlaying(!playing)} aria-label={playing ? "Pause the scenario" : "Play the scenario"}>
          {playing ? <Pause weight="fill" className="size-4" /> : <Play weight="fill" className="size-4" />}
        </Button>
        <ScenarioScrubber minutes={minutes} first={first} last={last} onMinutes={onMinutes} label={`${city.event.name} scenario`} step={0.1} />
        <SegmentedControl options={frames} value={frameName} onChange={onFrame} ariaLabel="Camera" />
        <select
          value={city.id}
          onChange={(event) => onCity(event.target.value)}
          aria-label="City"
          className="type-small h-8 rounded-lg bg-panel-raised px-2 font-semibold text-on-panel focus-visible:outline-2 focus-visible:outline-on-panel"
        >
          {CITIES.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}: {each.event.name}
            </option>
          ))}
        </select>
      </ChromeSurface>
    </div>
  );
}
