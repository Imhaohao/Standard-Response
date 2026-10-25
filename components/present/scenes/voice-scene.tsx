"use client";

import { AnimatePresence, motion } from "motion/react";
import { quickFade } from "../motion";
import { isAtOrAfter, isBetween, type Beat } from "../script";
import { Show } from "../show";
import { LANGUAGES } from "./voice/languages";
import { Block, Caller, CLAUDE, Flows, INK, ModelRow, NODE, Pulse, RETURN_Y, SONIC } from "./voice/pipeline";
import { ProtocolCheck } from "./voice/protocol-check";
import { useTicker } from "./voice/use-ticker";

const TURN_MS = 2400;
const SWAP = { duration: 0.25, ease: [0.2, 0, 0, 1] } as const;

function Cycling({ text, className }: { text: string; className: string }) {
  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={text} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={SWAP}>
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// Each tick is one turn of the call in the next language: Ink hears it, Claude answers, Sonic speaks it.
function Pipeline({ beat }: { beat: Beat }) {
  const running = isBetween(beat, "ink", "claude");
  const turn = useTicker(running, TURN_MS);
  const language = LANGUAGES[turn % LANGUAGES.length];
  const speaking = isAtOrAfter(beat, "sonic");
  const thinking = beat === "claude";
  return (
    <motion.div className="absolute inset-0" initial={false} animate={{ opacity: running ? 1 : 0 }} transition={quickFade}>
      <Flows hearing={running} speaking={speaking} />
      {running && <Pulse turn={turn} roundTrip={speaking} durationMs={TURN_MS} />}
      <Caller shown={running} speaking={running} />
      <Block box={INK} maker="Cartesia" name="Ink" shown={running} />
      <Show when={running} className="absolute" style={{ left: INK.left, top: INK.top + INK.height + 36, width: INK.width }}>
        <Cycling text={language.name} className="type-deck-quote text-center" />
      </Show>
      <Block box={CLAUDE} maker="Anthropic" name="Claude" shown={isAtOrAfter(beat, "claude")}>
        <div className="mt-4 flex flex-col gap-4">
          <ModelRow name="Haiku" role="every turn" lit={thinking && turn % 2 === 0} />
          <ModelRow name="Opus" role="grades calls" lit={thinking && turn % 2 === 1} check />
        </div>
      </Block>
      <Block box={SONIC} maker="Cartesia" name="Sonic" shown={speaking} />
      <Show when={speaking} className="absolute" style={{ left: NODE.x + 60, top: RETURN_Y + 30, width: SONIC.left + SONIC.width - NODE.x - 120 }}>
        <Cycling text={`“${language.question}”`} className="type-deck-lede text-center" />
      </Show>
    </motion.div>
  );
}

export function VoiceScene({ beat }: { beat: Beat }) {
  return (
    <>
      <Pipeline beat={beat} />
      <ProtocolCheck shown={beat === "protocol"} />
    </>
  );
}
