import { ReactNode } from "react";

const SURFACES = {
  panel: "bg-panel text-on-panel",
  canvas: "bg-canvas text-ink",
} as const;

// A phone-sized page standing on the map paper, so a laptop shows it the way a phone would.
// fitScreen pins it to one screen height for pages whose map fills the space and scrolls inside.
export function PhoneScreen({
  children,
  surface = "panel",
  fitScreen = false,
}: {
  children: ReactNode;
  surface?: keyof typeof SURFACES;
  fitScreen?: boolean;
}) {
  return (
    <div className="min-h-[100dvh] bg-map-paper">
      <main className={`relative mx-auto flex max-w-md flex-col shadow-device ${fitScreen ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]"} ${SURFACES[surface]}`}>
        {children}
      </main>
    </div>
  );
}
