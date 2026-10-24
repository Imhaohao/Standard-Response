"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { AREA_NAME, PRODUCT_NAME } from "@/lib/brand";
import { formatElapsed, useNow } from "@/lib/time";

type Screen = { href: string; label: string; also?: string[] };

const SCREENS: Screen[] = [
  { href: "/", label: "Call floor" },
  { href: "/map", label: "Rescue map" },
  { href: "/system", label: "Under the hood" },
  { href: "/phone", label: "Simulated phone" },
  { href: "/driver", label: "Driver page" },
  // The mesh add-on's three pages, which link to each other.
  { href: "/flow", label: "Mesh and flow", also: ["/mesh", "/mesh/agency"] },
  // The readiness survey add-on: preparedness data from households, before any disaster.
  { href: "/prepare/county", label: "Readiness survey", also: ["/prepare"] },
];

function ScreenNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Screens" className="min-w-0">
      <ul className="flex flex-wrap gap-1">
        {SCREENS.map((screen) => {
          const current = pathname === screen.href || (screen.also?.includes(pathname) ?? false);
          return (
            <li key={screen.href}>
              <Link
                href={screen.href}
                aria-current={current ? "page" : undefined}
                className={`type-small inline-flex h-8 items-center rounded-full px-3 font-bold focus-visible:outline-2 focus-visible:outline-ink ${
                  current ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"
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
      <span className="type-small text-ink-muted">Since the warning</span>
      <span className="type-figure text-lg tabular-nums">{formatElapsed(now - issuedAt)}</span>
    </div>
  );
}

// The bar on top of every screen: the product mark, the screens, and whatever the screen needs at
// hand on the right.
export function AppBar({ children }: { children?: ReactNode }) {
  return (
    <header className="pointer-events-auto relative z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface/95 px-4 py-2 text-ink backdrop-blur-md">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-3 shrink-0 rounded-full bg-signal" aria-hidden />
        <span className="type-heading">{PRODUCT_NAME}</span>
        <span className="type-small hidden truncate text-ink-muted sm:inline">{AREA_NAME}</span>
      </div>
      <ScreenNav />
      {children && <div className="ml-auto flex flex-wrap items-center gap-3">{children}</div>}
    </header>
  );
}
