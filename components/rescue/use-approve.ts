"use client";

import { useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { stepUpUrl } from "@/lib/access";
import { useAccount } from "../account/use-account";

// Approving sends a van, so the first approval of a session asks for a second factor. After that,
// approval is one click for the rest of the session.
export function useApprove() {
  const approve = useMutation(api.offers.approve);
  const account = useAccount();
  return useCallback(
    async (assignmentIds: Id<"assignments">[]) => {
      if (!account) return;
      if (account.enabled && !(account.signedIn && account.steppedUp)) {
        window.location.assign(stepUpUrl(window.location.pathname));
        return;
      }
      await Promise.all(assignmentIds.map((assignmentId) => approve({ assignmentId })));
    },
    [approve, account],
  );
}
