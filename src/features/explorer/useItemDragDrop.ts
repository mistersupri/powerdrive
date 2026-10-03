import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ExplorerEntry } from "./types.ts";
import type { Selection } from "./useSelection.ts";

/** Drop target id for the explorer root (e.g. "My Drive" in the breadcrumb). */
export const ROOT_TARGET = "__root__";

const DRAG_MIME = "application/x-powerdrive-items";
const HOLD_TO_SELECT_MS = 450;
const HOLD_TO_MENU_MS = 900;
const MOVE_TOLERANCE = 8;

export interface DragDropOptions {
  selection: Selection;
  entries: ExplorerEntry[];
  enabled: boolean;
  onMove: (targetId: string, keys: string[]) => void;
  /** Return false to reject a target (e.g. files cannot live at the root). */
  canDropOn?: (targetId: string, keys: string[]) => boolean;
  onOpen: (entry: ExplorerEntry) => void;
  onContextMenu: (entry: ExplorerEntry, x: number, y: number) => void;
}

// React attaches touchmove as a passive listener, so it cannot stop page
// scrolling. Once a hold completes we add a native non-passive listener that
// does, and remove it as soon as the finger lifts.
function blockScroll(e: TouchEvent) {
  if (e.cancelable) e.preventDefault();
}
function releaseScroll() {
  document.removeEventListener("touchmove", blockScroll);
}

interface TouchState {
  entry: ExplorerEntry;
  startX: number;
  startY: number;
  selectTimer: ReturnType<typeof setTimeout> | null;
  menuTimer: ReturnType<typeof setTimeout> | null;
  held: boolean;
  menuOpened: boolean;
  dragging: boolean;
  keys: string[];
}

