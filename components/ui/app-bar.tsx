"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useId } from "react";
import { AREA_NAME, PRODUCT_NAME } from "@/lib/brand";
import { CaretDown, Check, Toolbox } from "@phosphor-icons/react";
import { RestartMenu } from "../control/restart-menu";
import { BrandMark } from "./brand-mark";
import { formatSinceWarning } from "@/lib/time";
import { useSimNow } from "@/lib/use-sim-now";
import { usePopover } from "./use-popover";

type Screen = { href: string; label: string; also?: string[] };

// The screens the operators work from, always in the bar.
const SCREENS: Screen[] = [
  { href: "/dashboard", label: "Call floor" },
  { href: "/map", label: "Rescue map" },
  { href: "/driver", label: "Driver page" },
];

// Testing and analysis screens, behind one menu.
const TOOLS: Screen[] = [
  { href: "/system", label: "Under the hood" },
  { href: "/phone", label: "Simulated phone" },
  // The Ready check: a household signs itself up before any disaster.
  { href: "/ready", label: "Ready sign-up" },
  // The mesh add-on's three pages, which link to each other.
  { href: "/flow", label: "Mesh and flow", also: ["/mesh", "/mesh/agency"] },
  // The readiness survey add-on: preparedness data from households, before any disaster.
  { href: "/prepare/county", label: "Readiness survey", also: ["/prepare"] },
  // The public kiosk judges sign in at.
  { href: "/", label: "Judge sign-in" },
];

const isCurrent = (screen: Screen, pathname: string) => pathname === screen.href || (screen.also?.includes(pathname) ?? false);

const PILL_LOOKS = {
  current: "bg-ink text-canvas",
  open: "bg-surface-sunk text-ink",
  idle: "text-ink-muted hover:bg-surface-sunk hover:text-ink",
} as const;

function pillClass(look: keyof typeof PILL_LOOKS) {
  return `type-small inline-flex h-8 items-center gap-1.5 rounded-full px-3 font-bold focus-visible:outline-2 focus-visible:outline-ink ${PILL_LOOKS[look]}`;
}

const pillLook = (current: boolean, open = false) => (current ? "current" : open ? "open" : "idle");

function ToolLink({ screen, current, onPick }: { screen: Screen; current: boolean; onPick: () => void }) {
  return (
    <li>
      <Link
        href={screen.href}
        data-popover-item
        aria-current={current ? "page" : undefined}
        onClick={onPick}
        className={`type-small flex h-10 items-center justify-between gap-3 px-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink ${
          current ? "bg-panel-raised font-bold" : "font-semibold hover:bg-panel-raised/60"
        }`}
      >
        {screen.label}
        {current && <Check weight="bold" className="size-4" />}
      </Link>
    </li>
  );
}

// A disclosure of links: the button says which tool is open when the page is one of them.
function ToolsMenu({ pathname }: { pathname: string }) {
  const { open, close, toggle, triggerRef, containerRef, onKeyDown, onBlur } = usePopover();
  const menuId = useId();
  const currentTool = TOOLS.find((screen) => isCurrent(screen, pathname));
  return (
    <div ref={containerRef} onKeyDown={onKeyDown} onBlur={onBlur} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={toggle}
        className={pillClass(pillLook(Boolean(currentTool), open))}
      >
        <Toolbox weight="bold" className="size-4" />
        {currentTool ? `Tools: ${currentTool.label}` : "Tools"}
        <CaretDown weight="bold" className={`size-3.5 motion-safe:transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* On a phone the menu spans the bar: the bar's backdrop blur makes it the containing block for `fixed`. */}
      {open && (
        <ul
          id={menuId}
          className="absolute top-full left-0 z-30 mt-2 w-60 bg-panel py-1 text-on-panel shadow-popover max-sm:fixed max-sm:inset-x-4 max-sm:w-auto"
        >
          {TOOLS.map((screen) => (
            <ToolLink key={screen.href} screen={screen} current={screen === currentTool} onPick={close} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScreenNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Screens" className="min-w-0">
      <ul className="flex flex-wrap gap-1">
        {SCREENS.map((screen) => {
          const current = isCurrent(screen, pathname);
          return (
            <li key={screen.href}>
              <Link href={screen.href} aria-current={current ? "page" : undefined} className={pillClass(pillLook(current))}>
                {screen.label}
              </Link>
            </li>
          );
        })}
        <li>
          <ToolsMenu pathname={pathname} />
        </li>
      </ul>
    </nav>
  );
}

export function WarningClock({ issuedAt }: { issuedAt: number }) {
  const now = useSimNow();
  return (
    <div className="flex items-baseline gap-2">
      <span className="type-small text-ink-muted">Since the warning</span>
      <span className="type-figure text-lg tabular-nums">{formatSinceWarning((now - issuedAt) / 60_000)}</span>
    </div>
  );
}

// The bar on top of every team screen: the product mark, the screens, whatever the screen needs at
// hand on the right, and the team's Restart menu.
export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="pointer-events-auto relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface/95 px-4 py-2 text-ink backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandMark className="size-5" />
        <span className="type-heading font-brand">{PRODUCT_NAME}</span>
        <span className="type-small hidden truncate text-ink-muted sm:inline">{AREA_NAME}</span>
      </div>
      <ScreenNav />
      <div className="ml-auto flex max-w-full flex-wrap items-center gap-3">
        {children}
        <RestartMenu />
      </div>
    </header>
  );
}
