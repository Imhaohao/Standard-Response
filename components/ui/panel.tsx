"use client";

import { ArrowsIn, CaretDown } from "@phosphor-icons/react";
import { ReactNode, useRef } from "react";
import { DeskPanel, useDeskPanel } from "./panel-desk";

const ICON_BUTTON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-on-panel-muted transition-colors duration-150 hover:bg-panel-raised hover:text-on-panel focus-visible:outline-2 focus-visible:outline-on-panel";

function DeskButtons({ title, desk }: { title: string; desk: DeskPanel }) {
  return (
    <span className="flex shrink-0 items-center">
      {desk.floating && (
        <button type="button" onClick={desk.dock} aria-label={`Put ${title} back in its column`} title="Put back in its column" className={ICON_BUTTON}>
          <ArrowsIn weight="bold" className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={desk.toggleMinimized}
        aria-expanded={!desk.minimized}
        aria-label={desk.minimized ? `Expand ${title}` : `Minimize ${title}`}
        title={desk.minimized ? "Expand" : "Minimize"}
        className={ICON_BUTTON}
      >
        <CaretDown weight="bold" className={`size-4 transition-[rotate] duration-150 ${desk.minimized ? "-rotate-90" : ""}`} />
      </button>
    </span>
  );
}

// A card that floats over the map. The map is the subject; cards hold the decisions.
// Inside a PanelDesk the header is a drag handle and the card can fold to its header.
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const desk = useDeskPanel(title, sectionRef);

  return (
    <section ref={sectionRef} style={desk?.style} className={`flex min-w-0 flex-col overflow-hidden card ${desk?.minimized ? "shrink-0" : ""} ${className}`}>
      <header
        onPointerDown={desk?.onHandlePointerDown}
        onDoubleClick={desk?.floating ? desk.dock : undefined}
        className={`flex min-h-11 items-center justify-between gap-2 px-4 pt-1 ${desk ? "cursor-grab touch-none pr-1.5 select-none active:cursor-grabbing" : ""} ${desk?.minimized ? "pb-1" : ""}`}
      >
        <h2 className="type-heading">{title}</h2>
        <span className="flex min-w-0 items-center">
          {aside}
          {desk && <DeskButtons title={title} desk={desk} />}
        </span>
      </header>
      {!desk?.minimized && children}
    </section>
  );
}

export function PanelEmpty({ children }: { children: ReactNode }) {
  return <p className="type-small px-4 py-6 text-center text-on-panel-muted">{children}</p>;
}
