"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { MotionConfig } from "motion/react";
import { ReactNode } from "react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error("NEXT_PUBLIC_CONVEX_URL is missing. Run `npm run dev` so Convex writes .env.local.");

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProvider client={convex}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ConvexProvider>
  );
}
