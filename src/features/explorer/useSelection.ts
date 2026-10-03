import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExplorerEntry, hasOpenDialog, isCoarsePointer, isTypingTarget } from "./types.ts";

export interface Selection {
  keys: Set<string>;
  count: number;
  has: (key: string) => boolean;
  toggle: (key: string) => void;
  add: (key: string) => void;
  only: (key: string) => void;
  set: (keys: Set<string>) => void;
  selectAll: () => void;
  clear: () => void;
  /** Live view of the keys for event handlers that outlive a render. */
  ref: React.MutableRefObject<Set<string>>;
  /** Click semantics shared by every explorer. */
  handleClick: (e: React.MouseEvent, entry: ExplorerEntry, open: () => void) => void;
}

/**
 * Multi-select for an ordered list of entries:
 * shift-click selects a range, ctrl/cmd-click toggles, a plain click selects one
 * item on desktop. On touch screens a tap opens, or toggles while selecting.
 * Esc clears and Ctrl/Cmd+A selects everything visible.
 */
export function useSelection(entries: ExplorerEntry[], resetKey?: unknown): Selection {
  const [keys, setKeys] = useState<Set<string>>(() => new Set());
  const anchorRef = useRef<string | null>(null);
  const ref = useRef(keys);
  ref.current = keys;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    setKeys(new Set());
    anchorRef.current = null;
  }, [resetKey]);

  // Drop keys whose items disappeared (deleted, moved, filtered out).
  useEffect(() => {
    setKeys((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(entries.map((e) => e.key));
      const next = new Set([...prev].filter((k) => visible.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  const toggle = useCallback((key: string) => {
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchorRef.current = key;
  }, []);

  const add = useCallback((key: string) => {
    setKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    anchorRef.current = key;
  }, []);

  const only = useCallback((key: string) => {
    setKeys(new Set([key]));
    anchorRef.current = key;
  }, []);

  const selectAll = useCallback(() => setKeys(new Set(entriesRef.current.map((e) => e.key))), []);
  const clear = useCallback(() => {
    setKeys((prev) => (prev.size === 0 ? prev : new Set()));
    anchorRef.current = null;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent, entry: ExplorerEntry, open: () => void) => {
      e.stopPropagation();
      const current = ref.current;
      const anchor = anchorRef.current;

      if (e.shiftKey && anchor) {
        const list = entriesRef.current;
        const from = list.findIndex((it) => it.key === anchor);
        const to = list.findIndex((it) => it.key === entry.key);
        if (from !== -1 && to !== -1) {
          const next = new Set(current);
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(list[i].key);
          setKeys(next);
          return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        toggle(entry.key);
        return;
      }

      // Touch: a tap opens, unless the user is already picking items.
      if (isCoarsePointer()) {
        if (current.size > 0) toggle(entry.key);
        else open();
        return;
      }

      only(entry.key);
    },
    [only, toggle]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || hasOpenDialog()) return;
      if (e.key === "Escape" && ref.current.size > 0) {
        clear();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && entriesRef.current.length > 0) {
        e.preventDefault();
        selectAll();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clear, selectAll]);

  return useMemo(
    () => ({
      keys,
      count: keys.size,
      has: (key: string) => keys.has(key),
      toggle,
      add,
      only,
      set: setKeys,
      selectAll,
      clear,
      ref,
      handleClick,
    }),
    [keys, toggle, add, only, selectAll, clear, handleClick]
  );
}
