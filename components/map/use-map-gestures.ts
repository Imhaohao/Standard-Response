"use client";

import { RefObject, useEffect, useRef } from "react";
import { InkMapRenderer } from "@/lib/ink-map/renderer";

const DRAG_THRESHOLD_PX = 4;
const WHEEL_ZOOM_SPEED = 0.0018;

type Pointer = { x: number; y: number };

// Drag pans, the wheel and pinches zoom toward the cursor, a double click goes back home.
// Pans and zooms are coalesced to one redraw per frame, because each redraw re-renders the whole
// town and a trackpad sends two or three wheel events a frame.
export function useMapGestures(box: RefObject<HTMLDivElement | null>, renderer: InkMapRenderer | null) {
  const dragged = useRef(false);

  useEffect(() => {
    const element = box.current;
    if (!element || !renderer) return;
    const pointers = new Map<number, Pointer>();
    let start: Pointer | null = null;
    let pending: { from: Pointer; to: Pointer } | null = null;
    let zoom: { factor: number; at: Pointer } | null = null;
    let pinch: number | null = null;
    let frame = 0;

    // Reading the box's position after React has touched the overlay forces a fresh layout, so
    // it is read once and again only when the box changes size or the page scrolls.
    let rect = element.getBoundingClientRect();
    const remeasure = () => {
      rect = element.getBoundingClientRect();
    };
    const resized = new ResizeObserver(remeasure);
    resized.observe(element);
    window.addEventListener("scroll", remeasure, { passive: true, capture: true });
    const local = (event: PointerEvent | WheelEvent | MouseEvent): Pointer => ({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const flush = () => {
      frame = 0;
      if (zoom) renderer.zoomAt(zoom.factor, zoom.at.x, zoom.at.y);
      if (pending) renderer.panBetween(pending.from.x, pending.from.y, pending.to.x, pending.to.y);
      zoom = null;
      pending = null;
    };
    const queuePan = (from: Pointer, to: Pointer) => {
      pending = pending ? { from: pending.from, to } : { from, to };
      frame ||= requestAnimationFrame(flush);
    };
    const queueZoom = (factor: number, at: Pointer) => {
      zoom = { factor: (zoom?.factor ?? 1) * factor, at };
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
        queueZoom(distance / pinch, point);
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
      queueZoom(Math.exp(-event.deltaY * WHEEL_ZOOM_SPEED), local(event));
    };
    const home = () => renderer.resetView();
    // A native drag of some selected text would cancel the pointer and end the pan mid-drag.
    const noNativeDrag = (event: DragEvent) => event.preventDefault();

    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("dblclick", home);
    element.addEventListener("dragstart", noNativeDrag);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("scroll", remeasure, { capture: true });
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", up);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("dblclick", home);
      element.removeEventListener("dragstart", noNativeDrag);
    };
  }, [box, renderer]);

  // A click that ended a drag is not a pick.
  return dragged;
}
