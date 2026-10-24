"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { HeaderBar } from "./header-bar";
import { ReachPanel } from "./reach-panel";
import { LiveLines } from "./live-lines";
import { CallDetail } from "./call-detail";
import { CoverageMap } from "./coverage-map";
import { CallQueue } from "./call-queue";
import { RetryLadder } from "./retry-ladder";
import { EventFeed } from "./event-feed";
import { HarnessPanel } from "./harness-panel";

export function CallFloor() {
  const control = useQuery(api.control.get);
  const counts = useQuery(api.households.counts);
  const calls = useQuery(api.calls.active);
  const [pinnedCallId, setPinnedCallId] = useState<Id<"calls"> | null>(null);

  const oldestLiveCall = calls?.filter((call) => call.phase === "live").sort((a, b) => a.startedAt - b.startedAt)[0];
  const followedCallId = pinnedCallId ?? oldestLiveCall?._id ?? null;
  const warningIssued = Boolean(control?.warningIssuedAt);

  return (
    <div className="min-h-[100dvh]">
      <HeaderBar control={control} />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 pt-4 pb-16 md:px-6 md:pt-6">
        <ReachPanel control={control} counts={counts} />
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
            <LiveLines
              calls={calls}
              warningIssued={warningIssued}
              maxLines={control?.maxConcurrentCalls ?? 0}
              selectedId={followedCallId}
              onSelect={setPinnedCallId}
            />
            <div className="grid gap-4 md:grid-cols-5 md:items-start">
              <CoverageMap className="md:col-span-3" />
              <CallQueue className="md:col-span-2" />
            </div>
            <div className="grid gap-4 md:grid-cols-5 md:items-start">
              <RetryLadder counts={counts} className="md:col-span-2" />
              <EventFeed className="md:col-span-3" />
            </div>
          </div>
          <aside className="flex w-full min-w-0 flex-col gap-4 self-start lg:sticky lg:top-20 lg:col-span-4">
            <CallDetail callId={followedCallId} pinned={pinnedCallId !== null} onFollowLive={() => setPinnedCallId(null)} />
            <HarnessPanel control={control} />
          </aside>
        </div>
      </main>
    </div>
  );
}
