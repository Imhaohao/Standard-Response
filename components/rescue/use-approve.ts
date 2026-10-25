"use client";

import { useMutation } from "convex/react";
import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export function useApprove() {
  const approve = useMutation(api.offers.approve);
  return useCallback(
    async (assignmentIds: Id<"assignments">[]) => {
      await Promise.all(assignmentIds.map((assignmentId) => approve({ assignmentId })));
    },
    [approve],
  );
}
