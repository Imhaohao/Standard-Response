import { FocusEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "./use-dismiss";

const ITEM_SELECTOR = "[data-popover-item]:not([disabled])";

function itemsIn(container: HTMLElement | null) {
  return Array.from(container?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
}

function moveFocus(container: HTMLElement | null, step: 1 | -1) {
  const items = itemsIn(container);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = at === -1 ? (step === 1 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
  items[next].focus();
}

// A button that opens a panel under it. On top of useDismiss (click outside, Escape) it returns focus
// to the button on Escape, closes when Tab leaves the panel, and moves between the panel's
// `data-popover-item` elements with the arrow keys. Put `containerRef`, `onKeyDown` and `onBlur` on the
// element that holds both, and `triggerRef` on the button.
export function usePopover() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const containerRef = useDismiss(open, close);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusFirstOnOpen = useRef(false);

  useEffect(() => {
    if (!open || !focusFirstOnOpen.current) return;
    focusFirstOnOpen.current = false;
    itemsIn(containerRef.current)[0]?.focus();
  }, [open, containerRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") return triggerRef.current?.focus();
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (open) return moveFocus(containerRef.current, event.key === "ArrowDown" ? 1 : -1);
    focusFirstOnOpen.current = true;
    setOpen(true);
  };

  // A click on plain text inside the panel blurs to nothing; only focus landing outside closes it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !containerRef.current?.contains(next)) close();
  };

  const toggle = () => setOpen((was) => !was);
  return { open, close, toggle, triggerRef, containerRef, onKeyDown, onBlur };
}
