"use client";

import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { failureText } from "./controls";

// The server refuses a sign-in after 20 minutes; the kiosk starts a fresh one a little before that,
// so the QR on screen always works.
const KIOSK_SESSION_MS = 18 * 60_000;

// One sign-in on the big screen: its code (shown as the QR), and what has arrived for it so far.
// Each bump of `generation` opens a new sign-in.
export function useKioskSession() {
  const startKiosk = useMutation(api.claims.startKiosk);
  const [generation, setGeneration] = useState(0);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restart = useCallback(() => {
    setCode(null);
    setGeneration((current) => current + 1);
  }, []);

  useEffect(() => {
    let live = true;
    startKiosk().then(
      (fresh) => {
        if (!live) return;
        setCode(fresh);
        setError(null);
      },
      (failure) => live && setError(failureText(failure, "Couldn't start a sign-in. Check the connection.")),
    );
    const timer = setTimeout(restart, KIOSK_SESSION_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [startKiosk, generation, restart]);

  const session = useQuery(api.claims.session, code ? { code } : "skip");

  // Gone means the sign-ins were cleared (claims:clearAll) or this one ran out, so its QR no longer
  // works. Noted during render, once per code, so it opens exactly one replacement.
  const gone = code !== null && (session === null || session?.expired === true);
  const [replacedCode, setReplacedCode] = useState<string | null>(null);
  if (gone && replacedCode !== code) {
    setReplacedCode(code);
    setGeneration((current) => current + 1);
  }

  return { code, phoneEnding: gone ? null : (session?.phoneEnding ?? null), restart, error };
}
