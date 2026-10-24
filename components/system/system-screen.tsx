"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Doc } from "@/convex/_generated/dataModel";
import { REQUEST_STATUS_LABELS, RequestStatus } from "@/lib/labels";
import { formatClock } from "@/lib/time";
import { PageShell } from "../page-shell";
import { Section } from "../ui/section";
import { PlanSummary } from "../rescue/plan-summary";

const FLOW: RequestStatus[] = ["received", "approved", "driver_accepted", "en_route", "reassigning", "arrived"];

// The Convex demo beats: a stale accept rejected and a duplicate event ignored.
const HIGHLIGHT = new Set<Doc<"auditLog">["kind"]>(["stale_accept_rejected", "callback_duplicate", "revoked"]);

function StatusCounts() {
  const requests = useQuery(api.requests.open);
  return (
    <Section title="Requests by status">
      <ol className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
        {FLOW.map((status) => (
          <li key={status} className="flex flex-col gap-1 bg-surface px-4 py-3">
            <span className="type-figure text-2xl">{requests?.filter((r) => r.status === status).length ?? 0}</span>
            <span className="type-small text-ink-muted">{REQUEST_STATUS_LABELS[status]}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function AuditTrail() {
  const rows = useQuery(api.plans.auditTrail, { limit: 60 });
  return (
    <Section title="Audit trail">
      <ol className="type-small flex max-h-[36rem] flex-col overflow-y-auto">
        {rows?.map((row) => (
          <li key={row._id} className={`flex justify-between gap-3 border-b border-line px-4 py-2 ${HIGHLIGHT.has(row.kind) ? "font-semibold text-signal" : ""}`}>
            <span>
              {row.planVersion !== undefined && `v${row.planVersion}: `}
              {row.message}
            </span>
            <span className="shrink-0 text-ink-muted">{formatClock(row.at)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function CallbackTiming() {
  const callbacks = useQuery(api.callbacks.recent, { limit: 30 });
  return (
    <Section title="Callbacks: time from event to rider told">
      <table className="type-small w-full">
        <thead className="text-left text-ink-muted">
          <tr>
            <th className="px-4 py-2 font-semibold">Rider</th>
            <th className="px-4 py-2 font-semibold">Told</th>
            <th className="px-4 py-2 font-semibold">State</th>
            <th className="px-4 py-2 text-right font-semibold">Time</th>
          </tr>
        </thead>
        <tbody>
          {callbacks?.map((c) => (
            <tr key={c._id} className="border-t border-line">
              <td className="px-4 py-2">{c.address}</td>
              <td className="px-4 py-2">{c.announces === "driver_accepted" ? "Driver accepted" : "Driver can't reach them"}</td>
              <td className="px-4 py-2">{c.state}</td>
              <td className="px-4 py-2 text-right">{c.playedAt ? seconds(c.playedAt - c.createdAt) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

type Results = { simulator: unknown; evaluation: unknown };

function useResults() {
  const [results, setResults] = useState<Results | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/results").then((r) => r.json()).then((data) => live && setResults(data));
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  return results;
}

function ResultBlock({ title, data, waitingOn }: { title: string; data: unknown; waitingOn: string }) {
  return (
    <Section title={title}>
      {data ? (
        <pre className="type-small max-h-80 overflow-auto px-4 py-3">{JSON.stringify(data, null, 2)}</pre>
      ) : (
        <p className="type-small px-4 py-4 text-ink-muted">Shows up when {waitingOn} writes it.</p>
      )}
    </Section>
  );
}

export function SystemScreen() {
  const results = useResults();
  return (
    <PageShell>
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-7">
          <StatusCounts />
          <CallbackTiming />
          <div className="grid gap-4 md:grid-cols-2 md:items-start">
            <ResultBlock title="Simulator results" data={results?.simulator} waitingOn="Track C (data/sim-results.json)" />
            <ResultBlock title="Call accuracy" data={results?.evaluation} waitingOn="Track D (data/eval-results.json)" />
          </div>
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-5">
          <PlanSummary />
          <AuditTrail />
        </aside>
      </div>
    </PageShell>
  );
}
