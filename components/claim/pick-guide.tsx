"use client";

import { ArrowCounterClockwise, Shuffle } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { HomeMark, MAP_TONE } from "@/components/floor/household-mark";

function MarkSample({ open }: { open: boolean }) {
  return (
    <svg viewBox="-8 -8 16 16" className="size-4 shrink-0" aria-hidden>
      {open ? <HomeMark kind="waiting" r={5.5} tone={MAP_TONE} /> : <circle r={2.4} fill="var(--map-ink)" fillOpacity={0.22} />}
    </svg>
  );
}

// Step two, in the corner of the map. The key matches the marks on the map, and "Pick one for me"
// is the way to choose without a pointer.
export function PickGuide({ phoneEnding, openCount, onSurprise, onStartOver }: { phoneEnding: string; openCount: number; onSurprise: () => void; onStartOver: () => void }) {
  return (
    <section aria-labelledby="pick-heading" className="card pointer-events-auto flex w-[22rem] max-w-full flex-col gap-4 p-5">
      <div>
        <h1 id="pick-heading" className="type-title">
          Tap a house to take it
        </h1>
        <p className="type-small mt-1 text-on-panel-muted">
          Signed in as the number ending <span className="font-semibold text-on-panel tabular-nums">{phoneEnding}</span>
        </p>
      </div>
      <dl className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2.5">
          <MarkSample open />
          <dt className="type-small flex-1">Open</dt>
          <dd className="type-figure text-xl tabular-nums">{openCount}</dd>
        </div>
        <div className="flex items-center gap-2.5">
          <MarkSample open={false} />
          <dt className="type-small text-on-panel-muted">Taken, or on a call now</dt>
        </div>
      </dl>
      <div className="flex gap-2">
        <Button variant="onPanel" size="md" onClick={onSurprise} disabled={openCount === 0} className="flex-1">
          <Shuffle weight="bold" className="size-4" />
          Pick one for me
        </Button>
        <Button variant="onPanelQuiet" size="md" onClick={onStartOver}>
          <ArrowCounterClockwise weight="bold" className="size-4" />
          Start over
        </Button>
      </div>
    </section>
  );
}
