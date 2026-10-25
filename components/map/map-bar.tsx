import { ReactNode } from "react";

// The surface every bar floating over a map shares.
export function ChromeSurface({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`pointer-events-auto card bg-panel/96 backdrop-blur-md ${className}`}>{children}</div>;
}

