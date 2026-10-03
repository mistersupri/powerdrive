import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Selection } from "./useSelection.ts";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const IGNORE = "button, a, input, select, textarea, label, [data-selectable-key], [data-prevent-marquee]";
const MIN_DRAG = 4;

/**
 * Rubber-band selection inside a scrollable container. Item rects are measured
 * once when the drag starts (not on every mouse move) and updates are batched
 * per animation frame, so dragging stays smooth with hundreds of items.
 */
export function useMarquee(containerRef: React.RefObject<HTMLElement | null>, selection: Selection) {
  const [box, setBox] = useState<Box | null>(null);
  const draggedRef = useRef(false);
  const stateRef = useRef<{
    startX: number;
    startY: number;
    base: Set<string>;
    rects: { key: string; rect: DOMRect }[];
    frame: number;
  } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(IGNORE)) return;
      const container = containerRef.current;
      if (!container) return;
      draggedRef.current = false;
      const rects = Array.from<HTMLElement>(container.querySelectorAll<HTMLElement>("[data-selectable-key]")).map((el) => ({
        key: el.dataset.selectableKey!,
        rect: el.getBoundingClientRect(),
      }));
      stateRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        base: e.ctrlKey || e.metaKey || e.shiftKey ? new Set(selectionRef.current.keys) : new Set(),
        rects,
        frame: 0,
      };

      const onMove = (ev: MouseEvent) => {
        const s = stateRef.current;
        if (!s) return;
        if (!draggedRef.current && Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < MIN_DRAG) return;
        draggedRef.current = true;
        cancelAnimationFrame(s.frame);
        s.frame = requestAnimationFrame(() => {
          const minX = Math.min(s.startX, ev.clientX);
          const maxX = Math.max(s.startX, ev.clientX);
          const minY = Math.min(s.startY, ev.clientY);
          const maxY = Math.max(s.startY, ev.clientY);
          const next = new Set(s.base);
          for (const { key, rect } of s.rects) {
            const hit = !(rect.right < minX || rect.left > maxX || rect.bottom < minY || rect.top > maxY);
            if (hit) next.add(key);
          }
          selectionRef.current.set(next);
          const c = container.getBoundingClientRect();
          setBox({
            left: minX - c.left + container.scrollLeft,
            top: minY - c.top + container.scrollTop,
            width: maxX - minX,
            height: maxY - minY,
          });
        });
      };

      const onUp = () => {
        if (stateRef.current) cancelAnimationFrame(stateRef.current.frame);
        stateRef.current = null;
        setBox(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        // The click that ends a drag must not clear the selection we just made.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [containerRef]
  );

  useEffect(() => () => {
    if (stateRef.current) cancelAnimationFrame(stateRef.current.frame);
  }, []);

  /** Click on empty space clears the selection, unless it ended a marquee drag. */
  const onBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (draggedRef.current) return;
    if ((e.target as HTMLElement).closest(IGNORE)) return;
    selectionRef.current.clear();
  }, []);

  return { box, onMouseDown, onBackgroundClick };
}

export function MarqueeBox({ box }: { box: Box | null }) {
  if (!box) return null;
  return React.createElement("div", {
    "aria-hidden": true,
    className: "absolute z-30 pointer-events-none rounded-sm border border-accent-500 bg-accent-500/10",
    style: box,
  });
}
