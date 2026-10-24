"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SCREENS = [
  { href: "/", label: "Call floor" },
  { href: "/map", label: "Rescue map" },
  { href: "/system", label: "Under the hood" },
  { href: "/phone", label: "Simulated phone" },
  { href: "/driver", label: "Driver page" },
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Screens">
      <ul className="flex flex-wrap gap-1">
        {SCREENS.map((screen) => {
          const current = pathname === screen.href;
          return (
            <li key={screen.href}>
              <Link
                href={screen.href}
                aria-current={current ? "page" : undefined}
                className={`type-small inline-flex h-8 items-center px-2.5 font-semibold focus-visible:outline-2 focus-visible:outline-signal ${current ? "bg-ink text-canvas" : "text-ink-muted hover:bg-surface-sunk hover:text-ink"}`}
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
