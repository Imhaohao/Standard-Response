"use client";

import { Phone, PHONE } from "./call/phone";
import { RecordCard } from "./call/record-card";
import { ROSELAND_CALL } from "./call/roseland-call";
import { useCallClock } from "./call/use-call-clock";
import type { Beat } from "../script";
import { Show } from "../show";

export function CallScene({ beat }: { beat: Beat }) {
  const live = beat === "testCall";
  const seconds = useCallClock(ROSELAND_CALL.audio, live);
  return (
    <>
      <Show when={beat === "roseland" || live} rise={80} className="absolute" style={PHONE}>
        <Phone name={ROSELAND_CALL.name} live={live} seconds={seconds} turns={ROSELAND_CALL.transcript} file={ROSELAND_CALL.file} />
      </Show>
      <Show when={live} delay={0.4} className="absolute" style={{ left: PHONE.left + PHONE.width + 50, top: 240, width: 360 }}>
        <RecordCard fields={ROSELAND_CALL.record} seconds={seconds} />
      </Show>
    </>
  );
}
