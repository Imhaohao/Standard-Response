"use client";

import { LockKey } from "@phosphor-icons/react";
import { ButtonLink } from "../ui/button";
import { useAccount } from "./use-account";

// Where the proxy sends someone signed in without the role a screen needs.
export function NoAccess() {
  const account = useAccount();
  const name = account?.enabled && account.signedIn ? account.name : undefined;
  const driver = account?.enabled && account.signedIn && account.roles.includes("driver");
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-map-paper p-4">
      <section className="card flex w-full max-w-sm flex-col items-start gap-4 p-6">
        <LockKey weight="bold" className="size-8" aria-hidden />
        <h1 className="type-title">This screen is for dispatchers</h1>
        <p className="type-body text-on-panel-muted">
          {name ? `You're signed in as ${name}. ` : ""}It shows who can&apos;t leave on their own, so your agency has to give your account the dispatcher role first.
        </p>
        <div className="flex flex-wrap gap-2">
          {driver && <ButtonLink href="/driver">Open the driver page</ButtonLink>}
          <ButtonLink href="/auth/logout" variant="quiet">
            Log out
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
