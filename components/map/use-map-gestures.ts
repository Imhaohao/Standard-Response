"use client";

import { RefObject, useEffect, useRef } from "react";
import { InkMapRenderer } from "@/lib/ink-map/renderer";

const DRAG_THRESHOLD_PX = 4;
const WHEEL_ZOOM_SPEED = 0.0018;

type Pointer = { x: number; y: number };

// Drag pans, the wheel and pinches zoom toward the cursor, a double click goes back home.
// Moves are coalesced to one redraw per frame, because each redraw re-renders the whole town.
export function useMapGestures(box: RefObject<HTMLDivElement | null>, renderer: InkMapRenderer | null) {
  const dragged = useRef(false);

  useEffect(() => {
    const element = box.current;
    if (!element || !renderer) return;
    const pointers = new Map<number, Pointer>();
    let start: Pointer | null = null;
    let pending: { from: Pointer; to: Pointer } | null = null;
    let pinch: number | null = null;
    let frame = 0;

    const local = (event: PointerEvent | WheelEvent | MouseEvent): Pointer => {
      const rect = element.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const flush = () => {
      frame = 0;
      if (!pending) return;
      renderer.panBetween(pending.from.x, pending.from.y, pending.to.x, pending.to.y);
      pending = null;
    };
    const queuePan = (from: Pointer, to: Pointer) => {
      pending = pending ? { from: pending.from, to } : { from, to };
      frame ||= requestAnimationFrame(flush);
    };
    const pinchDistance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointers.set(event.pointerId, local(event));
      start = local(event);
      dragged.current = false;
      pinch = pointers.size === 2 ? pinchDistance() : null;
    };
    const move = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const point = local(event);
      pointers.set(event.pointerId, point);
      if (start && Math.hypot(point.x - start.x, point.y - start.y) > DRAG_THRESHOLD_PX) dragged.current = true;
      if (!dragged.current) return;
      element.setPointerCapture(event.pointerId);
      if (pointers.size === 2 && pinch) {
        const distance = pinchDistance();
        renderer.zoomAt(distance / pinch, point.x, point.y);
        pinch = distance;
        return;
      }
      queuePan(previous, point);
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = local(event);
      renderer.zoomAt(Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), point.x, point.y);
    };
    const home = () => renderer.resetView();

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("dblclick", home);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("dblclick", home);
    };
  }, [box, renderer]);

  // A click that ended a drag is not a pick.
  return dragged;
}
