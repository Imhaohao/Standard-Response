"use client";

import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { ScreenPoint } from "@/lib/ink-map/renderer";
import { NightMap } from "./night-map/night-map";
import { useStoryMap } from "./night-map/use-story-map";
import { Rehearsal, toggleNotes, useNotesShown } from "./rehearsal";
import { CallScene } from "./scenes/call-scene";
import { CallsAtOnceScene } from "./scenes/calls-at-once-scene";
import { CensusScene } from "./scenes/census-scene";
import { CloseScene } from "./scenes/close-scene";
import { ConvexScene } from "./scenes/convex-scene";
import { DispatchScene } from "./scenes/dispatch-scene";
import { ProofScene } from "./scenes/proof-scene";
import { RescueScene } from "./scenes/rescue-scene";
import { StationsScene } from "./scenes/stations-scene";
import { StoryScene } from "./scenes/story-scene";
import { TitleScene } from "./scenes/title-scene";
import { UsScene } from "./scenes/us-scene";
import { VoiceScene } from "./scenes/voice-scene";
import { slides } from "./script";
import { Stage } from "./stage";
import { advance, beatAt, last, retreat, start, toSearch, type Position } from "./timeline";
import { useDeckControls } from "./use-deck-controls";

export function Deck({ initial }: { initial: Position }) {
  const [position, setPosition] = useState(initial);
  const beat = beatAt(position);
  const notesShown = useNotesShown();
  const story = useStoryMap();
  const [houseAt, setHouseAt] = useState<ScreenPoint | null>(null);

  const commands = useMemo(
    () => ({
      next: () => setPosition(advance),
      previous: () => setPosition(retreat),
      first: () => setPosition(start),
      last: () => setPosition(last()),
      notes: toggleNotes,
    }),
    [],
  );
  useDeckControls(commands);

  const search = toSearch(position);
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }, [search]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="cursor-none select-none" onClick={commands.next}>
        <h1 className="sr-only">Standard Response pitch</h1>
        <p className="sr-only" aria-live="polite">{`Slide ${position.slide + 1} of ${slides.length}, beat ${position.beat + 1}`}</p>
        <Stage>
          {story && <NightMap beat={beat} story={story} houseAt={houseAt} setHouseAt={setHouseAt} />}
          <TitleScene beat={beat} />
          <StoryScene beat={beat} houseAt={houseAt} />
          <UsScene beat={beat} />
          <StationsScene beat={beat} />
          <DispatchScene beat={beat} />
          <CallsAtOnceScene beat={beat} />
          <CensusScene beat={beat} />
          <CallScene beat={beat} />
          <VoiceScene beat={beat} />
          <RescueScene beat={beat} />
          <ConvexScene beat={beat} />
          <ProofScene beat={beat} />
          <CloseScene beat={beat} />
        </Stage>
        <Rehearsal beat={beat} shown={notesShown} />
      </main>
    </MotionConfig>
  );
}
