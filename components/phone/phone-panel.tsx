"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { FormEvent, useState } from "react";
import { api } from "@/convex/_generated/api";
import { formatClock } from "@/lib/time";
import { PageShell } from "../page-shell";
import { Button } from "../ui/button";
import { Section } from "../ui/section";

type Thread = FunctionReturnType<typeof api.texts.threads>[number];

const QUICK_REPLIES = ["1", "2", "3"];

function ReplyBox({ thread }: { thread: Thread }) {
  const reply = useMutation(api.texts.reply);
  const [body, setBody] = useState("");
  const send = (text: string) => {
    if (!text.trim()) return;
    void reply({ householdId: thread.householdId, body: text.trim() });
    setBody("");
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    send(body);
  };
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-line p-4">
      <div className="flex gap-2" role="group" aria-label="Quick replies">
        {QUICK_REPLIES.map((digit) => (
          <Button key={digit} variant="quiet" onClick={() => send(digit)}>
            Reply {digit}
          </Button>
        ))}
      </div>
      <label className="type-small flex flex-col gap-1.5 font-semibold">
        Reply as the resident
        <div className="flex gap-2">
          <input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="type-body h-10 min-w-0 flex-1 rounded-[2px] border border-line bg-surface px-3 font-normal"
          />
          <Button type="submit">Send</Button>
        </div>
      </label>
    </form>
  );
}

function Conversation({ thread }: { thread: Thread }) {
  return (
    <Section title={thread.residentName ? `${thread.residentName}, ${thread.address}` : thread.address}>
      <ol className="flex flex-col gap-2 p-4">
        {thread.texts.map((text) => (
          <li
            key={text._id}
            className={`type-body max-w-[85%] p-3 ${text.direction === "outbound" ? "self-start bg-surface-sunk" : "self-end bg-ink text-canvas"}`}
          >
            <p>{text.body}</p>
            <p className="type-small opacity-70">{formatClock(text.at)}</p>
          </li>
        ))}
      </ol>
      <ReplyBox thread={thread} />
    </Section>
  );
}

export function PhonePanel() {
  const threads = useQuery(api.texts.threads);
  const [selected, setSelected] = useState<string | null>(null);
  const thread = threads?.find((t) => t.householdId === selected) ?? threads?.[0];

  return (
    <PageShell>
      <p className="type-small text-ink-muted">Simulated: SMS registration hasn&apos;t cleared, so texts live here instead of on real phones.</p>
      <div className="grid gap-4 md:grid-cols-12 md:items-start">
        <Section title={`Texts (${threads?.length ?? 0})`} className="md:col-span-4">
          {threads?.length === 0 ? (
            <p className="type-small px-4 py-6 text-ink-muted">Texts appear after two missed calls.</p>
          ) : (
            <ul className="flex max-h-[40rem] flex-col overflow-y-auto">
              {threads?.map((t) => (
                <li key={t.householdId}>
                  <button
                    type="button"
                    aria-current={t.householdId === thread?.householdId}
                    onClick={() => setSelected(t.householdId)}
                    className={`type-small w-full border-b border-line px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-signal ${t.householdId === thread?.householdId ? "bg-surface-sunk font-semibold" : ""}`}
                  >
                    {t.address}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <div className="md:col-span-8">{thread && <Conversation thread={thread} />}</div>
      </div>
    </PageShell>
  );
}
