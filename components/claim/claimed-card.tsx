"use client";

import { HouseLine } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export const NEXT_JUDGE_AFTER_MS = 9000;

// Step four: the house is the judge's. The line under the card runs down to the next judge's
// sign-in; "Return to home" skips the wait.
export function ClaimedCard({ address, residentName, phoneEnding, onNext }: { address: string; residentName: string; phoneEnding: string | null; onNext: () => void }) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const timer = setTimeout(onNext, NEXT_JUDGE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [onNext]);
  return (
    <section aria-labelledby="claimed-heading" aria-live="polite" className="card w-full max-w-2xl overflow-hidden">
      <div className="flex flex-col gap-4 p-8 sm:p-10">
        <HouseLine weight="fill" className="size-12 text-ink" aria-hidden />
        <h1 id="claimed-heading" className="type-display">
          {address} is yours
        </h1>
        <p className="type-body max-w-[46ch] text-ink-muted">
          When the warning goes out, our agent calls {phoneEnding ? `the number ending ${phoneEnding}` : "your phone"}. Answer as {residentName}, and tell it what you told us, or change your mind on the call.
        </p>
        <Button size="lg" onClick={onNext} className="mt-2 self-start">
          Return to home
        </Button>
      </div>
      <motion.div
        aria-hidden
        className="h-1 origin-left bg-ink"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: reduceMotion ? 1 : 0 }}
        transition={{ duration: NEXT_JUDGE_AFTER_MS / 1000, ease: "linear" }}
      />
    </section>
  );
}
