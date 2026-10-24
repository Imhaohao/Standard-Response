"use client";

import { useEffect, useState } from "react";
import type { Account } from "@/app/api/me/route";

export type { Account };

let asked: Promise<Account> | null = null;

// One request per page load, shared by every component that asks.
function fetchAccount() {
  asked ??= fetch("/api/me")
    .then((response) => response.json() as Promise<Account>)
    .catch((): Account => ({ enabled: false }));
  return asked;
}

// Undefined until the server answers, so a step-up check never runs on a guess.
export function useAccount() {
  const [account, setAccount] = useState<Account | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fetchAccount().then((data) => live && setAccount(data));
    return () => {
      live = false;
    };
  }, []);
  return account;
}
