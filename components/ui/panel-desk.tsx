"use client";

import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

// A desk lets the panels inside it be torn off their column, dragged anywhere on screen and
// folded to their header. Without a desk, a Panel stays where the layout puts it.
type Placement = { x: number; y: number; width: number };
type PanelState = { placement: Placement | null; minimized: boolean; raised: number };
type Layout = Record<string, PanelState>;

type DeskValue = {
  layout: Layout;
  update: (id: string, change: (state: PanelState) => Partial<PanelState>) => void;
  raise: () => number;
};

const DeskContext = createContext<DeskValue | null>(null);
const EMPTY: PanelState = { placement: null, minimized: false, raised: 0 };
const EDGE_GAP = 12;
const DRAG_THRESHOLD_PX = 3;
const INTERACTIVE = "button, a, input, select, textarea, label, [role='switch']";

function readLayout(key: string): Layout {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Layout;
  } catch {
    return {};
  }
}

function writeLayout(key: string, layout: Layout) {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    // Private windows and full storage only lose the remembered layout.
  }
}

export function PanelDesk({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  // The desk mounts after the map data loads, so it never renders on the server and can read storage at once.
  const [layout, setLayout] = useState<Layout>(() => readLayout(storageKey));
  const top = useRef(Math.max(1, ...Object.values(layout).map((state) => state.raised)));

  const update = useCallback(
    (id: string, change: (state: PanelState) => Partial<PanelState>) =>
      setLayout((current) => {
        const state = current[id] ?? EMPTY;
        const next = { ...current, [id]: { ...state, ...change(state) } };
        writeLayout(storageKey, next);
        return next;
      }),
    [storageKey],
  );

  const raise = useCallback(() => ++top.current, []);
  const value = useMemo(() => ({ layout, update, raise }), [layout, update, raise]);
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}

function clampToViewport(x: number, y: number, width: number) {
  return {
    x: Math.min(Math.max(EDGE_GAP, x), window.innerWidth - Math.min(width, 160)),
    y: Math.min(Math.max(EDGE_GAP, y), window.innerHeight - 48),
  };
}

export type DeskPanel = {
  minimized: boolean;
  floating: boolean;
  style: React.CSSProperties | undefined;
  onHandlePointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  toggleMinimized: () => void;
  dock: () => void;
};

// Null outside a desk. The drag listens on the window so a fast cursor can't outrun the header,
// and it starts only after a few pixels so a plain click on the header does nothing.
export function useDeskPanel(id: string, sectionRef: React.RefObject<HTMLElement | null>): DeskPanel | null {
  const desk = useContext(DeskContext);
  if (!desk) return null;
  const state = desk.layout[id] ?? EMPTY;
  const { update, raise } = desk;

  const onHandlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const section = sectionRef.current;
    if (event.button !== 0 || !section || (event.target as HTMLElement).closest(INTERACTIVE)) return;
    event.preventDefault();
    const rect = section.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY };
    let level: number | null = null;

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - origin.x;
      const dy = moveEvent.clientY - origin.y;
      if (level === null && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      level ??= raise();
      const at = clampToViewport(rect.left + dx, rect.top + dy, rect.width);
      const raised = level;
      update(id, () => ({ placement: { ...at, width: rect.width }, raised }));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const placement = state.placement;
  return {
    minimized: state.minimized,
    floating: placement !== null,
    style: placement
      ? { position: "fixed", left: placement.x, top: placement.y, width: placement.width, zIndex: 20 + state.raised, maxHeight: `calc(100dvh - ${placement.y + EDGE_GAP}px)` }
      : undefined,
    onHandlePointerDown,
    toggleMinimized: () => update(id, (current) => ({ minimized: !current.minimized })),
    dock: () => update(id, () => ({ placement: null })),
  };
}
