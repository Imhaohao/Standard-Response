"use client";

import { useMutation, useQuery } from "convex/react";
import { FunctionReturnType } from "convex/server";
import { AnimatePresence, motion } from "motion/react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUp, ChatText } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import { PRODUCT_NAME } from "@/lib/brand";
import { formatClock } from "@/lib/time";
import { AppBar } from "../ui/app-bar";
import { PanelEmpty } from "../ui/panel";

type Thread = FunctionReturnType<typeof api.texts.threads>[number];

// The text tells the resident to reply with a digit, so the digits are one tap away.
const QUICK_REPLIES = ["1", "2", "3"];

function ThreadList({ threads, current, onPick }: { threads: Thread[]; current: string | undefined; onPick: (id: string) => void }) {
  if (threads.length === 0) return <PanelEmpty>Texts go out after two missed calls.</PanelEmpty>;
  return (
    <ul className="flex flex-col">
      {threads.map((thread) => {
        const selected = thread.householdId === current;
        const last = thread.texts[thread.texts.length - 1];
        const awaiting = last?.direction === "outbound";
        return (
          <li key={thread.householdId}>
            <button
              type="button"
              aria-current={selected}
              onClick={() => onPick(thread.householdId)}
              className={`flex w-full items-start gap-2.5 border-b border-panel-raised px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-on-panel ${
                selected ? "bg-panel-raised shadow-[inset_3px_0_0_var(--on-panel)]" : "hover:bg-panel-raised/50"
              }`}
            >
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${awaiting ? "bg-on-panel" : "bg-transparent"}`} aria-label={awaiting ? "Waiting for a reply" : undefined} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="type-small truncate font-bold">{thread.residentName ?? thread.address}</span>
                {thread.residentName && <span className="type-small truncate text-on-panel-muted">{thread.address}</span>}
                {last && <span className="type-small truncate text-on-panel-muted">{last.body}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Bubbles({ thread }: { thread: Thread }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [thread.texts.length]);
  return (
    <ol ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-4" aria-live="polite">
      <AnimatePresence initial={false}>
        {thread.texts.map((text) => {
          const fromUs = text.direction === "outbound";
          return (
            <motion.li
              key={text._id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", duration: 0.35, bounce: 0 }}
              className={`flex max-w-[82%] flex-col gap-0.5 ${fromUs ? "self-start items-start" : "self-end items-end"}`}
            >
              <p className={`type-body rounded-2xl px-3.5 py-2 ${fromUs ? "rounded-bl-sm bg-surface-sunk text-ink" : "rounded-br-sm bg-ink text-canvas"}`}>{text.body}</p>
              <span className="type-small px-1 text-ink-muted">{formatClock(text.at)}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function ReplyBar({ thread }: { thread: Thread }) {
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
    <form onSubmit={onSubmit} className="flex flex-col gap-2 border-t border-line bg-surface px-3 pt-2.5 pb-4">
      <div className="flex gap-1.5" role="group" aria-label="Quick replies">
        {QUICK_REPLIES.map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => send(digit)}
            className="type-heading h-9 flex-1 rounded-full bg-surface-sunk transition-[background-color,scale] duration-150 hover:bg-line active:scale-[0.96]"
          >
            {digit}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="sms-body">
          Reply as the resident
        </label>
        <input
          id="sms-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Text message"
          className="type-body h-10 min-w-0 flex-1 rounded-full border border-line bg-surface px-4"
        />
        <button
          type="submit"
          aria-label="Send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-canvas transition-[scale] duration-150 active:scale-[0.96]"
        >
          <ArrowUp weight="bold" className="size-5" />
        </button>
      </div>
    </form>
  );
}

// A handset, so the room reads it as somebody's phone at a glance. It is labeled simulated because
// SMS registration has not cleared; real texts would land on the rider's own phone.
function Handset({ thread }: { thread: Thread | undefined }) {
  return (
    <div className="flex h-[min(46rem,calc(100dvh-7rem))] w-[22rem] max-w-full flex-col overflow-hidden rounded-[2.75rem] bg-map-ink p-2.5 shadow-[0_30px_80px_oklch(0_0_0/0.28)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2.25rem] bg-surface">
        <header className="flex flex-col items-center gap-1 border-b border-line px-4 pt-6 pb-3">
          <span className="grid size-10 place-items-center rounded-full bg-ink text-canvas">
            <ChatText weight="fill" className="size-5" />
          </span>
          <span className="type-small font-bold">{PRODUCT_NAME} alerts</span>
          <span className="type-small text-ink-muted">{thread ? `To ${thread.residentName ?? thread.address}` : "Simulated phone"}</span>
        </header>
        {thread ? (
          <>
            <Bubbles thread={thread} />
            <ReplyBar thread={thread} />
          </>
        ) : (
          <p className="type-body grid flex-1 place-items-center px-8 text-center text-ink-muted">No texts yet.</p>
        )}
      </div>
    </div>
  );
}

export function PhonePanel() {
  const threads = useQuery(api.texts.threads) ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const thread = threads.find((t) => t.householdId === selected) ?? threads[0];

  return (
    <div className="flex h-[100dvh] flex-col bg-map-paper">
      <AppBar>
        <span className="type-small bg-panel-raised px-2 py-1 font-semibold text-on-panel-muted">Simulated: SMS registration hasn&apos;t cleared</span>
      </AppBar>
      <main className="flex min-h-0 flex-1 gap-6 p-4">
        <section aria-label="Text threads" className="flex w-80 shrink-0 flex-col bg-panel text-on-panel">
          <h2 className="type-small flex min-h-10 items-center border-b border-panel-raised px-3 font-bold">Texts ({threads.length})</h2>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ThreadList threads={threads} current={thread?.householdId} onPick={setSelected} />
          </div>
        </section>
        <div className="grid min-w-0 flex-1 place-items-center">
          <Handset thread={thread} />
        </div>
      </main>
    </div>
  );
}
