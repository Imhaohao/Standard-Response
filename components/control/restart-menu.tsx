"use client";

import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ArrowCounterClockwise, CaretDown, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { api } from "@/convex/_generated/api";
import type { Role } from "@/lib/access";
import { useAccount, type Account } from "../account/use-account";
import { Button } from "../ui/button";
import { usePopover } from "../ui/use-popover";

type Phase = { kind: "idle" } | { kind: "armed" } | { kind: "running" } | { kind: "done" } | { kind: "refused"; message: string };

const SETTLE_MS = 4000;

type EndNight = {
  end: () => Promise<null>;
  label: string;
  armedLabel: string;
  keeps: string;
  doneLine: string;
};

function refusalOf(error: unknown) {
  return error instanceof ConvexError ? String(error.data) : "Couldn't end the night. Try again in a moment";
}

// Armed, done and refused all fall back to idle after a few seconds; running waits for the server.
function usePhase() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  useEffect(() => {
    if (phase.kind === "idle" || phase.kind === "running") return;
    const id = setTimeout(() => setPhase({ kind: "idle" }), SETTLE_MS);
    return () => clearTimeout(id);
  }, [phase]);
  return [phase, setPhase] as const;
}

function StatusLine({ id, phase, keeps, doneLine }: { id: string; phase: Phase; keeps: string; doneLine: string }) {
  if (phase.kind === "done") {
    return (
      <p id={id} aria-live="polite" className="type-small flex items-start gap-1.5 px-1 pt-1.5 font-semibold text-on-panel">
        <CheckCircle weight="fill" className="mt-px size-4 shrink-0 text-leaving" />
        {doneLine}
      </p>
    );
  }
  if (phase.kind === "refused") {
    return (
      <p id={id} aria-live="polite" className="type-small flex items-start gap-1.5 px-1 pt-1.5 font-semibold text-on-panel">
        <WarningCircle weight="fill" className="mt-px size-4 shrink-0 text-signal" />
        {phase.message}
      </p>
    );
  }
  return (
    <p id={id} aria-live="polite" className="type-small px-1 pt-1.5 text-on-panel-muted">
      {keeps}
    </p>
  );
}

const BUTTON_LABEL: Record<Phase["kind"], (action: EndNight) => string> = {
  idle: (action) => action.label,
  armed: (action) => action.armedLabel,
  running: () => "Saving the night…",
  done: (action) => action.label,
  refused: (action) => action.label,
};

// Ends the night after a second click. Either way the night is saved in `nightRuns` first; a
// refusal (a real call still live, or the last night still saving) shows in the line under it.
export function EndNightButton({ action }: { action: EndNight }) {
  const [phase, setPhase] = usePhase();
  const statusId = useId();
  const run = () => {
    if (phase.kind !== "armed") return setPhase({ kind: "armed" });
    setPhase({ kind: "running" });
    action.end().then(
      () => setPhase({ kind: "done" }),
      (error: unknown) => setPhase({ kind: "refused", message: refusalOf(error) }),
    );
  };
  return (
    <div>
      <Button
        data-popover-item
        variant={phase.kind === "armed" ? "onPanel" : "onPanelQuiet"}
        className="w-full"
        disabled={phase.kind === "running"}
        aria-describedby={statusId}
        onClick={run}
      >
        <ArrowCounterClockwise weight="bold" className="size-4" />
        {BUTTON_LABEL[phase.kind](action)}
      </Button>
      <StatusLine id={statusId} phase={phase} keeps={action.keeps} doneLine={action.doneLine} />
    </div>
  );
}

// The three ways to end a night, most used first: back to just before the warning starts the alarm
// again on the same homes.
export function EndNightActions() {
  const rewind = useMutation(api.control.rewind);
  const reset = useMutation(api.control.reset);
  const actions: EndNight[] = [
    {
      end: () => rewind({ to: "warning" }),
      label: "Rewind to before the warning",
      armedLabel: "Click again to save and rewind",
      keeps: "Keeps the homes and the Ready check. Clears the calls, rides and vans.",
      doneLine: "Rewound. The night is saved and the warning can go out again.",
    },
    {
      end: () => rewind({ to: "start" }),
      label: "Rewind to before the Ready check",
      armedLabel: "Click again to save and rewind",
      keeps: "Keeps the homes. Clears the Ready check results, calls, rides and vans.",
      doneLine: "Rewound. The night is saved and the Ready check can run again.",
    },
  ];
  const resetAction: EndNight = {
    end: () => reset({}),
    label: "Reset the simulation",
    armedLabel: "Click again to save and reset",
    keeps: "Clears every home, including their real phone numbers, and puts the stand-ins back. Real phones can put the numbers back after.",
    doneLine: "Reset. The night is saved and every home is cleared.",
  };
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 p-3">
        {actions.map((action) => (
          <EndNightButton key={action.label} action={action} />
        ))}
      </div>
      <div className="border-t border-panel-raised p-3">
        <EndNightButton action={resetAction} />
      </div>
    </div>
  );
}

const PUBLIC_PREFIXES = ["/join", "/you", "/ready"];
const RESTART_ROLE: Role = "dispatcher";

function isPublicPage(pathname: string) {
  return pathname === "/" || PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// The team only: anyone while Auth0 is off locally, a signed-in dispatcher once it's on, and never on
// the pages the public opens.
function mayRestart(account: Account | undefined, pathname: string) {
  if (!account || isPublicPage(pathname)) return false;
  if (!account.enabled) return true;
  return account.signedIn && account.roles.includes(RESTART_ROLE);
}

export function RestartMenu() {
  const account = useAccount();
  const pathname = usePathname();
  const { open, toggle, triggerRef, containerRef, onKeyDown, onBlur } = usePopover();
  if (!mayRestart(account, pathname)) return null;
  return (
    <div ref={containerRef} onKeyDown={onKeyDown} onBlur={onBlur} className="relative">
      <Button
        ref={triggerRef}
        variant={open ? "primary" : "quiet"}
        size="sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <ArrowCounterClockwise weight="bold" className="size-4" />
        Restart
        <CaretDown weight="bold" className={`size-3.5 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
      {/* On a phone the menu spans the bar: the bar's backdrop blur makes it the containing block for `fixed`. */}
      {open && (
        <div
          role="dialog"
          aria-label="Restart the night"
          className="absolute top-full right-0 z-30 mt-2 w-80 bg-panel text-on-panel shadow-popover max-sm:fixed max-sm:inset-x-4 max-sm:w-auto"
        >
          <EndNightActions />
        </div>
      )}
    </div>
  );
}