export function useItemDragDrop(opts: DragDropOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [dragKeys, setDragKeys] = useState<string[] | null>(null);
  const dragKeysRef = useRef<string[] | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);
  const overTargetRef = useRef<string | null>(null);
  const [touchBadge, setTouchBadge] = useState<{ x: number; y: number; count: number; name: string } | null>(null);
  const touchRef = useRef<TouchState | null>(null);
  const suppressClickRef = useRef(false);

  const setOver = (id: string | null) => {
    overTargetRef.current = id;
    setOverTarget(id);
  };

  const keysForDrag = (entry: ExplorerEntry) => {
    const current = optsRef.current.selection.ref.current;
    return current.has(entry.key) ? Array.from(current) : [entry.key];
  };

  const isOwnFolder = (targetId: string, keys: string[]) => keys.includes(`folder_${targetId}`);

  const allowed = (targetId: string, keys: string[]) =>
    !isOwnFolder(targetId, keys) && (optsRef.current.canDropOn?.(targetId, keys) ?? true);

  const finish = () => {
    dragKeysRef.current = null;
    setDragKeys(null);
    setOver(null);
  };

  // --- Desktop (HTML5 drag and drop) ---

  const itemDragProps = useCallback(
    (entry: ExplorerEntry) => {
      if (!optsRef.current.enabled) return {};
      return {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.stopPropagation();
          const keys = keysForDrag(entry);
          if (!optsRef.current.selection.ref.current.has(entry.key)) optsRef.current.selection.only(entry.key);
          dragKeysRef.current = keys;
          setDragKeys(keys);
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(keys));
          setDragImage(e, entry.name, keys.length);
        },
        onDragEnd: finish,
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const dropTargetProps = useCallback((targetId: string) => {
    return {
      "data-drop-target": targetId,
      onDragOver: (e: React.DragEvent) => {
        const keys = dragKeysRef.current;
        if (!keys || !allowed(targetId, keys)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        if (overTargetRef.current !== targetId) setOver(targetId);
      },
      onDragLeave: (e: React.DragEvent) => {
        const next = e.relatedTarget as Node | null;
        if (next && (e.currentTarget as Node).contains(next)) return;
        if (overTargetRef.current === targetId) setOver(null);
      },
      onDrop: (e: React.DragEvent) => {
        const keys = dragKeysRef.current;
        if (!keys) return;
        e.preventDefault();
        e.stopPropagation();
        finish();
        if (allowed(targetId, keys)) optsRef.current.onMove(targetId, keys);
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Touch: hold to select, keep holding for the menu, hold then move to drag ---

  const clearTouchTimers = (t: TouchState | null) => {
    releaseScroll();
    if (!t) return;
    if (t.selectTimer) clearTimeout(t.selectTimer);
    if (t.menuTimer) clearTimeout(t.menuTimer);
  };

  const guardNextClick = () => {
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 350);
  };

  const touchProps = useCallback((entry: ExplorerEntry) => {
    return {
      onTouchStart: (e: React.TouchEvent) => {
        if (e.touches.length !== 1) return;
        clearTouchTimers(touchRef.current);
        const t = e.touches[0];
        const state: TouchState = {
          entry,
          startX: t.clientX,
          startY: t.clientY,
          selectTimer: null,
          menuTimer: null,
          held: false,
          menuOpened: false,
          dragging: false,
          keys: [],
        };
        state.selectTimer = setTimeout(() => {
          state.held = true;
          if (optsRef.current.enabled) document.addEventListener("touchmove", blockScroll, { passive: false });
          navigator.vibrate?.(30);
          optsRef.current.selection.add(entry.key);
        }, HOLD_TO_SELECT_MS);
        state.menuTimer = setTimeout(() => {
          if (state.dragging) return;
          state.menuOpened = true;
          navigator.vibrate?.(40);
          optsRef.current.selection.add(entry.key);
          optsRef.current.onContextMenu(entry, state.startX, state.startY);
        }, HOLD_TO_MENU_MS);
        touchRef.current = state;
      },
      onTouchMove: (e: React.TouchEvent) => {
        const state = touchRef.current;
        if (!state) return;
        const t = e.touches[0];
        const moved = Math.hypot(t.clientX - state.startX, t.clientY - state.startY) > MOVE_TOLERANCE;
        if (!moved && !state.dragging) return;

        if (!state.dragging) {
          if (state.menuTimer) clearTimeout(state.menuTimer);
          // Moving before the hold completes is a scroll, not a drag.
          if (!state.held || state.menuOpened || !optsRef.current.enabled) {
            clearTouchTimers(state);
            touchRef.current = null;
            return;
          }
          state.dragging = true;
          const current = new Set(optsRef.current.selection.ref.current);
          current.add(state.entry.key);
          state.keys = Array.from(current);
          dragKeysRef.current = state.keys;
          setDragKeys(state.keys);
        }

        setTouchBadge({ x: t.clientX, y: t.clientY, count: state.keys.length, name: state.entry.name });
        const target = (document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null)?.closest<HTMLElement>(
          "[data-drop-target]"
        );
        const id = target?.dataset.dropTarget ?? null;
        setOver(id && allowed(id, state.keys) ? id : null);
      },
      onTouchEnd: (e: React.TouchEvent) => {
        const state = touchRef.current;
        touchRef.current = null;
        if (!state) return;
        clearTouchTimers(state);
        setTouchBadge(null);

        if (state.dragging) {
          e.preventDefault();
          guardNextClick();
          const target = overTargetRef.current;
          finish();
          if (target) optsRef.current.onMove(target, state.keys);
          return;
        }
        if (state.held || state.menuOpened) {
          e.preventDefault();
          guardNextClick();
        }
        // A short tap falls through to the click handler.
      },
      onTouchCancel: () => {
        clearTouchTimers(touchRef.current);
        touchRef.current = null;
        setTouchBadge(null);
        finish();
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTouchTimers(touchRef.current), []);

  return {
    dragKeys,
    isDragging: !!dragKeys,
    overTarget,
    touchBadge,
    itemDragProps,
    dropTargetProps,
    touchProps,
    /** True right after a touch gesture handled the interaction; skip the synthetic click. */
    shouldSuppressClick: () => suppressClickRef.current,
  };
}

/** Drag preview: item name plus a count, styled with the theme tokens. */
function setDragImage(e: React.DragEvent, name: string, count: number) {
  try {
    const ghost = document.createElement("div");
    ghost.className =
      "fixed -top-[999px] left-0 flex items-center gap-2 h-10 pl-3 pr-2 rounded-xl bg-surface text-ink-900 border border-ink-200 shadow-float text-sm font-semibold max-w-[260px]";
    const label = document.createElement("span");
    label.className = "truncate";
    label.textContent = name;
    ghost.appendChild(label);
    if (count > 1) {
      const badge = document.createElement("span");
      badge.className = "shrink-0 h-6 min-w-6 px-1.5 rounded-md bg-accent-600 text-accent-fg text-xs flex items-center justify-center";
      badge.textContent = String(count);
      ghost.appendChild(badge);
    }
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 16, 20);
    setTimeout(() => ghost.remove(), 0);
  } catch {
    // Some browsers refuse custom drag images; the default preview is fine.
  }
}

export function TouchDragBadge({ badge }: { badge: { x: number; y: number; count: number; name: string } | null }) {
  if (!badge) return null;
  return React.createElement(
    "div",
    {
      "aria-hidden": true,
      className:
        "fixed z-[80] pointer-events-none -translate-x-1/2 -translate-y-14 flex items-center gap-2 h-10 pl-3 pr-2 rounded-xl bg-surface text-ink-900 border border-ink-200 shadow-float text-sm font-semibold max-w-[240px]",
      style: { left: badge.x, top: badge.y },
    },
    React.createElement("span", { className: "truncate" }, badge.name),
    React.createElement(
      "span",
      {
        className:
          "shrink-0 h-6 min-w-6 px-1.5 rounded-md bg-accent-600 text-accent-fg text-xs flex items-center justify-center",
      },
      `${badge.count}`
    )
  );
}
