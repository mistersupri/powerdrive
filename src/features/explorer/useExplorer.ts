import React, { useCallback, useRef } from "react";
import { ExplorerEntry } from "./types.ts";
import { useSelection } from "./useSelection.ts";
import { useMarquee } from "./useMarquee.ts";
import { useItemDragDrop } from "./useItemDragDrop.ts";

export interface UseExplorerOptions {
  entries: ExplorerEntry[];
  /** Selection resets whenever this changes (folder navigation, search). */
  resetKey?: unknown;
  open: (entry: ExplorerEntry) => void;
  onContextMenu: (entry: ExplorerEntry, x: number, y: number) => void;
  /** Items can be dragged onto folders and drop targets. */
  dragEnabled?: boolean;
  onMove?: (targetId: string, keys: string[]) => void;
  canDropOn?: (targetId: string, keys: string[]) => boolean;
  /** Delete key on a focused item. */
  onDeleteKey?: () => void;
}

/**
 * Everything an explorer view needs to make its items interactive:
 * selection, rubber-band select, drag-to-move (mouse and touch), context menus
 * and keyboard access. Views spread `getItemProps(entry)` on each card or row.
 */
export function useExplorer(opts: UseExplorerOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const contentRef = useRef<HTMLDivElement>(null);
  const selection = useSelection(opts.entries, opts.resetKey);
  const marquee = useMarquee(contentRef, selection);
  const dnd = useItemDragDrop({
    selection,
    entries: opts.entries,
    enabled: !!opts.dragEnabled,
    onMove: (target, keys) => optsRef.current.onMove?.(target, keys),
    canDropOn: (target, keys) => optsRef.current.canDropOn?.(target, keys) ?? true,
    onOpen: (entry) => optsRef.current.open(entry),
    onContextMenu: (entry, x, y) => optsRef.current.onContextMenu(entry, x, y),
  });

  const getItemProps = useCallback(
    (entry: ExplorerEntry) => {
      const o = optsRef.current;
      return {
        "data-selectable-key": entry.key,
        tabIndex: 0,
        "aria-selected": selection.has(entry.key),
        onClick: (e: React.MouseEvent) => {
          if (dnd.shouldSuppressClick()) return;
          selection.handleClick(e, entry, () => o.open(entry));
        },
        onDoubleClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          o.open(entry);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter") {
            e.preventDefault();
            o.open(entry);
          } else if (e.key === " ") {
            e.preventDefault();
            selection.toggle(entry.key);
          } else if (e.key === "Delete" && o.onDeleteKey) {
            e.preventDefault();
            if (!selection.has(entry.key)) selection.only(entry.key);
            o.onDeleteKey();
          } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (!selection.has(entry.key)) selection.only(entry.key);
            o.onContextMenu(entry, r.left + 24, r.top + 24);
          }
        },
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (!selection.has(entry.key)) selection.only(entry.key);
          o.onContextMenu(entry, e.clientX, e.clientY);
        },
        ...dnd.touchProps(entry),
        ...dnd.itemDragProps(entry),
        ...(entry.kind === "folder" && o.dragEnabled ? dnd.dropTargetProps(entry.id) : {}),
      };
    },
    [selection, dnd]
  );

  return { selection, marquee, dnd, contentRef, getItemProps };
}
