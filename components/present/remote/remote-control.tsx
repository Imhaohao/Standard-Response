"use client";

import { CaretLeft, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/ui/brand-mark";
import { listenForRemote, sendFailureReason, sendRemote, watchConnection, type RemoteCommand } from "./channel";

type Link = "connecting" | "paired" | "reconnecting";

const TAP_BUZZ_MS = 12;

const ROOM_NAME = /^[a-z0-9]{6,32}$/;

export function RemoteControl({ room }: { room: string | null }) {
  if (!room || !ROOM_NAME.test(room)) return <MissingRoom />;
  return <Clicker room={room} />;
}

function Clicker({ room }: { room: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const link = usePairing(room, setFailure);
  const { send, lastSent } = useSender(room, setFailure);
  const gesture = useTapOrSwipe({ onTap: () => send("next"), onSwipeBack: () => send("previous") });
  useWakeLock();
  return (
    <main className="h-dvh touch-none bg-night select-none">
      <button type="button" aria-label="Next slide" {...gesture} className="flex size-full flex-col p-4 text-on-night">
        <LinkStatus link={link} failure={failure} />
        <span className="relative flex flex-1 flex-col items-center justify-center gap-8">
          <SentPulse sent={lastSent} />
          <BrandMark className="relative size-36" />
          <span className="type-display relative">Tap for next</span>
        </span>
        <span className="type-body flex items-center justify-center gap-2 pb-4 text-on-night-muted">
          <CaretLeft size={20} weight="bold" />
          Swipe right to go back
        </span>
      </button>
      <button type="button" onClick={() => send("previous")} className="sr-only">
        Previous slide
      </button>
    </main>
  );
}

const SWIPE_DISTANCE = 60;

// The whole screen is one button, so it works without looking: a tap goes
// forward and a swipe to the right goes back. Keyboard and screen reader
// presses arrive as a click with no pointer, and count as a tap.
function useTapOrSwipe({ onTap, onSwipeBack }: { onTap: () => void; onSwipeBack: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: PointerEvent<HTMLButtonElement>) => {
      if (!start.current) return;
      const moveX = event.clientX - start.current.x;
      const moveY = event.clientY - start.current.y;
      start.current = null;
      if (moveX > SWIPE_DISTANCE && Math.abs(moveX) > Math.abs(moveY)) onSwipeBack();
      else onTap();
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) onTap();
    },
  };
}

type Sent = { command: RemoteCommand; count: number } | null;

// A glow that blooms behind the flame on every tap or swipe, so a glance
// confirms the phone took it.
function SentPulse({ sent }: { sent: Sent }) {
  if (!sent) return null;
  const back = sent.command === "previous";
  return (
    <span key={sent.count} className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
      <span className={`size-72 animate-remote-pulse rounded-full blur-2xl ${back ? "bg-on-night-muted" : "bg-signal"}`} />
    </span>
  );
}

// Says hello once the phone is listening. If the deck opens later, the deck
// announces itself instead, so neither side has to keep asking.
function usePairing(room: string, onFailure: (reason: string | null) => void): Link {
  const [paired, setPaired] = useState(false);
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    try {
      const hello = () => {
        sendRemote(room, "hello").then(
          () => onFailure(null),
          (error: unknown) => onFailure(sendFailureReason(error)),
        );
      };
      const stopListening = listenForRemote(room, "phone", (command) => {
        if (command === "ready") hello();
        if (command === "paired") setPaired(true);
      }, hello);
      const stopWatching = watchConnection(setConnected);
      return () => {
        stopListening();
        stopWatching();
      };
    } catch (error) {
      onFailure(sendFailureReason(error));
    }
  }, [room, onFailure]);
  if (!connected) return "reconnecting";
  return paired ? "paired" : "connecting";
}

// Sends taps one at a time, in order, so two quick taps never arrive swapped.
function useSender(room: string, onFailure: (reason: string | null) => void) {
  const queue = useRef(Promise.resolve());
  const [lastSent, setLastSent] = useState<Sent>(null);
  const send = (command: RemoteCommand) => {
    navigator.vibrate?.(TAP_BUZZ_MS);
    setLastSent((previous) => ({ command, count: (previous?.count ?? 0) + 1 }));
    queue.current = queue.current
      .then(() => sendRemote(room, command))
      .then(() => onFailure(null))
      .catch((error: unknown) => onFailure(sendFailureReason(error)));
  };
  return { send, lastSent };
}

// Keeps the phone screen on for the whole talk.
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = () => {
      if (document.visibilityState !== "visible") return;
      void navigator.wakeLock?.request("screen").then((sentinel) => (lock = sentinel)).catch(() => {});
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);
}

const STATUS: Record<Link, { text: string; className: string; icon: ReactNode }> = {
  connecting: { text: "Looking for the deck…", className: "bg-night-raised text-on-night", icon: <span className="size-3 animate-pulse rounded-full bg-on-night-muted" /> },
  reconnecting: { text: "Signal lost. Reconnecting…", className: "bg-night-raised text-on-night", icon: <span className="size-3 animate-pulse rounded-full bg-signal" /> },
  paired: { text: "Connected to the deck", className: "bg-night-raised text-leaving", icon: <CheckCircle size={22} weight="fill" /> },
};

function LinkStatus({ link, failure }: { link: Link; failure: string | null }) {
  if (failure) {
    return (
      <span role="alert" className="type-heading flex min-h-12 items-center gap-3 rounded-2xl bg-signal-soft px-4 py-2 text-left text-ink">
        <WarningCircle size={22} weight="fill" className="shrink-0 text-signal" />
        {failure}
      </span>
    );
  }
  const status = STATUS[link];
  return (
    <span role="status" className={`type-heading flex min-h-12 items-center gap-3 rounded-2xl px-4 py-2 ${status.className}`}>
      {status.icon}
      {status.text}
    </span>
  );
}

function MissingRoom() {
  return (
    <main className="flex h-dvh flex-col justify-center gap-4 bg-night p-6 text-on-night">
      <BrandMark className="size-16" />
      <h1 className="type-display">Scan the code on the deck</h1>
      <p className="type-body text-on-night-muted">Press P on the presenting laptop to show it. The code links this phone to that deck.</p>
    </main>
  );
}
