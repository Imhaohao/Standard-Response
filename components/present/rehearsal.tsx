"use client";

import { useSyncExternalStore } from "react";
import cues from "./cues.json";
import type { Beat } from "./script";

const STORAGE_KEY = "present:notes";
const listeners = new Set<() => void>();

function readNotes() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function toggleNotes() {
  try {
    window.localStorage.setItem(STORAGE_KEY, readNotes() ? "off" : "on");
  } catch {
    return;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const useNotesShown = () => useSyncExternalStore(subscribe, readNotes, () => false);

// N floats the line for this beat and its number in the script's A/V table in the corner, for rehearsing.
export function Rehearsal({ beat, shown }: { beat: Beat; shown: boolean }) {
  if (!shown) return null;
  const cue = cues[beat];
  return (
    <aside className="fixed right-6 bottom-6 z-50 flex max-w-[34rem] items-baseline gap-4 rounded-2xl bg-ink/60 px-5 py-4 text-canvas shadow-popover backdrop-blur-md">
      <span className="type-figure shrink-0 text-2xl tabular-nums">{cue.doc}</span>
      <p className="type-body text-base">{cue.line}</p>
    </aside>
  );
}
