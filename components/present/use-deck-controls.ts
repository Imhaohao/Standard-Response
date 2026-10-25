"use client";

import { useEffect } from "react";

export type DeckCommands = { next: () => void; previous: () => void; first: () => void; last: () => void; notes: () => void; pairing: () => void };

const KEYS: Record<string, keyof DeckCommands | "fullscreen"> = {
  ArrowRight: "next",
  ArrowDown: "next",
  PageDown: "next",
  " ": "next",
  Enter: "next",
  ArrowLeft: "previous",
  ArrowUp: "previous",
  PageUp: "previous",
  Home: "first",
  End: "last",
  n: "notes",
  N: "notes",
  p: "pairing",
  P: "pairing",
  f: "fullscreen",
  F: "fullscreen",
};

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}

// Presentation clickers send arrow and page keys, so every common forward and back key works.
export function useDeckControls(commands: DeckCommands) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const command = KEYS[event.key];
      if (!command) return;
      event.preventDefault();
      if (command === "fullscreen") toggleFullscreen();
      else commands[command]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commands]);
}
