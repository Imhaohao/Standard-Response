"use client";

import { MotionConfig } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { PRODUCT_NAME } from "@/lib/brand";
import { NightMap } from "./night-map/night-map";
import { useTown } from "./night-map/town";
import { useStoryMap } from "./night-map/use-story-map";
import { Rehearsal, toggleNotes, useNotesShown } from "./rehearsal";
import { PairingCard } from "./remote/pairing-card";
import { useRemote } from "./remote/use-remote";
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

// How long "Phone connected" stays up before the pairing card closes itself.
const PAIRED_CARD_MS = 1500;

export function Deck({ initial }: { initial: Position }) {
  const [position, setPosition] = useState(initial);
  const beat = beatAt(position);
  const notesShown = useNotesShown();
  const story = useStoryMap();
  const town = useTown(story);
  const [pairing, setPairing] = useState(false);

  const commands = useMemo(
    () => ({
      next: () => setPosition(advance),
      previous: () => setPosition(retreat),
      first: () => setPosition(start),
      last: () => setPosition(last()),
      notes: toggleNotes,
      pairing: () => setPairing((open) => !open),
    }),
    [],
  );
  useDeckControls(commands);
  const remote = useRemote({
    next: commands.next,
    previous: commands.previous,
    onPaired: () => window.setTimeout(() => setPairing(false), PAIRED_CARD_MS),
  });

  const search = toSearch(position);
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }, [search]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="cursor-none select-none" onClick={commands.next}>
        <h1 className="sr-only">{PRODUCT_NAME} pitch</h1>
        <p className="sr-only" aria-live="polite">{`Slide ${position.slide + 1} of ${slides.length}, beat ${position.beat + 1}`}</p>
        <Stage>
          {story && <NightMap beat={beat} story={story} town={town} />}
          <TitleScene beat={beat} />
          <StoryScene beat={beat} />
          <UsScene beat={beat} />
          <StationsScene beat={beat} />
          <DispatchScene beat={beat} />
          <CallsAtOnceScene beat={beat} />
          <CensusScene beat={beat} town={town} />
          <CallScene beat={beat} />
          <VoiceScene beat={beat} />
          <RescueScene beat={beat} />
          <ConvexScene beat={beat} />
          <ProofScene beat={beat} />
          <CloseScene beat={beat} />
          <PairingCard room={remote.room} shown={pairing} phoneConnected={remote.phoneConnected} />
        </Stage>
        <Rehearsal beat={beat} shown={notesShown} />
      </main>
    </MotionConfig>
  );
}
