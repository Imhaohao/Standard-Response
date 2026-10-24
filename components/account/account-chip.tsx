"use client";

import { SignOut } from "@phosphor-icons/react";
import { useAccount } from "./use-account";

// Who is signed in, and the way out. Nothing shows while Auth0 is off.
export function AccountChip() {
  const account = useAccount();
  if (!account?.enabled || !account.signedIn) return null;
  return (
    <span className="flex items-center gap-2">
      <span className="type-small max-w-40 truncate text-ink-muted">{account.name}</span>
      <a href="/auth/logout" className="type-small inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-semibold hover:bg-surface-sunk">
        <SignOut weight="bold" className="size-4" />
        Log out
      </a>
    </span>
  );
}
