"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { AREA_NAME, PRODUCT_NAME } from "@/lib/brand";
import { formatElapsed, useNow } from "@/lib/time";

const SCREENS = [
  { href: "/", label: "Call floor" },
  { href: "/map", label: "Rescue map" },
  { href: "/system", label: "Under the hood" },
  { href: "/phone", label: "Simulated phone" },
  { href: "/driver", label: "Driver page" },
] as const;

function ScreenNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Screens" className="min-w-0">
      <ul className="flex flex-wrap gap-1">
        {SCREENS.map((screen) => {
          const current = pathname === screen.href;
          return (
            <li key={screen.href}>
              <Link
                href={screen.href}
                aria-current={current ? "page" : undefined}
                className={`type-small inline-flex h-7 items-center px-2 font-semibold focus-visible:outline-2 focus-visible:outline-on-panel ${
                  current ? "bg-on-panel text-panel" : "text-on-panel-muted hover:bg-panel-raised hover:text-on-panel"
                }`}
              >
                {screen.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function WarningClock({ issuedAt }: { issuedAt: number }) {
  const now = useNow();
  return (
    <div className="flex items-baseline gap-2">
      <span className="type-small text-on-panel-muted">Since the warning</span>
      <span className="type-figure text-lg tabular-nums">{formatElapsed(now - issuedAt)}</span>
    </div>
  );
}

// The dark bar on top of every screen: the product mark, the screens, and whatever the screen
// needs at hand on the right.
export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="pointer-events-auto relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-panel-raised bg-panel/96 px-3 py-2 text-on-panel backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-3 shrink-0 bg-signal" aria-hidden />
        <span className="type-heading">{PRODUCT_NAME}</span>
        <span className="type-small hidden truncate text-on-panel-muted sm:inline">{AREA_NAME}</span>
      </div>
      <ScreenNav />
      {children && <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}
